import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  BarChart3,
  Calculator,
  CheckCircle2,
  ClipboardCheck,
  ExternalLink,
  Minus,
  Plus,
  Printer,
  ShieldCheck,
  Vault,
  Wallet,
} from 'lucide-react';
import { useOps } from '../../context/OpsContext';
import type { CashPocketId, CurrencyCode } from '../../types/ops';
import {
  calcBookingTotals,
  calcDenominationTotals,
  calcDualRateChange,
  calcMonthlyTouristTaxUzs,
  formatEur,
  formatUsd,
  formatUzs,
  USD_DENOMINATIONS,
  UZS_DENOMINATIONS,
} from '../../utils/math';
import {
  addDaysIso,
  formatShortDateColumn,
  formatTashkentDateRu,
  getDaysToTouristTaxDeadline,
  getTashkentTodayIso,
} from '../../utils/time';
import {
  CopyButton,
  EmptyState,
  MetricTile,
  SegmentedControl,
  StatusPill,
  TooltipHint,
} from '../ui';

type CashSubTab = 'pockets' | 'expenses_safe' | 'handover' | 'analytics';

const CASH_SUBTABS: ReadonlyArray<{
  id: CashSubTab;
  label: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
}> = [
  { id: 'pockets', label: 'Карманы и сдача', icon: Calculator },
  { id: 'expenses_safe', label: 'Расходы и сейф', icon: Vault },
  { id: 'handover', label: 'Сдача смены (60с)', icon: ClipboardCheck },
  { id: 'analytics', label: 'Аналитика и печать', icon: BarChart3 },
];

const CHANGE_PREF_OPTIONS = [
  { id: 'UZS' as const, label: 'Сдача UZS' },
  { id: 'USD' as const, label: 'Сдача USD' },
];

