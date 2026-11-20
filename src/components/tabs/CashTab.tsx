import React, { useMemo, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Calculator,
  CheckCircle2,
  ClipboardCopy,
  ShieldCheck,
  Vault,
  Wallet,
} from 'lucide-react';
import { useOps } from '../../context/OpsContext';
import type { CashPocketId, CurrencyCode } from '../../types/ops';
import {
  calcDenominationTotals,
  calcDualRateChange,
  calcMonthlyTouristTaxUzs,
  formatEur,
  formatUsd,
  formatUzs,
  USD_DENOMINATIONS,
  UZS_DENOMINATIONS,
} from '../../utils/math';

export const CashTab: React.FC = () => {
  const {
    state,
    addPettyCashExpense,
    recordCashCalculatorTransaction,
    createSafeCollection,
    confirmSafeCollection,
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
      .map((p) => `• ${p.name}: ${formatPocketBalance(p.currency, p.balance)}`)
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
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
        <button
          type="button"
          onClick={handleCopyShiftReport}
          className="px-4 py-2.5 rounded-lg bg-[#3B82F6] hover:bg-blue-500 text-white text-sm font-semibold inline-flex items-center gap-2 whitespace-nowrap shrink-0 transition-colors"
        >
          <ClipboardCopy className="w-4 h-4" />
          Скопировать отчёт смены для Telegram
        </button>
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
                {formatPocketBalance(pocket.currency, pocket.balance)}
              </div>
              <p className="text-xs text-slate-400 mt-1 line-clamp-1">{pocket.description}</p>
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
