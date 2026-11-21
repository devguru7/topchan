import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  BarChart3,
  Calculator,
  CheckCircle2,
  ClipboardCopy,
  ExternalLink,
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

export const CashTab: React.FC = () => {
  const {
    state,
    addPettyCashExpense,
    recordCashCalculatorTransaction,
    createSafeCollection,
    confirmSafeCollection,
    setSelectedBookingId,
    setActiveTab,
    pushToast,
  } = useOps();

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

  // 7-Day Occupancy & Payment Method Analytics (pure computed data for inline SVG)
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
      return { iso, label: col.dayMonth.slice(0, 2), weekday: col.weekday, pct, isToday: iso === today };
    });

    const methodMap: Record<string, { label: string; usd: number; color: string }> = {
      cash_usd: { label: 'Нал USD', usd: 0, color: '#10B981' },
      cash_uzs: { label: 'Нал UZS', usd: 0, color: '#F59E0B' },
      terminal: { label: 'Терминал', usd: 0, color: '#3B82F6' },
      transfer: { label: 'Click/Payme', usd: 0, color: '#8B5CF6' },
      cash_eur: { label: 'Нал EUR', usd: 0, color: '#06B6D4' },
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

  const handleCopyShiftReport = () => {
    const pocketLines = state.pockets
      .map((p) => {
        if (p.id === 'safe' && p.safeBalances) {
          return `• ${p.name}: ${formatUsd(p.safeBalances.USD)} · ${formatUzs(p.safeBalances.UZS)} · ${formatEur(p.safeBalances.EUR)}`;
        }
        return `• ${p.name}: ${formatPocketBalance(p.currency, p.balance)}`;
      })
      .join('\n');
    const report = [
      `📊 ОТЧЁТ СМЕНЫ · TOPCHAN HOSTEL (${state.adminName})`,
      `Курсы: ЦБ ${state.currency.cbuUsd} | Acc ${state.currency.accRate} | Ex ${state.currency.exRate}`,
      ``,
      `💰 6 карманов кассы:`,
      pocketLines,
      ``,
      `🧾 Сверка стола (факт vs план):`,
      `• UZS: ${formatUzs(denomTotals.totalUzs)} (расхождение: ${diffUzs >= 0 ? '+' : ''}${formatUzs(diffUzs)})`,
      `• USD: ${formatUsd(denomTotals.totalUsd)} (расхождение: ${diffUsd >= 0 ? '+' : ''}${formatUsd(diffUsd)})`,
      ``,
      `🏛 Турсбор РУз (БРВ ${state.currency.bcvUzs.toLocaleString('ru-RU')} · ${activePhysicalCount} комн.): ${formatUzs(monthlyTouristTaxUzs)}`,
    ].join('\n');

    navigator.clipboard?.writeText(report).catch(() => {});
    pushToast('Отчёт смены скопирован для Telegram', 'Включены все 6 карманов, сверка и турсбор РУз', 'emerald');
  };

  const handlePrintZReport = () => {
    document.body.dataset.printTarget = 'z-report';
    window.print();
    window.setTimeout(() => {
      delete document.body.dataset.printTarget;
    }, 300);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 print:hidden">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white">
            Касса — 6 мультивалютных карманов
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 mt-0.5 font-mono tabular-nums">
            Acc: {state.currency.accRate.toLocaleString('ru-RU')} сум · Ex:{' '}
            {state.currency.exRate.toLocaleString('ru-RU')} сум · Турсбор за месяц:{' '}
            {formatUzs(monthlyTouristTaxUzs)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handlePrintZReport}
            className="px-3.5 py-2.5 rounded-lg bg-[#121826] hover:bg-[#1A2234] border border-white/[0.1] text-slate-100 text-xs font-semibold inline-flex items-center gap-2 whitespace-nowrap shrink-0 transition-colors"
          >
            <Printer className="w-4 h-4 text-[#10B981]" />
            Печать / PDF акта смены
          </button>
          <button
            type="button"
            onClick={handleCopyShiftReport}
            className="px-4 py-2.5 rounded-lg bg-[#3B82F6] hover:bg-blue-500 text-white text-sm font-semibold inline-flex items-center gap-2 whitespace-nowrap shrink-0 transition-colors"
          >
            <ClipboardCopy className="w-4 h-4" />
            Скопировать отчёт смены для Telegram
          </button>
        </div>
      </div>

      {/* 6 Live Cash Pockets */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {state.pockets.map((pocket) => {
          const isSelected = activePocketFilter === pocket.id;
          return (
            <button
              key={pocket.id}
              type="button"
              onClick={() => setActivePocketFilter(isSelected ? 'all' : pocket.id)}
              className={`text-left bg-[#121826] hover:bg-[#1A2234] border rounded-xl p-4 transition-colors ${
                isSelected ? 'border-[#3B82F6]' : 'border-white/[0.08]'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-slate-300 truncate">{pocket.name}</span>
                {pocket.id === 'transfer' && (
                  <span className="text-xs text-[#10B981] inline-flex items-center gap-1 shrink-0">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    Чек
                  </span>
                )}
              </div>
              <div className="text-xl font-bold font-mono tabular-nums text-white mt-2">
                {pocket.id === 'safe' && pocket.safeBalances
                  ? formatUsd(pocket.safeBalances.USD)
                  : formatPocketBalance(pocket.currency, pocket.balance)}
              </div>
              {pocket.id === 'safe' && pocket.safeBalances ? (
                <div className="text-xs font-mono tabular-nums text-emerald-300/90 mt-1 flex flex-wrap gap-x-2 gap-y-0.5">
                  <span>{formatUzs(pocket.safeBalances.UZS)}</span>
                  <span>·</span>
                  <span>{formatEur(pocket.safeBalances.EUR)}</span>
                </div>
              ) : (
                <p className="text-xs text-slate-400 mt-1 line-clamp-1">{pocket.description}</p>
              )}
            </button>
          );
        })}
      </div>

      {/* Dual-Rate Change Calculator + Petty Cash + Safe Collection */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Dual-Rate Change Calculator */}
        <section className="lg:col-span-7 bg-[#121826] border border-white/[0.08] rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Calculator className="w-4 h-4 text-[#3B82F6]" />
              <h2 className="text-sm font-semibold text-white">
                Калькулятор сдачи (двойной курс Acc / Ex)
              </h2>
            </div>
            <span className="text-xs text-slate-400 font-mono tabular-nums">
              Acc {state.currency.accRate} / Ex {state.currency.exRate}
            </span>
          </div>

          {/* Quick-bill presets */}
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-slate-400 mr-1">Быстрый счёт:</span>
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
                className="px-2.5 py-1 rounded-lg bg-[#0B0F17] hover:bg-[#1A2234] border border-white/[0.08] text-slate-300 hover:text-white font-mono tabular-nums transition-colors"
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Счёт гостя (USD)</label>
              <input
                type="number"
                min="0"
                step="any"
                value={billInputUsd}
                onChange={(e) => setBillInputUsd(e.target.value)}
                className="w-full bg-[#0B0F17] border border-white/[0.1] rounded-lg px-3 py-2 font-mono tabular-nums text-sm text-white"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Валюта от гостя</label>
              <select
                value={receivedCurrency}
                onChange={(e) => setReceivedCurrency(e.target.value as CurrencyCode)}
                className="w-full bg-[#0B0F17] border border-white/[0.1] rounded-lg px-3 py-2 text-sm text-white"
              >
                <option value="USD">USD ($)</option>
                <option value="UZS">UZS (сум)</option>
                <option value="EUR">EUR (€)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">
                Принято ({receivedCurrency})
              </label>
              <input
                type="number"
                min="0"
                step="any"
                value={receivedAmount}
                onChange={(e) => setReceivedAmount(e.target.value)}
                className="w-full bg-[#0B0F17] border border-white/[0.1] rounded-lg px-3 py-2 font-mono tabular-nums text-sm text-white"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-[#0B0F17] border border-white/[0.08] rounded-xl p-4">
            <div>
              <div className="text-xs text-slate-400">Счёт в сумах (Acc)</div>
              <div className="text-base font-semibold font-mono tabular-nums text-white mt-0.5">
                {formatUzs(calcResult.billUzs)}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-400">Сдача в USD</div>
              <div className="text-base font-semibold font-mono tabular-nums text-[#10B981] mt-0.5">
                {formatUsd(calcResult.changeUsd)}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-400">Сдача в сумах (Ex)</div>
              <div className="text-base font-semibold font-mono tabular-nums text-[#F59E0B] mt-0.5">
                {formatUzs(calcResult.changeUzs)}
              </div>
            </div>
          </div>

          {calcResult.underpaidUsd > 0 && (
            <div className="text-xs text-[#F43F5E] font-mono tabular-nums">
              Недостаточно средств: гость должен ещё {formatUsd(calcResult.underpaidUsd)}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <input
              type="text"
              value={calcLabel}
              onChange={(e) => setCalcLabel(e.target.value)}
              placeholder="Назначение платежа"
              className="flex-1 min-w-[180px] bg-[#0B0F17] border border-white/[0.1] rounded-lg px-3 py-2 text-xs text-white"
            />
            <div className="inline-flex p-1 bg-[#0B0F17] border border-white/[0.08] rounded-lg text-xs">
              <button
                type="button"
                onClick={() => setChangePreference('UZS')}
                className={`px-2.5 py-1 rounded-md ${
                  changePreference === 'UZS' ? 'bg-[#1A2234] text-white' : 'text-slate-400'
                }`}
              >
                Сдача UZS
              </button>
              <button
                type="button"
                onClick={() => setChangePreference('USD')}
                className={`px-2.5 py-1 rounded-md ${
                  changePreference === 'USD' ? 'bg-[#1A2234] text-white' : 'text-slate-400'
                }`}
              >
                Сдача USD
              </button>
            </div>
            <button
              type="button"
              onClick={handleRecordCalc}
              className="px-4 py-2 rounded-lg bg-[#10B981] hover:bg-emerald-600 text-slate-950 text-xs font-semibold whitespace-nowrap transition-colors"
            >
              Провести в кассу
            </button>
          </div>

          <div className="pt-2 border-t border-white/[0.06] text-xs text-slate-400 font-mono tabular-nums">
            Округление: проживание вверх до 1 000 сум (Acc) · сдача вниз до 1 000 сум (Ex)
          </div>
        </section>

        {/* Petty Cash + Safe Collection */}
        <section className="lg:col-span-5 space-y-5">
          {/* Petty Cash */}
          <form
            onSubmit={handlePettySubmit}
            className="bg-[#121826] border border-white/[0.08] rounded-2xl p-5 space-y-3"
          >
            <div className="flex items-center gap-2">
              <Wallet className="w-4 h-4 text-[#F59E0B]" />
              <h2 className="text-sm font-semibold text-white">Хозрасходы (из Нал UZS стол)</h2>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <select
                value={pettyCategory}
                onChange={(e) => setPettyCategory(e.target.value)}
                className="bg-[#0B0F17] border border-white/[0.1] rounded-lg px-3 py-2 text-xs text-white"
              >
                <option value="Вода Hydrolife">Вода Hydrolife</option>
                <option value="Тапочки">Тапочки</option>
                <option value="Химия">Бытовая химия</option>
                <option value="Такси">Такси / Доставка</option>
                <option value="Ремонт">Мелкий ремонт</option>
              </select>
              <input
                type="number"
                min="1000"
                step="1000"
                value={pettyAmount}
                onChange={(e) => setPettyAmount(e.target.value)}
                placeholder="Сумма UZS"
                className="bg-[#0B0F17] border border-white/[0.1] rounded-lg px-3 py-2 font-mono tabular-nums text-xs text-white"
              />
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={pettyNote}
                onChange={(e) => setPettyNote(e.target.value)}
                placeholder="Комментарий (напр. 2 бутыли 19л)"
                className="flex-1 bg-[#0B0F17] border border-white/[0.1] rounded-lg px-3 py-2 text-xs text-white"
              />
              <button
                type="submit"
                className="px-4 py-2 rounded-lg bg-[#F59E0B] hover:bg-amber-600 text-slate-950 text-xs font-semibold whitespace-nowrap"
              >
                Списать
              </button>
            </div>
          </form>

          {/* Safe Collection / Owner Confirm */}
          <div className="bg-[#121826] border border-white/[0.08] rounded-2xl p-5 space-y-3">
            <div className="flex items-center gap-2">
              <Vault className="w-4 h-4 text-[#10B981]" />
              <h2 className="text-sm font-semibold text-white">Сейф / Инкассация владельцу</h2>
            </div>
            <form onSubmit={handleSafeSubmit} className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-xs text-slate-400 mb-1">UZS</label>
                <input
                  type="number"
                  min="0"
                  step="50000"
                  value={safeUzs}
                  onChange={(e) => setSafeUzs(e.target.value)}
                  className="w-full bg-[#0B0F17] border border-white/[0.1] rounded-lg px-2.5 py-1.5 font-mono text-xs text-white"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">USD</label>
                <input
                  type="number"
                  min="0"
                  value={safeUsd}
                  onChange={(e) => setSafeUsd(e.target.value)}
                  className="w-full bg-[#0B0F17] border border-white/[0.1] rounded-lg px-2.5 py-1.5 font-mono text-xs text-white"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">EUR</label>
                <input
                  type="number"
                  min="0"
                  value={safeEur}
                  onChange={(e) => setSafeEur(e.target.value)}
                  className="w-full bg-[#0B0F17] border border-white/[0.1] rounded-lg px-2.5 py-1.5 font-mono text-xs text-white"
                />
              </div>
              <button
                type="submit"
                className="col-span-3 py-2 rounded-lg bg-[#1A2234] hover:bg-slate-700 text-xs font-semibold text-white border border-white/[0.08]"
              >
                Сдать владельцу (отправить на подтверждение)
              </button>
            </form>

            <div className="space-y-2 pt-1">
              {state.safeCollections.map((col) => (
                <div
                  key={col.id}
                  className="p-3 rounded-xl bg-[#0B0F17] border border-white/[0.08] flex flex-wrap items-center justify-between gap-2 text-xs"
                >
                  <div>
                    <div className="font-mono tabular-nums text-white font-medium">
                      {formatUzs(col.amountUzs)} · {formatUsd(col.amountUsd)}
                      {col.amountEur > 0 ? ` · €${col.amountEur}` : ''}
                    </div>
                    <div
                      className={
                        col.status === 'confirmed' ? 'text-[#10B981]' : 'text-[#F59E0B]'
                      }
                    >
                      {col.status === 'confirmed'
                        ? 'Подтверждено владельцем'
                        : 'Ожидает подтверждения'}
                    </div>
                  </div>
                  {col.status === 'pending' ? (
                    <button
                      type="button"
                      onClick={() => confirmSafeCollection(col.id)}
                      className="px-3 py-1.5 rounded-lg bg-[#10B981] hover:bg-emerald-600 text-slate-950 text-xs font-semibold"
                    >
                      Подтвердить (как владелец)
                    </button>
                  ) : (
                    <CheckCircle2 className="w-4 h-4 text-[#10B981]" />
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>

      {/* 60-Second Denomination Counter */}
      <section className="bg-[#121826] border border-white/[0.08] rounded-2xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-white">
              Сдача смены за 60 секунд — пересчёт купюр
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Введите количество купюр в ящике — система мгновенно сравнит факт с ожидаемым остатком
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-4 text-xs font-mono tabular-nums">
            <span className={diffUzs === 0 ? 'text-[#10B981]' : 'text-[#F43F5E]'}>
              UZS: {diffUzs === 0 ? 'Сходится в 0' : `${diffUzs > 0 ? '+' : ''}${formatUzs(diffUzs)}`}
            </span>
            <span className={diffUsd === 0 ? 'text-[#10B981]' : 'text-[#F43F5E]'}>
              USD: {diffUsd === 0 ? 'Сходится в 0' : `${diffUsd > 0 ? '+' : ''}${formatUsd(diffUsd)}`}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* UZS Bills */}
          <div className="bg-[#0B0F17] border border-white/[0.08] rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-white">Купюры UZS (стол)</span>
              <span className="font-mono tabular-nums text-slate-400">
                План: {formatUzs(expectedCashUzs)}
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {UZS_DENOMINATIONS.map((denom) => (
                <label key={denom} className="block space-y-1">
                  <span className="text-xs font-mono text-slate-400">
                    {(denom / 1000).toFixed(0)} 000 сум
                  </span>
                  <input
                    type="number"
                    min="0"
                    value={uzsBills[denom] ?? 0}
                    onChange={(e) =>
                      setUzsBills((prev) => ({
                        ...prev,
                        [denom]: Math.max(0, parseInt(e.target.value, 10) || 0),
                      }))
                    }
                    className="w-full bg-[#121826] border border-white/[0.1] rounded-lg px-3 py-1.5 font-mono tabular-nums text-sm text-white"
                  />
                </label>
              ))}
            </div>
            <div className="flex items-center justify-between pt-2 border-t border-white/[0.06] text-xs font-mono tabular-nums">
              <span className="text-slate-400">Факт в кассе:</span>
              <span className="text-sm font-bold text-white">{formatUzs(denomTotals.totalUzs)}</span>
            </div>
          </div>

          {/* USD Bills */}
          <div className="bg-[#0B0F17] border border-white/[0.08] rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-white">Купюры USD</span>
              <span className="font-mono tabular-nums text-slate-400">
                План: {formatUsd(expectedCashUsd)}
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {USD_DENOMINATIONS.map((denom) => (
                <label key={denom} className="block space-y-1">
                  <span className="text-xs font-mono text-slate-400">${denom}</span>
                  <input
                    type="number"
                    min="0"
                    value={usdBills[denom] ?? 0}
                    onChange={(e) =>
                      setUsdBills((prev) => ({
                        ...prev,
                        [denom]: Math.max(0, parseInt(e.target.value, 10) || 0),
                      }))
                    }
                    className="w-full bg-[#121826] border border-white/[0.1] rounded-lg px-3 py-1.5 font-mono tabular-nums text-sm text-white"
                  />
                </label>
              ))}
            </div>
            <div className="flex items-center justify-between pt-2 border-t border-white/[0.06] text-xs font-mono tabular-nums">
              <span className="text-slate-400">Факт в кассе:</span>
              <span className="text-sm font-bold text-white">{formatUsd(denomTotals.totalUsd)}</span>
            </div>
          </div>
        </div>

        {/* Cash Discrepancy Debugger */}
        {(diffUzs !== 0 || diffUsd !== 0) && (
          <div className="rounded-xl border border-[#F43F5E]/40 bg-[#F43F5E]/10 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-[#F43F5E]">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>
                  Диагностика расхождения кассы · Последние 5 операций с наличными и сдачей
                </span>
              </div>
              <span className="text-xs font-mono tabular-nums text-rose-200">
                {diffUzs !== 0 ? `UZS: ${diffUzs > 0 ? '+' : ''}${formatUzs(diffUzs)}` : ''}{' '}
                {diffUsd !== 0 ? `USD: ${diffUsd > 0 ? '+' : ''}${formatUsd(diffUsd)}` : ''}
              </span>
            </div>
            <div className="divide-y divide-rose-500/20 rounded-lg border border-rose-500/25 bg-[#0B0F17]/90 overflow-hidden">
              {recentCashDiscrepancyTx.map((tx) => (
                <div
                  key={tx.id}
                  className="px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs"
                >
                  <div className="min-w-0">
                    <div className="text-slate-100 font-medium truncate">{tx.label}</div>
                    <div className="text-slate-400">
                      {tx.pocketId === 'cash_usd' ? 'Нал USD' : 'Нал UZS'} · {tx.actor}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span
                      className={`font-mono tabular-nums font-semibold ${
                        tx.direction === 'in' ? 'text-[#10B981]' : 'text-[#F43F5E]'
                      }`}
                    >
                      {tx.direction === 'in' ? '+' : '−'}
                      {formatPocketBalance(tx.currency, tx.amount)}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        if (tx.bookingId) {
                          setActiveTab('grid');
                          setSelectedBookingId(tx.bookingId);
                        } else {
                          setActivePocketFilter(tx.pocketId);
                          pushToast('Фильтр применён', `Показаны операции кармана ${tx.pocketId}`, 'cobalt');
                        }
                      }}
                      className="px-2.5 py-1 rounded-md bg-[#1A2234] hover:bg-slate-700 text-slate-200 inline-flex items-center gap-1"
                    >
                      <ExternalLink className="w-3 h-3" />
                      Проверить
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Pure-SVG Shift & Revenue Analytics */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4 print:hidden">
        {/* 7-Day Occupancy SVG Bar Chart */}
        <div className="bg-[#121826] border border-white/[0.08] rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-semibold text-white">
              <BarChart3 className="w-4 h-4 text-[#10B981]" />
              <span>Загрузка за 7 дней (%)</span>
            </div>
            <span className="text-xs font-mono tabular-nums text-[#10B981]">
              Сегодня: {analytics.days7.find((d) => d.isToday)?.pct ?? 0}%
            </span>
          </div>
          <svg
            viewBox="0 0 280 110"
            className="w-full h-28"
            role="img"
            aria-label="График загрузки хостела за 7 дней"
          >
            {analytics.days7.map((d, idx) => {
              const x = 10 + idx * 38;
              const barH = Math.max(8, Math.round((d.pct / 100) * 66));
              const y = 80 - barH;
              return (
                <g key={d.iso}>
                  <rect x={x} y={14} width={24} height={66} rx={5} fill="#0B0F17" />
                  <rect
                    x={x}
                    y={y}
                    width={24}
                    height={barH}
                    rx={5}
                    fill={d.isToday ? '#10B981' : '#3B82F6'}
                    opacity={d.isToday ? 1 : 0.7}
                  />
                  <text
                    x={x + 12}
                    y={y - 3}
                    textAnchor="middle"
                    fill="#CBD5E1"
                    fontSize="9"
                    fontFamily="monospace"
                  >
                    {d.pct}%
                  </text>
                  <text
                    x={x + 12}
                    y={96}
                    textAnchor="middle"
                    fill={d.isToday ? '#10B981' : '#94A3B8'}
                    fontSize="9"
                  >
                    {d.weekday}
                  </text>
                  <text
                    x={x + 12}
                    y={107}
                    textAnchor="middle"
                    fill="#64748B"
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
        <div className="bg-[#121826] border border-white/[0.08] rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-white">Структура кассы по методам</span>
            <span className="font-mono tabular-nums text-slate-300">
              ≈ {formatUsd(analytics.totalMethodsUsd)}
            </span>
          </div>
          <svg
            viewBox="0 0 280 24"
            className="w-full h-6 rounded-lg overflow-hidden"
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
                    height={24}
                    fill={m.color}
                  />
                );
                cursor += w;
                return el;
              });
            })()}
          </svg>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
            {analytics.methods.map((m) => (
              <div key={m.label} className="flex items-center justify-between gap-1">
                <span className="inline-flex items-center gap-1.5 text-slate-300 truncate">
                  <span
                    className="w-2.5 h-2.5 rounded-xs shrink-0"
                    style={{ backgroundColor: m.color }}
                  />
                  {m.label}
                </span>
                <span className="font-mono tabular-nums text-slate-200">${m.usd}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Uzbekistan Monthly Tourist Tax Progress */}
        <div className="bg-[#121826] border border-white/[0.08] rounded-2xl p-4 flex flex-col justify-between space-y-3">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-white">Турсбор РУз (до {daysToTaxDeadline.deadlineLabel})</span>
            <span className="font-mono tabular-nums text-[#F59E0B]">
              Осталось {daysToTaxDeadline.daysLeft} дн.
            </span>
          </div>
          <div>
            <div className="text-xl font-bold font-mono tabular-nums text-white">
              {formatUzs(monthlyTouristTaxUzs)}
            </div>
            <div className="text-xs text-slate-400 mt-0.5 font-mono tabular-nums">
              БРВ {state.currency.bcvUzs.toLocaleString('ru-RU')} · {activePhysicalCount} комн.
              ({activePhysicalCount <= 10 ? '5%' : activePhysicalCount <= 40 ? '10%' : '15%'})
            </div>
          </div>
          <div className="space-y-1">
            <svg viewBox="0 0 280 12" className="w-full h-3 rounded-full overflow-hidden">
              <rect x={0} y={0} width={280} height={12} fill="#0B0F17" />
              <rect
                x={0}
                y={0}
                width={Math.max(16, Math.min(280, Math.round((daysToTaxDeadline.monthProgressPct / 100) * 280)))}
                height={12}
                rx={6}
                fill={daysToTaxDeadline.daysLeft <= 5 ? '#F43F5E' : '#10B981'}
              />
            </svg>
            <div className="flex justify-between text-xs text-slate-400">
              <span>Накоплено за период</span>
              <span>Срок оплаты: {daysToTaxDeadline.deadlineLabel}</span>
            </div>
          </div>
        </div>
      </section>

      {/* Printable Z-Report Sheet (Visible only in @media print when z-report requested) */}
      <section
        id="printable-z-report"
        className="hidden print:block bg-white text-slate-950 p-6 space-y-4 border border-slate-300"
      >
        <div className="flex items-start justify-between border-b-2 border-slate-900 pb-3">
          <div>
            <h2 className="text-xl font-bold">{state.integrations.propertyName} — Акт смены (Z-Report)</h2>
            <p className="text-xs text-slate-600">
              Дата: {formatTashkentDateRu()} · Администратор: {state.adminName}
            </p>
          </div>
          <div className="text-right font-mono text-xs tabular-nums">
            <div>ЦБ USD: {state.currency.cbuUsd}</div>
            <div>Acc: {state.currency.accRate} · Ex: {state.currency.exRate}</div>
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
            <h3 className="font-bold mb-1">2. Сверка купюр (Факт vs План)</h3>
            <div className="font-mono tabular-nums">
              UZS факт: {formatUzs(denomTotals.totalUzs)} (план: {formatUzs(expectedCashUzs)}, diff: {diffUzs})
            </div>
            <div className="font-mono tabular-nums">
              USD факт: {formatUsd(denomTotals.totalUsd)} (план: {formatUsd(expectedCashUsd)}, diff: {diffUsd})
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

      {/* Recent Cash Transactions */}
      <section className="bg-[#121826] border border-white/[0.08] rounded-2xl p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">
            История операций{' '}
            {activePocketFilter !== 'all'
              ? `· ${state.pockets.find((p) => p.id === activePocketFilter)?.name}`
              : '(все 6 карманов)'}
          </h2>
          {activePocketFilter !== 'all' && (
            <button
              type="button"
              onClick={() => setActivePocketFilter('all')}
              className="text-xs text-[#3B82F6] hover:underline"
            >
              Показать все
            </button>
          )}
        </div>
        <div className="divide-y divide-white/[0.06] border border-white/[0.08] rounded-xl bg-[#0B0F17] overflow-hidden">
          {filteredTx.map((tx) => {
            const pocket = state.pockets.find((p) => p.id === tx.pocketId);
            return (
              <div
                key={tx.id}
                className="px-4 py-3 flex items-center justify-between gap-3 text-xs"
              >
                <div className="flex items-center gap-3 min-w-0">
                  {tx.direction === 'in' ? (
                    <ArrowDownLeft className="w-4 h-4 text-[#10B981] shrink-0" />
                  ) : (
                    <ArrowUpRight className="w-4 h-4 text-[#F43F5E] shrink-0" />
                  )}
                  <div className="min-w-0">
                    <div className="text-slate-100 font-medium truncate">{tx.label}</div>
                    <div className="text-slate-400">
                      {pocket?.name} · {tx.actor}
                      {tx.receiptVerified ? ' · Чек проверен' : ''}
                    </div>
                  </div>
                </div>
                <div
                  className={`font-mono tabular-nums font-semibold shrink-0 ${
                    tx.direction === 'in' ? 'text-[#10B981]' : 'text-[#F43F5E]'
                  }`}
                >
                  {tx.direction === 'in' ? '+' : '−'}
                  {formatPocketBalance(tx.currency, tx.amount)}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
};