export const CashTab: React.FC = () => {
  const {
    state,
    addPettyCashExpense,
    recordCashCalculatorTransaction,
    createSafeCollection,
    confirmSafeCollection,
    openBookingFolio,
    setActiveTab,
    pushToast,
  } = useOps();

  const [subTab, setSubTab] = useState<CashSubTab>('pockets');
  const [activePocketFilter, setActivePocketFilter] = useState<CashPocketId | 'all'>('all');

  // Dual-rate change calculator
  const [billInputUsd, setBillInputUsd] = useState('36');
  const [receivedCurrency, setReceivedCurrency] = useState<CurrencyCode>('USD');
  const [receivedAmount, setReceivedAmount] = useState('50');
  const [changePreference, setChangePreference] = useState<'UZS' | 'USD'>('UZS');
  const [calcLabel, setCalcLabel] = useState('Оплата проживания (калькулятор)');

  // Petty cash
  const [pettyCategory, setPettyCategory] = useState('Вода Hydrolife');
  const [pettyAmount, setPettyAmount] = useState('60000');
  const [pettyNote, setPettyNote] = useState('');

  // Safe collection
  const [safeUzs, setSafeUzs] = useState('1000000');
  const [safeUsd, setSafeUsd] = useState('100');
  const [safeEur, setSafeEur] = useState('0');

  // 60-Second Denomination Counter
  const [uzsBills, setUzsBills] = useState<Record<number, number>>({
    200000: 5,
    100000: 10,
    50000: 9,
    20000: 0,
    10000: 0,
    5000: 0,
  });
  const [usdBills, setUsdBills] = useState<Record<number, number>>({
    100: 2,
    50: 2,
    20: 2,
    10: 0,
    5: 0,
    1: 0,
  });

  const calcResult = useMemo(
    () =>
      calcDualRateChange({
        billUsd: parseFloat(billInputUsd) || 0,
        receivedCurrency,
        receivedAmount: parseFloat(receivedAmount) || 0,
        accRate: state.currency.accRate,
        exRate: state.currency.exRate,
        cbuUsd: state.currency.cbuUsd,
        cbuEur: state.currency.cbuEur,
      }),
    [billInputUsd, receivedCurrency, receivedAmount, state.currency]
  );

  const denomTotals = useMemo(
    () => calcDenominationTotals(uzsBills, usdBills),
    [uzsBills, usdBills]
  );

  const expectedCashUzs = state.pockets.find((p) => p.id === 'cash_uzs')?.balance ?? 0;
  const expectedCashUsd = state.pockets.find((p) => p.id === 'cash_usd')?.balance ?? 0;
  const diffUzs = denomTotals.totalUzs - expectedCashUzs;
  const diffUsd = denomTotals.totalUsd - expectedCashUsd;

  const activePhysicalCount = state.physicalRooms.filter((r) => !r.archived).length;
  const monthlyTouristTaxUzs = useMemo(
    () => calcMonthlyTouristTaxUzs(state.bookings, state.currency.bcvUzs, activePhysicalCount),
    [state.bookings, state.currency.bcvUzs, activePhysicalCount]
  );
  const daysToTaxDeadline = useMemo(() => getDaysToTouristTaxDeadline(), []);

  // Last 5 cash & change transactions for Discrepancy Debugger
  const recentCashDiscrepancyTx = useMemo(() => {
    return state.transactions
      .filter((t) => t.pocketId === 'cash_uzs' || t.pocketId === 'cash_usd')
      .slice(0, 5);
  }, [state.transactions]);

  // 7-Day Occupancy & Payment Method Analytics
  const analytics = useMemo(() => {
    const today = getTashkentTodayIso();
    const totalUnits = state.physicalRooms
      .filter((r) => !r.archived)
      .reduce((acc, r) => acc + (r.beds ? r.beds.length : 1), 0);

    const days7 = Array.from({ length: 7 }, (_, i) => {
      const iso = addDaysIso(today, i - 3);
      let occupied = 0;
      for (const b of state.bookings) {
        if (b.status === 'cancelled') continue;
        const activeOnDay = b.segments.some((s) => s.fromDate <= iso && s.toDate > iso);
        if (activeOnDay) occupied += 1;
      }
      const pct = totalUnits > 0 ? Math.min(100, Math.round((occupied / totalUnits) * 100)) : 0;
      const col = formatShortDateColumn(iso);
      return {
        iso,
        label: col.dayMonth.slice(0, 2),
        weekday: col.weekday,
        pct,
        isToday: iso === today,
      };
    });

    const methodMap: Record<string, { label: string; usd: number; color: string }> = {
      cash_usd: { label: 'Нал USD', usd: 0, color: '#059669' },
      cash_uzs: { label: 'Нал UZS', usd: 0, color: '#D97706' },
      terminal: { label: 'Терминал', usd: 0, color: '#2563EB' },
      transfer: { label: 'Click/Payme', usd: 0, color: '#7C3AED' },
      cash_eur: { label: 'Нал EUR', usd: 0, color: '#0D9488' },
    };

    for (const p of state.pockets) {
      if (!methodMap[p.id]) continue;
      const usdVal =
        p.currency === 'USD'
          ? p.balance
          : p.currency === 'UZS'
            ? p.balance / Math.max(1, state.currency.accRate)
            : p.balance * (state.currency.cbuEur / Math.max(1, state.currency.cbuUsd));
      methodMap[p.id].usd = Math.max(0, Math.round(usdVal));
    }

    const methods = Object.values(methodMap);
    const totalMethodsUsd = Math.max(
      1,
      methods.reduce((s, m) => s + m.usd, 0)
    );

    const openDebts = state.bookings
      .filter((b) => b.status === 'active')
      .map((b) => ({
        booking: b,
        debtUsd: calcBookingTotals(b).debtUsd,
      }))
      .filter((item) => item.debtUsd > 0);

    const pettyExpenses = state.transactions.filter(
      (t) => t.direction === 'out' && t.label.startsWith('Хозрасход')
    );

    return { days7, methods, totalMethodsUsd, openDebts, pettyExpenses };
  }, [state.physicalRooms, state.bookings, state.pockets, state.currency, state.transactions]);

  const filteredTx = useMemo(() => {
    if (activePocketFilter === 'all') return state.transactions.slice(0, 14);
    return state.transactions.filter((t) => t.pocketId === activePocketFilter).slice(0, 14);
  }, [state.transactions, activePocketFilter]);

  const formatPocketBalance = (currency: CurrencyCode, balance: number) => {
    if (currency === 'UZS') return formatUzs(balance);
    if (currency === 'EUR') return formatEur(balance);
    return formatUsd(balance);
  };

  const handleRecordCalc = () => {
    const recNum = parseFloat(receivedAmount) || 0;
    if (recNum <= 0) return;
    const pocketId: CashPocketId =
      receivedCurrency === 'USD'
        ? 'cash_usd'
        : receivedCurrency === 'EUR'
          ? 'cash_eur'
          : 'cash_uzs';
    recordCashCalculatorTransaction({
      pocketId,
      currency: receivedCurrency,
      receivedAmount: recNum,
      changeUzs: changePreference === 'UZS' ? calcResult.changeUzs : 0,
      changeUsd: changePreference === 'USD' ? calcResult.changeUsd : 0,
      label: calcLabel.trim() || 'Оплата через калькулятор',
    });
  };

  const handlePettySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const amt = parseInt(pettyAmount, 10) || 0;
    if (amt <= 0) return;
    addPettyCashExpense(pettyCategory, amt, pettyNote.trim());
    setPettyNote('');
  };

  const handleSafeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createSafeCollection(
      Math.max(0, parseInt(safeUzs, 10) || 0),
      Math.max(0, parseFloat(safeUsd) || 0),
      Math.max(0, parseFloat(safeEur) || 0)
    );
  };

  const telegramShiftReportText = useMemo(() => {
    const pocketLines = state.pockets
      .map((p) => {
        if (p.id === 'safe' && p.safeBalances) {
          return `• ${p.name}: ${formatUsd(p.safeBalances.USD)} · ${formatUzs(p.safeBalances.UZS)} · ${formatEur(p.safeBalances.EUR)}`;
        }
        return `• ${p.name}: ${formatPocketBalance(p.currency, p.balance)}`;
      })
      .join('\n');
    return [
      `📊 ОТЧЁТ СМЕНЫ · TOPCHAN HOSTEL (${state.adminName})`,
      `Курсы: ЦБ ${state.currency.cbuUsd} | Acc ${state.currency.accRate} | Ex ${state.currency.exRate}`,
      ``,
      `💰 6 карманов кассы:`,
      pocketLines,
      ``,
      `🧾 Сверка стола (факт vs ожидание):`,
      `• UZS: ${formatUzs(denomTotals.totalUzs)} (расхождение: ${diffUzs >= 0 ? '+' : ''}${formatUzs(diffUzs)})`,
      `• USD: ${formatUsd(denomTotals.totalUsd)} (расхождение: ${diffUsd >= 0 ? '+' : ''}${formatUsd(diffUsd)})`,
      ``,
      `🏛 Турсбор РУз (БРВ ${state.currency.bcvUzs.toLocaleString('ru-RU')} · ${activePhysicalCount} комн.): ${formatUzs(monthlyTouristTaxUzs)}`,
    ].join('\n');
  }, [
    state.pockets,
    state.adminName,
    state.currency,
    denomTotals,
    diffUzs,
    diffUsd,
    activePhysicalCount,
    monthlyTouristTaxUzs,
  ]);

  const handlePrintZReport = () => {
    document.body.dataset.printTarget = 'z-report';
    window.print();
    window.setTimeout(() => {
      delete document.body.dataset.printTarget;
    }, 300);
  };

  const adjustUzsBill = (denom: number, delta: number) => {
    setUzsBills((prev) => ({
      ...prev,
      [denom]: Math.max(0, (prev[denom] ?? 0) + delta),
    }));
  };

  const adjustUsdBill = (denom: number, delta: number) => {
    setUsdBills((prev) => ({
      ...prev,
      [denom]: Math.max(0, (prev[denom] ?? 0) + delta),
    }));
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 print:hidden">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[var(--text-primary)]">
            Касса — 6 мультивалютных карманов
          </h1>
          <div className="flex flex-wrap items-center gap-1.5 text-xs sm:text-sm text-[var(--text-muted)] mt-0.5 font-mono tabular-nums">
            <span>
              Acc {state.currency.accRate.toLocaleString('ru-RU')} · Ex{' '}
              {state.currency.exRate.toLocaleString('ru-RU')} · Турсбор за месяц:{' '}
              {formatUzs(monthlyTouristTaxUzs)}
            </span>
            <TooltipHint
              title="Двойной курс Acc / Ex и БРВ"
              text={`Проживание переводится в сумы по курсу Acc (${state.currency.accRate.toLocaleString('ru-RU')}), а сдача в сумах при оплате валютой — по курсу обмена Ex (${state.currency.exRate.toLocaleString('ru-RU')}). Турсбор рассчитывается от БРВ ${state.currency.bcvUzs.toLocaleString('ru-RU')} сум.`}
              align="left"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handlePrintZReport}
            className="px-3.5 py-2 rounded-xl bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] hover:border-[var(--border-strong)] text-[var(--text-primary)] text-xs font-semibold inline-flex items-center gap-2 whitespace-nowrap shrink-0 transition-colors min-h-[38px]"
          >
            <Printer
              className="w-4 h-4 shrink-0"
              strokeWidth={1.75}
              style={{ color: 'var(--tone-emerald-fg)' }}
            />
            Печать акта смены
          </button>
          <CopyButton
            text={telegramShiftReportText}
            label="Отчёт смены (Telegram)"
            variant="primary"
            size="md"
            onCopied={() =>
              pushToast(
                'Отчёт смены скопирован для Telegram',
                'Включены все 6 карманов, сверка и турсбор РУз',
                'emerald'
              )
            }
          />
        </div>
      </div>

      {/* Sub-tab SegmentedControl */}
      <div className="print:hidden">
        <SegmentedControl
          options={CASH_SUBTABS}
          value={subTab}
          onChange={setSubTab}
          layoutId="cashSubTab"
          ariaLabel="Разделы кассы"
        />
      </div>

      {/* SUB-TAB 1: Pockets & Change Calculator */}
      {subTab === 'pockets' && (
        <div className="space-y-6 print:hidden">
          {/* 6 Live Cash Pockets */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {state.pockets.map((pocket) => {
              const isSelected = activePocketFilter === pocket.id;
              return (
                <button
                  key={pocket.id}
                  type="button"
                  onClick={() => setActivePocketFilter(isSelected ? 'all' : pocket.id)}
                  className={`text-left rounded-2xl border p-4 transition-colors ${
                    isSelected
                      ? 'border-[#3B82F6] bg-[var(--bg-hover)]'
                      : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] hover:border-[var(--border-strong)]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-[var(--text-secondary)] truncate">
                      {pocket.name}
                    </span>
                    {pocket.id === 'transfer' && (
                      <StatusPill tone="emerald" icon={ShieldCheck}>
                        Чек
                      </StatusPill>
                    )}
                    {pocket.id === 'safe' && <StatusPill tone="cobalt">3 валюты</StatusPill>}
                  </div>
                  <div className="text-2xl font-bold font-mono tabular-nums text-[var(--text-primary)] mt-2 tracking-tight">
                    {pocket.id === 'safe' && pocket.safeBalances
                      ? formatUsd(pocket.safeBalances.USD)
                      : formatPocketBalance(pocket.currency, pocket.balance)}
                  </div>
                  {pocket.id === 'safe' && pocket.safeBalances ? (
                    <div
                      className="text-xs font-mono tabular-nums mt-1.5 flex flex-wrap gap-x-2 gap-y-0.5 font-medium"
                      style={{ color: 'var(--tone-emerald-fg)' }}
                    >
                      <span>{formatUzs(pocket.safeBalances.UZS)}</span>
                      <span>·</span>
                      <span>{formatEur(pocket.safeBalances.EUR)}</span>
                    </div>
                  ) : (
                    <p className="text-xs text-[var(--text-muted)] mt-1.5 line-clamp-1">
                      {pocket.description}
                    </p>
                  )}
                </button>
              );
            })}
          </div>

          {/* Dual-Rate Change Calculator */}
          <section className="ops-card p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Calculator
                  className="w-4 h-4 shrink-0"
                  strokeWidth={1.75}
                  style={{ color: 'var(--tone-cobalt-fg)' }}
                />
                <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                  Калькулятор сдачи (двойной курс Acc / Ex)
                </h2>
                <TooltipHint
                  title="Как работает двойной курс"
                  text="Счёт за проживание переводится в сумы по курсу Acc (округление вверх до 1 000 сум). Сдача сумами с долларов или евро считается по курсу обмена Ex (округление вниз до 1 000 сум)."
                  align="left"
                />
              </div>
              <StatusPill tone="neutral" mono>
                Acc {state.currency.accRate} / Ex {state.currency.exRate}
              </StatusPill>
            </div>

            {/* Quick-bill presets */}
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-[var(--text-muted)] mr-1">Быстрый счёт:</span>
              {[
                { label: 'Small 1н ($18)', val: '18' },
                { label: 'Small 2н ($36)', val: '36' },
                { label: 'Yellow 2н ($48)', val: '48' },
                { label: 'Green 1н ($34)', val: '34' },
                { label: 'Family 1н ($58)', val: '58' },
              ].map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => setBillInputUsd(p.val)}
                  className="px-2.5 py-1.5 rounded-xl bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] font-mono tabular-nums transition-colors"
                >
                  {p.label}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1.5">
                  Счёт гостя (USD)
                </label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={billInputUsd}
                  onChange={(e) => setBillInputUsd(e.target.value)}
                  className="ops-input w-full px-3 py-2.5 font-mono tabular-nums text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1.5">
                  Валюта от гостя
                </label>
                <select
                  value={receivedCurrency}
                  onChange={(e) => setReceivedCurrency(e.target.value as CurrencyCode)}
                  className="ops-input w-full px-3 py-2.5 text-sm"
                >
                  <option value="USD">USD ($)</option>
                  <option value="UZS">UZS (сум)</option>
                  <option value="EUR">EUR (€)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1.5">
                  Принято ({receivedCurrency})
                </label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={receivedAmount}
                  onChange={(e) => setReceivedAmount(e.target.value)}
                  className="ops-input w-full px-3 py-2.5 font-mono tabular-nums text-sm"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4">
              <div>
                <div className="text-xs text-[var(--text-muted)]">Счёт в сумах (Acc)</div>
                <div className="text-lg font-bold font-mono tabular-nums text-[var(--text-primary)] mt-1">
                  {formatUzs(calcResult.billUzs)}
                </div>
              </div>
              <div>
                <div className="text-xs text-[var(--text-muted)]">Сдача в USD</div>
                <div
                  className="text-lg font-bold font-mono tabular-nums mt-1"
                  style={{ color: 'var(--tone-emerald-fg)' }}
                >
                  {formatUsd(calcResult.changeUsd)}
                </div>
              </div>
              <div>
                <div className="text-xs text-[var(--text-muted)]">Сдача в сумах (Ex)</div>
                <div
                  className="text-lg font-bold font-mono tabular-nums mt-1"
                  style={{ color: 'var(--tone-amber-fg)' }}
                >
                  {formatUzs(calcResult.changeUzs)}
                </div>
              </div>
            </div>

            {calcResult.underpaidUsd > 0 && (
              <div
                className="text-xs font-mono tabular-nums font-semibold"
                style={{ color: 'var(--tone-rose-fg)' }}
              >
                Недостаточно средств: гость должен ещё {formatUsd(calcResult.underpaidUsd)}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <input
                type="text"
                value={calcLabel}
                onChange={(e) => setCalcLabel(e.target.value)}
                placeholder="Назначение платежа"
                className="ops-input flex-1 min-w-[200px] px-3 py-2.5 text-xs"
              />
              <SegmentedControl
                options={CHANGE_PREF_OPTIONS}
                value={changePreference}
                onChange={setChangePreference}
                layoutId="cashChangePref"
                ariaLabel="Валюта выдачи сдачи"
                size="sm"
              />
              <button
                type="button"
                onClick={handleRecordCalc}
                className="px-4 py-2.5 rounded-xl bg-[#059669] hover:bg-[#047857] text-white text-xs font-semibold whitespace-nowrap transition-colors"
              >
                Провести в кассу
              </button>
            </div>
          </section>

          {/* Recent Cash Transactions */}
          <section className="ops-card p-5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                История операций{' '}
                {activePocketFilter !== 'all'
                  ? `· ${state.pockets.find((p) => p.id === activePocketFilter)?.name}`
                  : '(все 6 карманов)'}
              </h2>
              {activePocketFilter !== 'all' && (
                <button
                  type="button"
                  onClick={() => setActivePocketFilter('all')}
                  className="text-xs font-semibold hover:underline"
                  style={{ color: 'var(--tone-cobalt-fg)' }}
                >
                  Показать все
                </button>
              )}
            </div>
            {filteredTx.length === 0 ? (
              <EmptyState
                icon={Wallet}
                title="Операций по этому карману пока нет"
                description="Новые приходы, сдачи, хозрасходы и инкассации появятся здесь сразу после проведения."
              />
            ) : (
              <div className="divide-y divide-[var(--border-subtle)] border border-[var(--border-subtle)] rounded-2xl bg-[var(--bg-elevated)] overflow-hidden">
                {filteredTx.map((tx) => {
                  const pocket = state.pockets.find((p) => p.id === tx.pocketId);
                  return (
                    <div
                      key={tx.id}
                      className="px-4 py-3 flex items-center justify-between gap-3 text-xs"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        {tx.direction === 'in' ? (
                          <ArrowDownLeft
                            className="w-4 h-4 shrink-0"
                            strokeWidth={1.75}
                            style={{ color: 'var(--tone-emerald-fg)' }}
                          />
                        ) : (
                          <ArrowUpRight
                            className="w-4 h-4 shrink-0"
                            strokeWidth={1.75}
                            style={{ color: 'var(--tone-rose-fg)' }}
                          />
                        )}
                        <div className="min-w-0">
                          <div className="text-[var(--text-primary)] font-medium truncate">
                            {tx.label}
                          </div>
                          <div className="text-[var(--text-muted)]">
                            {pocket?.name} · {tx.actor}
                            {tx.receiptVerified ? ' · Чек проверен' : ''}
                          </div>
                        </div>
                      </div>
                      <div
                        className="font-mono tabular-nums font-semibold shrink-0"
                        style={{
                          color:
                            tx.direction === 'in'
                              ? 'var(--tone-emerald-fg)'
                              : 'var(--tone-rose-fg)',
                        }}
                      >
                        {tx.direction === 'in' ? '+' : '−'}
                        {formatPocketBalance(tx.currency, tx.amount)}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      )}

      {/* SUB-TAB 2: Petty Cash & Safe Collection */}
      {subTab === 'expenses_safe' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 print:hidden">
          {/* Petty Cash */}
          <form onSubmit={handlePettySubmit} className="lg:col-span-5 ops-card p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Wallet
                className="w-4 h-4 shrink-0"
                strokeWidth={1.75}
                style={{ color: 'var(--tone-amber-fg)' }}
              />
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                Хозрасходы (из Нал UZS стол)
              </h2>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1.5">Категория</label>
                <select
                  value={pettyCategory}
                  onChange={(e) => setPettyCategory(e.target.value)}
                  className="ops-input w-full px-3 py-2.5 text-xs"
                >
                  <option value="Вода Hydrolife">Вода Hydrolife</option>
                  <option value="Тапочки">Тапочки</option>
                  <option value="Химия">Бытовая химия</option>
                  <option value="Такси">Такси / Доставка</option>
                  <option value="Ремонт">Мелкий ремонт</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1.5">Сумма (UZS)</label>
                <input
                  type="number"
                  min="1000"
                  step="1000"
                  value={pettyAmount}
                  onChange={(e) => setPettyAmount(e.target.value)}
                  placeholder="60000"
                  className="ops-input w-full px-3 py-2.5 font-mono tabular-nums text-xs"
                />
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1.5">
                  Комментарий
                </label>
                <input
                  type="text"
                  value={pettyNote}
                  onChange={(e) => setPettyNote(e.target.value)}
                  placeholder="Например: 2 бутыли 19л"
                  className="ops-input w-full px-3 py-2.5 text-xs"
                />
              </div>
              <button
                type="submit"
                className="w-full py-2.5 rounded-xl bg-[#D97706] hover:bg-[#B45309] text-white text-xs font-semibold transition-colors"
              >
                Списать из кассы UZS
              </button>
            </div>

            {analytics.pettyExpenses.length > 0 && (
              <div className="pt-3 border-t border-[var(--border-subtle)] space-y-2">
                <div className="text-xs font-semibold text-[var(--text-muted)]">
                  Последние хозрасходы
                </div>
                {analytics.pettyExpenses.slice(0, 4).map((tx) => (
                  <div
                    key={tx.id}
                    className="flex items-center justify-between gap-2 text-xs py-1.5"
                  >
                    <span className="text-[var(--text-secondary)] truncate">{tx.label}</span>
                    <span
                      className="font-mono tabular-nums font-semibold shrink-0"
                      style={{ color: 'var(--tone-rose-fg)' }}
                    >
                      −{formatUzs(tx.amount)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </form>

          {/* Safe Collection / Owner Confirm */}
          <div className="lg:col-span-7 ops-card p-5 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Vault
                  className="w-4 h-4 shrink-0"
                  strokeWidth={1.75}
                  style={{ color: 'var(--tone-emerald-fg)' }}
                />
                <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                  Инкассация в сейф владельцу
                </h2>
              </div>
              {(() => {
                const safePocket = state.pockets.find((p) => p.id === 'safe');
                if (!safePocket?.safeBalances) return null;
                return (
                  <StatusPill tone="emerald" mono>
                    Сейф: {formatUsd(safePocket.safeBalances.USD)} ·{' '}
                    {formatUzs(safePocket.safeBalances.UZS)}
                  </StatusPill>
                );
              })()}
            </div>

            <form
              onSubmit={handleSafeSubmit}
              className="grid grid-cols-1 sm:grid-cols-3 gap-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4"
            >
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">UZS (сум)</label>
                <input
                  type="number"
                  min="0"
                  step="50000"
                  value={safeUzs}
                  onChange={(e) => setSafeUzs(e.target.value)}
                  className="ops-input w-full px-3 py-2 font-mono tabular-nums text-xs"
                />
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">USD ($)</label>
                <input
                  type="number"
                  min="0"
                  value={safeUsd}
                  onChange={(e) => setSafeUsd(e.target.value)}
                  className="ops-input w-full px-3 py-2 font-mono tabular-nums text-xs"
                />
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">EUR (€)</label>
                <input
                  type="number"
                  min="0"
                  value={safeEur}
                  onChange={(e) => setSafeEur(e.target.value)}
                  className="ops-input w-full px-3 py-2 font-mono tabular-nums text-xs"
                />
              </div>
              <button
                type="submit"
                className="sm:col-span-3 py-2.5 rounded-xl bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-xs font-semibold transition-colors"
              >
                Сдать в сейф (отправить на подтверждение владельцу)
              </button>
            </form>

            <div className="space-y-2.5">
              {state.safeCollections.map((col) => (
                <div
                  key={col.id}
                  className="p-3.5 rounded-2xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] flex flex-wrap items-center justify-between gap-3 text-xs"
                >
                  <div>
                    <div className="font-mono tabular-nums text-[var(--text-primary)] font-semibold text-sm">
                      {formatUzs(col.amountUzs)} · {formatUsd(col.amountUsd)}
                      {col.amountEur > 0 ? ` · ${formatEur(col.amountEur)}` : ''}
                    </div>
                    <div className="mt-1">
                      <StatusPill tone={col.status === 'confirmed' ? 'emerald' : 'amber'}>
                        {col.status === 'confirmed'
                          ? 'Подтверждено владельцем'
                          : 'Ожидает подтверждения'}
                      </StatusPill>
                    </div>
                  </div>
                  {col.status === 'pending' ? (
                    <button
                      type="button"
                      onClick={() => confirmSafeCollection(col.id)}
                      className="px-3.5 py-2 rounded-xl bg-[#059669] hover:bg-[#047857] text-white text-xs font-semibold transition-colors"
                    >
                      Подтвердить (владелец)
                    </button>
                  ) : (
                    <CheckCircle2
                      className="w-5 h-5 shrink-0"
                      strokeWidth={1.75}
                      style={{ color: 'var(--tone-emerald-fg)' }}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* SUB-TAB 3: 60-Second Shift Handover Counter */}
      {subTab === 'handover' && (
        <div className="space-y-5 print:hidden">
          {/* Live Actual vs Expected Summary Tiles */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <MetricTile
              label="UZS · Факт в ящике"
              value={formatUzs(denomTotals.totalUzs)}
              subtext={`Ожидание: ${formatUzs(expectedCashUzs)}`}
              tone="neutral"
            />
            <MetricTile
              label="UZS · Расхождение"
              value={
                diffUzs === 0
                  ? 'Сходится в 0'
                  : `${diffUzs > 0 ? '+' : ''}${formatUzs(diffUzs)}`
              }
              subtext={diffUzs === 0 ? 'Касса сумов точна' : 'Проверьте последние сдачи'}
              tone={diffUzs === 0 ? 'emerald' : 'rose'}
            />
            <MetricTile
              label="USD · Факт в ящике"
              value={formatUsd(denomTotals.totalUsd)}
              subtext={`Ожидание: ${formatUsd(expectedCashUsd)}`}
              tone="neutral"
            />
            <MetricTile
              label="USD · Расхождение"
              value={
                diffUsd === 0
                  ? 'Сходится в 0'
                  : `${diffUsd > 0 ? '+' : ''}${formatUsd(diffUsd)}`
              }
              subtext={diffUsd === 0 ? 'Касса долларов точна' : 'Проверьте оплаты налом'}
              tone={diffUsd === 0 ? 'emerald' : 'rose'}
            />
          </div>

          <section className="ops-card p-5 space-y-5">
            <div>
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                Пересчёт купюр за 60 секунд
              </h2>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">
                Используйте кнопки − / + или введите количество купюр каждого номинала
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {/* UZS Bills with +/- steppers */}
              <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4 space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-[var(--text-primary)]">
                    Купюры UZS (стол)
                  </span>
                  <span className="font-mono tabular-nums text-[var(--text-muted)]">
                    План: {formatUzs(expectedCashUzs)}
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {UZS_DENOMINATIONS.map((denom) => {
                    const qty = uzsBills[denom] ?? 0;
                    return (
                      <div
                        key={denom}
                        className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2.5 space-y-1.5"
                      >
                        <div className="flex items-center justify-between text-xs font-mono tabular-nums">
                          <span className="font-semibold text-[var(--text-primary)]">
                            {(denom / 1000).toFixed(0)} 000 сум
                          </span>
                          <span className="text-[var(--text-muted)]">
                            {formatUzs(qty * denom)}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            aria-label={`Уменьшить купюры ${denom} сум`}
                            onClick={() => adjustUzsBill(denom, -1)}
                            className="w-8 h-8 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] text-[var(--text-primary)] flex items-center justify-center shrink-0 transition-colors"
                          >
                            <Minus className="w-3.5 h-3.5" strokeWidth={1.75} />
                          </button>
                          <input
                            type="number"
                            min="0"
                            aria-label={`Количество купюр ${denom} сум`}
                            value={qty}
                            onChange={(e) =>
                              setUzsBills((prev) => ({
                                ...prev,
                                [denom]: Math.max(0, parseInt(e.target.value, 10) || 0),
                              }))
                            }
                            className="ops-input flex-1 min-w-0 h-8 px-2 text-center font-mono tabular-nums text-sm font-semibold"
                          />
                          <button
                            type="button"
                            aria-label={`Увеличить купюры ${denom} сум`}
                            onClick={() => adjustUzsBill(denom, 1)}
                            className="w-8 h-8 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] text-[var(--text-primary)] flex items-center justify-center shrink-0 transition-colors"
                          >
                            <Plus className="w-3.5 h-3.5" strokeWidth={1.75} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* USD Bills with +/- steppers */}
              <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4 space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-[var(--text-primary)]">Купюры USD</span>
                  <span className="font-mono tabular-nums text-[var(--text-muted)]">
                    План: {formatUsd(expectedCashUsd)}
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {USD_DENOMINATIONS.map((denom) => {
                    const qty = usdBills[denom] ?? 0;
                    return (
                      <div
                        key={denom}
                        className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2.5 space-y-1.5"
                      >
                        <div className="flex items-center justify-between text-xs font-mono tabular-nums">
                          <span className="font-semibold text-[var(--text-primary)]">
                            ${denom}
                          </span>
                          <span className="text-[var(--text-muted)]">
                            {formatUsd(qty * denom)}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            aria-label={`Уменьшить купюры ${denom} долларов`}
                            onClick={() => adjustUsdBill(denom, -1)}
                            className="w-8 h-8 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] text-[var(--text-primary)] flex items-center justify-center shrink-0 transition-colors"
                          >
                            <Minus className="w-3.5 h-3.5" strokeWidth={1.75} />
                          </button>
                          <input
                            type="number"
                            min="0"
                            aria-label={`Количество купюр ${denom} долларов`}
                            value={qty}
                            onChange={(e) =>
                              setUsdBills((prev) => ({
                                ...prev,
                                [denom]: Math.max(0, parseInt(e.target.value, 10) || 0),
                              }))
                            }
                            className="ops-input flex-1 min-w-0 h-8 px-2 text-center font-mono tabular-nums text-sm font-semibold"
                          />
                          <button
                            type="button"
                            aria-label={`Увеличить купюры ${denom} долларов`}
                            onClick={() => adjustUsdBill(denom, 1)}
                            className="w-8 h-8 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] text-[var(--text-primary)] flex items-center justify-center shrink-0 transition-colors"
                          >
                            <Plus className="w-3.5 h-3.5" strokeWidth={1.75} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Cash Discrepancy Debugger */}
            {(diffUzs !== 0 || diffUsd !== 0) && (
              <div
                className="rounded-2xl border p-4 space-y-3"
                style={{
                  backgroundColor: 'var(--tone-rose-bg)',
                  borderColor: 'var(--tone-rose-border)',
                }}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div
                    className="flex items-center gap-2 text-xs font-semibold"
                    style={{ color: 'var(--tone-rose-fg)' }}
                  >
                    <AlertTriangle className="w-4 h-4 shrink-0" strokeWidth={1.75} />
                    <span>Отладчик расхождений · Последние 5 операций с наличными и сдачей</span>
                  </div>
                  <StatusPill tone="rose" mono>
                    {[
                      diffUzs !== 0 ? `UZS ${diffUzs > 0 ? '+' : ''}${formatUzs(diffUzs)}` : '',
                      diffUsd !== 0 ? `USD ${diffUsd > 0 ? '+' : ''}${formatUsd(diffUsd)}` : '',
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </StatusPill>
                </div>
                <div className="divide-y divide-[var(--border-subtle)] rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] overflow-hidden">
                  {recentCashDiscrepancyTx.map((tx) => (
                    <div
                      key={tx.id}
                      className="px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs"
                    >
                      <div className="min-w-0">
                        <div className="text-[var(--text-primary)] font-medium truncate">
                          {tx.label}
                        </div>
                        <div className="text-[var(--text-muted)]">
                          {tx.pocketId === 'cash_usd' ? 'Нал USD' : 'Нал UZS'} · {tx.actor}
                        </div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span
                          className="font-mono tabular-nums font-semibold"
                          style={{
                            color:
                              tx.direction === 'in'
                                ? 'var(--tone-emerald-fg)'
                                : 'var(--tone-rose-fg)',
                          }}
                        >
                          {tx.direction === 'in' ? '+' : '−'}
                          {formatPocketBalance(tx.currency, tx.amount)}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            if (tx.bookingId) {
                              setActiveTab('grid');
                              openBookingFolio(tx.bookingId);
                            } else {
                              setActivePocketFilter(tx.pocketId);
                              setSubTab('pockets');
                              pushToast(
                                'Фильтр применён',
                                `Показаны операции кармана`,
                                'cobalt'
                              );
                            }
                          }}
                          className="px-2.5 py-1.5 rounded-xl bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-[var(--text-primary)] font-medium inline-flex items-center gap-1 transition-colors"
                        >
                          <ExternalLink className="w-3 h-3" strokeWidth={1.75} />
                          Проверить
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        </div>
      )}

      {/* SUB-TAB 4: Analytics & Print */}
      {subTab === 'analytics' && (
        <div className="space-y-5 print:hidden">
          <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* 7-Day Occupancy SVG Bar Chart */}
            <div className="ops-card p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-semibold text-[var(--text-primary)]">
                  <BarChart3
                    className="w-4 h-4 shrink-0"
                    strokeWidth={1.75}
                    style={{ color: 'var(--tone-emerald-fg)' }}
                  />
                  <span>Загрузка за 7 дней (%)</span>
                </div>
                <StatusPill tone="emerald" mono>
                  Сегодня: {analytics.days7.find((d) => d.isToday)?.pct ?? 0}%
                </StatusPill>
              </div>
              <svg
                viewBox="0 0 280 112"
                className="w-full h-32"
                role="img"
                aria-label="График загрузки хостела за 7 дней"
              >
                {analytics.days7.map((d, idx) => {
                  const x = 10 + idx * 38;
                  const barH = Math.max(8, Math.round((d.pct / 100) * 66));
                  const y = 80 - barH;
                  return (
                    <g key={d.iso}>
                      <rect
                        x={x}
                        y={14}
                        width={24}
                        height={66}
                        rx={6}
                        fill="var(--bg-elevated)"
                      />
                      <rect
                        x={x}
                        y={y}
                        width={24}
                        height={barH}
                        rx={6}
                        fill={d.isToday ? '#059669' : '#2563EB'}
                        opacity={d.isToday ? 1 : 0.78}
                      />
                      <text
                        x={x + 12}
                        y={y - 4}
                        textAnchor="middle"
                        fill="var(--text-secondary)"
                        fontSize="9"
                        fontFamily="monospace"
                      >
                        {d.pct}%
                      </text>
                      <text
                        x={x + 12}
                        y={96}
                        textAnchor="middle"
                        fill={d.isToday ? 'var(--tone-emerald-fg)' : 'var(--text-muted)'}
                        fontSize="9"
                        fontWeight={d.isToday ? '700' : '500'}
                      >
                        {d.weekday}
                      </text>
                      <text
                        x={x + 12}
                        y={108}
                        textAnchor="middle"
                        fill="var(--text-muted)"
                        fontSize="8"
                        fontFamily="monospace"
                      >
                        {d.label}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>

            {/* Payment Method Split SVG Stacked Chart */}
            <div className="ops-card p-4 space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-[var(--text-primary)]">
                  Структура кассы по методам
                </span>
                <span className="font-mono tabular-nums text-[var(--text-secondary)] font-semibold">
                  ≈ {formatUsd(analytics.totalMethodsUsd)}
                </span>
              </div>
              <svg
                viewBox="0 0 280 22"
                className="w-full h-6 rounded-xl overflow-hidden"
                role="img"
                aria-label="Разбивка кассы по способам оплаты"
              >
                {(() => {
                  let cursor = 0;
                  return analytics.methods.map((m) => {
                    const w = (m.usd / analytics.totalMethodsUsd) * 280;
                    const el = (
                      <rect
                        key={m.label}
                        x={cursor}
                        y={0}
                        width={Math.max(0, w)}
                        height={22}
                        fill={m.color}
                      />
                    );
                    cursor += w;
                    return el;
                  });
                })()}
              </svg>
              <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                {analytics.methods.map((m) => (
                  <div key={m.label} className="flex items-center justify-between gap-1">
                    <span className="inline-flex items-center gap-1.5 text-[var(--text-secondary)] truncate">
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: m.color }}
                      />
                      {m.label}
                    </span>
                    <span className="font-mono tabular-nums text-[var(--text-primary)] font-semibold">
                      ${m.usd}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Uzbekistan Monthly Tourist Tax Progress */}
            <div className="ops-card p-4 flex flex-col justify-between space-y-3">
              <div className="flex items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-1.5 font-semibold text-[var(--text-primary)]">
                  <span>Турсбор РУз (до {daysToTaxDeadline.deadlineLabel})</span>
                  <TooltipHint
                    title="Туристический сбор (БРВ)"
                    text={`Базовая расчётная величина (БРВ) — ${state.currency.bcvUzs.toLocaleString('ru-RU')} сум. Ставка зависит от числа комнат: до 10 номеров — 5% БРВ, 11–40 номеров — 10% БРВ за иностранного гостя в сутки.`}
                    align="right"
                  />
                </div>
                <StatusPill tone={daysToTaxDeadline.daysLeft <= 5 ? 'rose' : 'amber'} mono>
                  {daysToTaxDeadline.daysLeft} дн.
                </StatusPill>
              </div>
              <div>
                <div className="text-2xl font-bold font-mono tabular-nums text-[var(--text-primary)]">
                  {formatUzs(monthlyTouristTaxUzs)}
                </div>
                <div className="text-xs text-[var(--text-muted)] mt-1 font-mono tabular-nums">
                  БРВ {state.currency.bcvUzs.toLocaleString('ru-RU')} · {activePhysicalCount} комн. (
                  {activePhysicalCount <= 10 ? '5%' : activePhysicalCount <= 40 ? '10%' : '15%'})
                </div>
              </div>
              <div className="space-y-1.5">
                <svg viewBox="0 0 280 10" className="w-full h-2.5 rounded-full overflow-hidden">
                  <rect x={0} y={0} width={280} height={10} fill="var(--bg-elevated)" />
                  <rect
                    x={0}
                    y={0}
                    width={Math.max(
                      16,
                      Math.min(280, Math.round((daysToTaxDeadline.monthProgressPct / 100) * 280))
                    )}
                    height={10}
                    rx={5}
                    fill={daysToTaxDeadline.daysLeft <= 5 ? '#E11D48' : '#059669'}
                  />
                </svg>
                <div className="flex justify-between text-xs text-[var(--text-muted)]">
                  <span>Накоплено за период</span>
                  <span>Срок оплаты: {daysToTaxDeadline.deadlineLabel}</span>
                </div>
              </div>
            </div>
          </section>

          {/* Print & Export Card */}
          <section className="ops-card p-5 flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1">
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                Акт передачи смены (Z-отчёт) и отправка в Telegram
              </h2>
              <p className="text-xs text-[var(--text-muted)]">
                Печатная форма автоматически оформляется в чёрно-белом стиле для термо- или
                лазерного принтера независимо от текущей темы экрана.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handlePrintZReport}
                className="px-4 py-2.5 rounded-xl bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] border border-[var(--border-strong)] text-xs font-semibold text-[var(--text-primary)] inline-flex items-center gap-2 transition-colors"
              >
                <Printer className="w-4 h-4" strokeWidth={1.75} />
                Печать / PDF акта смены
              </button>
              <CopyButton
                text={telegramShiftReportText}
                label="Скопировать отчёт смены"
                variant="primary"
                size="md"
                onCopied={() =>
                  pushToast(
                    'Отчёт смены скопирован для Telegram',
                    'Включены все 6 карманов, сверка и турсбор РУз',
                    'emerald'
                  )
                }
              />
            </div>
          </section>
        </div>
      )}

      {/* Printable Z-Report Sheet (Always mounted for @media print regardless of active sub-tab) */}
      <section
        id="printable-z-report"
        className="hidden print:block bg-white text-slate-950 p-6 space-y-4 border border-slate-300"
      >
        <div className="flex items-start justify-between border-b-2 border-slate-900 pb-3">
          <div>
            <h2 className="text-xl font-bold">
              {state.integrations.propertyName} — Акт смены (Z-Report)
            </h2>
            <p className="text-xs text-slate-600">
              Дата: {formatTashkentDateRu()} · Администратор: {state.adminName}
            </p>
          </div>
          <div className="text-right font-mono text-xs tabular-nums">
            <div>ЦБ USD: {state.currency.cbuUsd}</div>
            <div>
              Acc: {state.currency.accRate} · Ex: {state.currency.exRate}
            </div>
          </div>
        </div>

        <div>
          <h3 className="text-sm font-bold mb-1.5">1. Балансы 6 карманов кассы</h3>
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-400 text-left">
                <th className="py-1">Карман</th>
                <th className="py-1 text-right">Баланс</th>
              </tr>
            </thead>
            <tbody>
              {state.pockets.map((p) => (
                <tr key={p.id} className="border-b border-slate-200">
                  <td className="py-1">{p.name}</td>
                  <td className="py-1 text-right font-mono tabular-nums font-semibold">
                    {p.id === 'safe' && p.safeBalances
                      ? `${formatUsd(p.safeBalances.USD)} / ${formatUzs(p.safeBalances.UZS)} / ${formatEur(p.safeBalances.EUR)}`
                      : formatPocketBalance(p.currency, p.balance)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="grid grid-cols-2 gap-4 text-xs">
          <div className="border border-slate-300 p-2.5">
            <h3 className="font-bold mb-1">2. Сверка купюр (Факт vs Ожидание)</h3>
            <div className="font-mono tabular-nums">
              UZS факт: {formatUzs(denomTotals.totalUzs)} (план: {formatUzs(expectedCashUzs)},
              расхождение: {diffUzs})
            </div>
            <div className="font-mono tabular-nums">
              USD факт: {formatUsd(denomTotals.totalUsd)} (план: {formatUsd(expectedCashUsd)},
              расхождение: {diffUsd})
            </div>
          </div>
          <div className="border border-slate-300 p-2.5">
            <h3 className="font-bold mb-1">3. Турсбор РУз и открытые долги</h3>
            <div className="font-mono tabular-nums">
              Турсбор (БРВ {state.currency.bcvUzs}): {formatUzs(monthlyTouristTaxUzs)}
            </div>
            <div className="font-mono tabular-nums">
              Открытых долгов: {analytics.openDebts.length} ·{' '}
              {formatUsd(analytics.openDebts.reduce((s, d) => s + d.debtUsd, 0))}
            </div>
          </div>
        </div>

        <div className="text-xs">
          <h3 className="font-bold mb-1">4. Хозрасходы и инкассации смены</h3>
          <div>Хозрасходов: {analytics.pettyExpenses.length}</div>
          <div>Инкассаций в сейф: {state.safeCollections.length}</div>
        </div>

        <div className="pt-6 flex justify-between text-xs border-t border-slate-300">
          <span>Смену сдал: ________________ ({state.adminName})</span>
          <span>Смену принял: ________________</span>
        </div>
      </section>
    </div>
  );
};
