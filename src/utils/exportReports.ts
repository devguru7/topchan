import type { AppState, ShiftAuditRecord } from '../types/ops';
import {
  calcBookingTotals,
  calcBookingTouristTaxUzs,
  calcTouristTaxPerNightUzs,
  round2,
} from './math';
import { diffDaysIso, getTashkentTodayIso } from './time';

const UTF8_BOM = '\uFEFF';

function escapeCsvCell(value: string | number | boolean | null | undefined): string {
  const str = value === null || value === undefined ? '' : String(value);
  if (/[",\r\n;]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function toCsvLines(
  headers: string[],
  rows: Array<Array<string | number | boolean | null | undefined>>
): string {
  const lines = [headers.map(escapeCsvCell).join(',')];
  for (const row of rows) {
    lines.push(row.map(escapeCsvCell).join(','));
  }
  return `${UTF8_BOM}${lines.join('\r\n')}\r\n`;
}

/**
 * Generates an E-mehmon / Uzbekistan Tourist Tax CSV report (UTF-8 BOM for Excel).
 * Uses BCV (БРВ) = 440,000 UZS, 0.4% UZB / 10% Foreigners (11-40 room bracket), age <16 exempt.
 */
export function buildTouristTaxCsv(state: AppState): string {
  const activePhysicalCount = state.physicalRooms.filter((r) => !r.archived).length;
  const bcvUzs = state.currency.bcvUzs;
  const headers = [
    'Бронь',
    'Статус',
    'ФИО гостя',
    'Гражданство',
    'Паспорт',
    'Возраст',
    'Категория',
    'Ночей',
    'Ставка % БРВ',
    'БРВ (UZS)',
    'Сбор за ночь (UZS)',
    'Итого турсбор (UZS)',
    'E-mehmon',
  ];

  const rows: Array<Array<string | number>> = [];
  let grandTotalUzs = 0;

  for (const bkg of state.bookings) {
    if (bkg.status === 'cancelled') continue;
    const nights = Math.max(
      1,
      bkg.segments.reduce((acc, s) => acc + Math.max(1, diffDaysIso(s.fromDate, s.toDate)), 0)
    );
    for (const guest of bkg.guests) {
      const dailyUzs = calcTouristTaxPerNightUzs(guest, bcvUzs, activePhysicalCount);
      const totalUzs = dailyUzs * nights;
      grandTotalUzs += totalUzs;
      const pct =
        guest.age < 16
          ? '0% (до 16 лет)'
          : !guest.isForeigner
            ? '0.4% (РУз)'
            : activePhysicalCount <= 10
              ? '5% (до 10 комн.)'
              : '10% (11–40 комн.)';
      rows.push([
        bkg.bnovoId,
        bkg.status === 'active' ? 'Проживает' : 'Выехал',
        guest.fullName,
        guest.citizenship,
        guest.passportNo,
        guest.age,
        guest.isForeigner ? 'Иностранец' : 'Гражданин РУз',
        nights,
        pct,
        bcvUzs,
        dailyUzs,
        totalUzs,
        guest.emehmonRegistered ? 'Зарегистрирован' : 'Ожидает',
      ]);
    }
  }

  const activeBookingsTax = state.bookings
    .filter((b) => b.status !== 'cancelled')
    .reduce((sum, b) => sum + calcBookingTouristTaxUzs(b, bcvUzs, activePhysicalCount), 0);

  rows.push([
    'ИТОГО',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    bcvUzs,
    '',
    Math.max(grandTotalUzs, activeBookingsTax),
    '',
  ]);

  return toCsvLines(headers, rows);
}

/**
 * Generates a 6-pocket Cash Desk & P&L CSV report (UTF-8 BOM for Excel).
 * Preserves separate currencies across all 6 pockets (never mixes UZS/USD/EUR).
 */
export function buildCashPnlCsv(state: AppState): string {
  const opDate = state.operationalDate ?? getTashkentTodayIso();
  const headers = [
    'Раздел',
    'Карман / Статья',
    'Валюта',
    'Остаток / Сумма',
    'Направление',
    'Дата / Время',
    'Комментарий',
  ];

  const rows: Array<Array<string | number>> = [];

  for (const p of state.pockets) {
    if (p.id === 'safe' && p.safeBalances) {
      rows.push(['Сейф (карман 6)', p.name, 'UZS', Math.round(p.safeBalances.UZS), 'balance', opDate, 'Отдельный учёт UZS']);
      rows.push(['Сейф (карман 6)', p.name, 'USD', round2(p.safeBalances.USD), 'balance', opDate, 'Отдельный учёт USD']);
      rows.push(['Сейф (карман 6)', p.name, 'EUR', round2(p.safeBalances.EUR), 'balance', opDate, 'Отдельный учёт EUR']);
    } else {
      rows.push([
        'Остаток кармана',
        p.name,
        p.currency,
        p.currency === 'UZS' ? Math.round(p.balance) : round2(p.balance),
        'balance',
        opDate,
        p.id,
      ]);
    }
  }

  const totalRevenueUsd = round2(
    state.bookings
      .filter((b) => b.status !== 'cancelled')
      .reduce((acc, b) => acc + calcBookingTotals(b).totalChargesUsd, 0)
  );
  const totalCollectedUsd = round2(
    state.bookings
      .filter((b) => b.status !== 'cancelled')
      .reduce((acc, b) => acc + calcBookingTotals(b).totalPaymentsUsd, 0)
  );
  const pettyTx = state.transactions.filter(
    (t) => t.direction === 'out' && t.pocketId === 'cash_uzs' && t.label.toLowerCase().includes('хозрасход')
  );
  const totalPettyUzs = Math.round(pettyTx.reduce((acc, e) => acc + e.amount, 0));

  rows.push(['P&L Сводка', 'Начислено по броням', 'USD', totalRevenueUsd, 'in', opDate, 'Проживание + допуслуги']);
  rows.push(['P&L Сводка', 'Собрано оплат', 'USD', totalCollectedUsd, 'in', opDate, 'Оплаченные фолио']);
  rows.push(['P&L Сводка', 'Хозрасходы (Petty Cash)', 'UZS', totalPettyUzs, 'out', opDate, `${pettyTx.length} операций`]);

  for (const tx of state.transactions) {
    rows.push([
      'Движение кассы',
      tx.pocketId,
      tx.currency,
      tx.currency === 'UZS' ? Math.round(tx.amount) : round2(tx.amount),
      tx.direction,
      tx.timestamp,
      `${tx.label} (${tx.actor})`,
    ]);
  }

  return toCsvLines(headers, rows);
}

/**
 * Generates an immutable Shift / Night Audit archive CSV (UTF-8 BOM).
 */
export function buildShiftArchiveCsv(records: ShiftAuditRecord[]): string {
  const headers = [
    'Операционный день',
    'Закрыто в',
    'Администратор',
    'Загрузка %',
    'Занято / Всего мест',
    'Незаездов отменено',
    'E-mehmon не оформлено',
    'Турсбор (UZS)',
    'Касса UZS',
    'Касса USD',
    'Касса EUR',
    'Терминал UZS',
    'Перевод UZS',
    'Комментарий',
  ];

  const rows = records.map((r) => {
    const getBal = (id: string) => r.pocketsSnapshot.find((p) => p.id === id)?.balance ?? 0;
    const occPct = r.totalUnits > 0 ? Math.round((r.occupiedUnits / r.totalUnits) * 100) : 0;
    return [
      r.businessDate,
      r.closedAt,
      r.actor,
      occPct,
      `${r.occupiedUnits}/${r.totalUnits}`,
      r.noShowCancelledCount,
      r.unregisteredForeigners,
      Math.round(r.touristTaxUzs),
      Math.round(getBal('cash_uzs')),
      round2(getBal('cash_usd')),
      round2(getBal('cash_eur')),
      Math.round(getBal('terminal')),
      Math.round(getBal('transfer')),
      r.notes,
    ];
  });

  return toCsvLines(headers, rows);
}

export function triggerCsvDownload(filename: string, csvContent: string): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
