import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertTriangle,
  ArrowRightLeft,
  Banknote,
  Coffee,
  DoorOpen,
  Plus,
  ShieldCheck,
  Sparkles,
  WashingMachine,
  X,
} from 'lucide-react';
import { useOps } from '../../context/OpsContext';
import type { CashPocketId, CurrencyCode } from '../../types/ops';
import {
  calcAccommodationUzs,
  calcBookingTotals,
  calcBookingTouristTaxUzs,
  calcDualRateChange,
  formatUsd,
  formatUzs,
  round2,
} from '../../utils/math';
import { addDaysIso, getTashkentTodayIso } from '../../utils/time';
import { findAlternativeFreeRooms, findRoomConflicts } from '../../utils/availability';

export const GuestFolioDrawer: React.FC = () => {
  const {
    state,
    selectedBookingId,
    setSelectedBookingId,
    addLedgerCharge,
    addPayment,
    extendOrMoveStay,
    openCheckOutModal,
  } = useOps();

  const booking = useMemo(
    () => state.bookings.find((b) => b.id === selectedBookingId) ?? null,
    [state.bookings, selectedBookingId]
  );

  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [pocketId, setPocketId] = useState<CashPocketId>('cash_usd');
  const [payCurrency, setPayCurrency] = useState<CurrencyCode>('USD');
  const [payAmount, setPayAmount] = useState('5');

  const [showExtendForm, setShowExtendForm] = useState(false);
  const [extendMode, setExtendMode] = useState<'extend' | 'move'>('extend');
  const [extraNights, setExtraNights] = useState(1);
  const [moveRoomKey, setMoveRoomKey] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectedBookingId) setSelectedBookingId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedBookingId, setSelectedBookingId]);

  useEffect(() => {
    if (!booking) return;
    const fin = calcBookingTotals(booking);
    setPayAmount(String(fin.debtUsd > 0 ? fin.debtUsd : 10));
    setPocketId('cash_usd');
    setPayCurrency('USD');
    setShowPaymentForm(false);
    setShowExtendForm(false);
  }, [booking?.id]);

  const availableRoomsForMove = useMemo(() => {
    const list: Array<{ key: string; roomId: string; bedId?: string; label: string; rate: number }> =
      [];
    for (const r of state.physicalRooms) {
      if (r.archived) continue;
      const cat = state.roomCategories.find((c) => c.id === r.categoryId);
      const rate = cat?.pricesUsd[1] ?? 18;
      if (r.beds) {
        for (const b of r.beds) {
          if (b.status === 'available') {
            list.push({
              key: `${r.id}:${b.id}`,
              roomId: r.id,
              bedId: b.id,
              label: `${r.code} ${b.label} ($${rate}/н)`,
              rate,
            });
          }
        }
      } else if (r.status === 'available') {
        list.push({
          key: r.id,
          roomId: r.id,
          label: `${r.code} ($${rate}/н)`,
          rate,
        });
      }
    }
    return list;
  }, [state.physicalRooms, state.roomCategories]);

  if (!booking) return null;

  const financials = calcBookingTotals(booking);
  const lastSeg = booking.segments[booking.segments.length - 1];
  const currentRoom = state.physicalRooms.find((r) => r.id === lastSeg?.roomId);
  const currentBed = currentRoom?.beds?.find((b) => b.id === lastSeg?.bedId);
  const roomTitle = currentRoom
    ? currentBed
      ? `${currentRoom.code} · Койка ${currentBed.label}`
      : currentRoom.code
    : 'Номер';

  const activePhysicalCount = state.physicalRooms.filter((r) => !r.archived).length;
  const touristTaxUzs = calcBookingTouristTaxUzs(booking, state.currency.bcvUzs, activePhysicalCount);

  const parsedPayNum = Math.max(0, parseFloat(payAmount) || 0);
  const isCashPocket =
    pocketId === 'cash_uzs' || pocketId === 'cash_usd' || pocketId === 'cash_eur';
  const payCalc = calcDualRateChange({
    billUsd: Math.max(0, financials.debtUsd),
    receivedCurrency: payCurrency,
    receivedAmount: parsedPayNum,
    accRate: state.currency.accRate,
    exRate: state.currency.exRate,
    cbuUsd: state.currency.cbuUsd,
    cbuEur: state.currency.cbuEur,
  });
  const payUsdEq = payCalc.receivedUsdEquivalent;
  const changeUzsOut =
    financials.debtUsd > 0 && isCashPocket ? payCalc.changeUzs : 0;

  const handlePaymentSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (parsedPayNum <= 0) return;
    const ok = addPayment({
      bookingId: booking.id,
      pocketId,
      currency: payCurrency,
      originalAmount: parsedPayNum,
      usdEquivalent:
        financials.debtUsd > 0 && changeUzsOut > 0 ? financials.debtUsd : payUsdEq,
      changeUzsOut,
      receiptVerified: pocketId === 'transfer',
    });
    if (ok) {
      setShowPaymentForm(false);
    }
  };

  const targetMove = availableRoomsForMove.find((o) => o.key === moveRoomKey) ?? availableRoomsForMove[0];
  const extFromDate = extendMode === 'move' ? getTashkentTodayIso() : (lastSeg?.toDate ?? getTashkentTodayIso());
  const extToDate = addDaysIso(extFromDate, Math.max(1, extraNights));
  const extTargetRoomId = extendMode === 'move' && targetMove ? targetMove.roomId : (lastSeg?.roomId ?? '');
  const extTargetBedId = extendMode === 'move' ? targetMove?.bedId : lastSeg?.bedId;
  const extendConflicts = findRoomConflicts(
    state.bookings,
    extTargetRoomId,
    extTargetBedId,
    extFromDate,
    extToDate,
    booking.id
  );
  const extendAlternatives =
    extendConflicts.length > 0 && currentRoom
      ? findAlternativeFreeRooms(
          state.physicalRooms,
          state.bookings,
          currentRoom.categoryId,
          extFromDate,
          extToDate,
          booking.id
        ).slice(0, 4)
      : [];

  const handleExtendSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (extendConflicts.length > 0) return;
    let ok = false;
    if (extendMode === 'move') {
      if (!targetMove) return;
      ok = extendOrMoveStay({
        bookingId: booking.id,
        mode: 'move',
        extraNights,
        newRoomId: targetMove.roomId,
        newBedId: targetMove.bedId,
        nightlyRateUsd: targetMove.rate,
      });
    } else {
      ok = extendOrMoveStay({
        bookingId: booking.id,
        mode: 'extend',
        extraNights,
        nightlyRateUsd: lastSeg?.nightlyRateUsd ?? 18,
      });
    }
    if (ok) setShowExtendForm(false);
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-40 bg-black/65 backdrop-blur-xs flex justify-end"
        onClick={() => setSelectedBookingId(null)}
      >
        <motion.div
          initial={{ x: '100%' }}
          animate={{ x: 0 }}
          exit={{ x: '100%' }}
          transition={{ type: 'spring', stiffness: 300, damping: 28 }}
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-label={`Фолио гостя ${roomTitle}`}
          className="w-full max-w-xl bg-[#121826] border-l border-white/[0.1] h-full flex flex-col shadow-2xl"
        >
          {/* Header */}
          <div className="px-5 py-4 border-b border-white/[0.08] flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <span className="font-mono">{booking.bnovoId}</span>
                <span aria-hidden="true">·</span>
                <span>{booking.source}</span>
                {booking.checkingOutToday && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="text-[#F59E0B] font-medium">Выезд сегодня 12:00</span>
                  </>
                )}
              </div>
              <h2 className="text-lg font-semibold text-white truncate mt-0.5">{roomTitle}</h2>
            </div>
            <button
              type="button"
              aria-label="Закрыть карточку гостя"
              onClick={() => setSelectedBookingId(null)}
              className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-[#1A2234]"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-5">
            {/* Financial Summary Bar */}
            <div className="grid grid-cols-3 gap-3 bg-[#0B0F17] border border-white/[0.08] rounded-xl p-4">
              <div>
                <div className="text-xs text-slate-400">Начислено</div>
                <div className="text-lg font-semibold font-mono tabular-nums text-white mt-0.5">
                  {formatUsd(financials.totalChargesUsd)}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-400">Оплачено</div>
                <div className="text-lg font-semibold font-mono tabular-nums text-[#10B981] mt-0.5">
                  {formatUsd(financials.totalPaymentsUsd)}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-400">Долг</div>
                <div
                  className={`text-lg font-semibold font-mono tabular-nums mt-0.5 ${
                    financials.debtUsd > 0 ? 'text-[#F43F5E]' : 'text-[#10B981]'
                  }`}
                >
                  {formatUsd(financials.debtUsd)}
                </div>
                {financials.debtUsd > 0 && (
                  <div className="text-xs font-mono tabular-nums text-slate-400">
                    {formatUzs(calcAccommodationUzs(financials.debtUsd, state.currency.accRate))}
                  </div>
                )}
              </div>
            </div>

            {/* Guests List */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-300">
                  Гости в номере ({booking.guests.length})
                </span>
                <span className="text-slate-400 font-mono tabular-nums">
                  Турсбор: {formatUzs(touristTaxUzs)}
                </span>
              </div>
              <div className="divide-y divide-white/[0.06] border border-white/[0.08] rounded-xl bg-[#0B0F17] overflow-hidden">
                {booking.guests.map((guest) => {
                  const profile = state.guestProfiles.find(
                    (p) => p.passportNo === guest.passportNo
                  );
                  return (
                    <div key={guest.id} className="p-3.5 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-white">
                            {guest.fullName}
                          </span>
                          {profile?.tag === 'vip' && (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-[#F59E0B]">
                              <Sparkles className="w-3.5 h-3.5" />
                              VIP · визит #{profile.visitsCount}
                            </span>
                          )}
                          {guest.age < 16 && (
                            <span className="text-xs text-[#3B82F6]">
                              Ребёнок ({guest.age} лет · 0 турсбор)
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-slate-400 font-mono tabular-nums mt-0.5">
                          {guest.citizenship} · {guest.passportNo} · ДР {guest.dob}
                        </div>
                      </div>
                      <div className="text-right text-xs shrink-0">
                        <div
                          className={
                            guest.emehmonRegistered ? 'text-[#10B981]' : 'text-[#F59E0B]'
                          }
                        >
                          {guest.emehmonRegistered ? 'E-mehmon ✓' : 'Нет E-mehmon'}
                        </div>
                        <div className="text-slate-400 mt-0.5">
                          {guest.keyIssued ? 'Ключ на руках' : 'Без ключа'}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              {booking.notes && (
                <p className="text-xs text-slate-300 bg-[#0B0F17] border border-white/[0.06] rounded-lg px-3 py-2">
                  {booking.notes}
                </p>
              )}
            </div>

            {/* Stay Segments + Extend/Move */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-300">Сегменты проживания</span>
                <button
                  type="button"
                  onClick={() => {
                    setShowExtendForm((s) => !s);
                    if (!moveRoomKey && availableRoomsForMove[0]) {
                      setMoveRoomKey(availableRoomsForMove[0].key);
                    }
                  }}
                  className="text-xs font-medium text-[#3B82F6] hover:underline inline-flex items-center gap-1"
                >
                  <ArrowRightLeft className="w-3.5 h-3.5" />
                  Продлить / Переселить
                </button>
              </div>
              <div className="space-y-1.5">
                {booking.segments.map((seg) => {
                  const r = state.physicalRooms.find((rm) => rm.id === seg.roomId);
                  const bd = r?.beds?.find((b) => b.id === seg.bedId);
                  return (
                    <div
                      key={seg.id}
                      className="px-3.5 py-2.5 rounded-xl bg-[#0B0F17] border border-white/[0.08] flex items-center justify-between text-xs"
                    >
                      <span className="font-medium text-white">
                        {r?.code ?? seg.roomId}
                        {bd ? ` · Койка ${bd.label}` : ''}
                      </span>
                      <span className="font-mono tabular-nums text-slate-300">
                        {seg.fromDate} → {seg.toDate} ({seg.nights} н. × ${seg.nightlyRateUsd})
                      </span>
                    </div>
                  );
                })}
              </div>

              {showExtendForm && (
                <form
                  onSubmit={handleExtendSubmit}
                  className="p-3.5 rounded-xl bg-[#0B0F17] border border-[#3B82F6]/30 space-y-3"
                >
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={() => setExtendMode('extend')}
                      className={`py-1.5 rounded-lg text-xs font-medium ${
                        extendMode === 'extend'
                          ? 'bg-[#3B82F6] text-white'
                          : 'bg-[#1A2234] text-slate-300'
                      }`}
                    >
                      Продлить здесь
                    </button>
                    <button
                      type="button"
                      onClick={() => setExtendMode('move')}
                      className={`py-1.5 rounded-lg text-xs font-medium ${
                        extendMode === 'move'
                          ? 'bg-[#3B82F6] text-white'
                          : 'bg-[#1A2234] text-slate-300'
                      }`}
                    >
                      Переселить в другую
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">Кол-во ночей</label>
                      <input
                        type="number"
                        min={1}
                        max={30}
                        value={extraNights}
                        onChange={(e) => setExtraNights(Math.max(1, parseInt(e.target.value, 10) || 1))}
                        className="w-full bg-[#121826] border border-white/[0.1] rounded-lg px-3 py-2 font-mono text-xs text-white"
                      />
                    </div>
                    {extendMode === 'move' && (
                      <div>
                        <label className="block text-xs text-slate-400 mb-1">Новая комната</label>
                        <select
                          value={moveRoomKey}
                          onChange={(e) => setMoveRoomKey(e.target.value)}
                          className="w-full bg-[#121826] border border-white/[0.1] rounded-lg px-2 py-2 text-xs text-white"
                        >
                          {availableRoomsForMove.map((o) => (
                            <option key={o.key} value={o.key}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                  {extendConflicts.length > 0 && (
                    <div className="rounded-lg border border-[#F43F5E]/40 bg-[#F43F5E]/10 p-2.5 text-xs text-rose-200 space-y-2">
                      <div className="flex items-start gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 text-[#F43F5E] shrink-0 mt-0.5" />
                        <span>
                          Конфликт дат ({extFromDate} → {extToDate}) с {extendConflicts[0].guestName}.
                          Переселите в свободную комнату:
                        </span>
                      </div>
                      {extendAlternatives.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {extendAlternatives.map((alt) => {
                            const key = alt.bedId ? `${alt.roomId}:${alt.bedId}` : alt.roomId;
                            return (
                              <button
                                key={key}
                                type="button"
                                onClick={() => {
                                  setExtendMode('move');
                                  setMoveRoomKey(key);
                                }}
                                className="px-2 py-1 rounded-md bg-[#10B981]/20 text-emerald-200 border border-[#10B981]/40 font-semibold"
                              >
                                {alt.label}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                  <button
                    type="submit"
                    disabled={extendConflicts.length > 0}
                    className="w-full py-2 rounded-lg bg-[#3B82F6] hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-400 text-xs font-semibold text-white"
                  >
                    {extendMode === 'move' ? 'Подтвердить переселение' : 'Продлить проживание'}
                  </button>
                </form>
              )}
            </div>

            {/* 1-Click Extra Charges */}
            <div className="space-y-2">
              <div className="text-xs font-semibold text-slate-300">
                Доп. услуги в 1 клик (добавляются в фолио)
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() =>
                    addLedgerCharge(booking.id, 'late_breakfast', 'Поздний завтрак', 2)
                  }
                  className="px-3 py-2 rounded-lg bg-[#0B0F17] hover:bg-[#1A2234] border border-white/[0.08] text-xs text-slate-200 flex items-center justify-between transition-colors"
                >
                  <span className="inline-flex items-center gap-1.5">
                    <Coffee className="w-3.5 h-3.5 text-[#F59E0B]" />
                    Поздний завтрак
                  </span>
                  <span className="font-mono tabular-nums text-white">$2</span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    addLedgerCharge(
                      booking.id,
                      'laundry_fast',
                      'Быстрая стирка (22 мин)',
                      2,
                      { startLaundryMode: 'fast' }
                    )
                  }
                  className="px-3 py-2 rounded-lg bg-[#0B0F17] hover:bg-[#1A2234] border border-white/[0.08] text-xs text-slate-200 flex items-center justify-between transition-colors"
                >
                  <span className="inline-flex items-center gap-1.5">
                    <WashingMachine className="w-3.5 h-3.5 text-[#3B82F6]" />
                    Стирка 22 мин
                  </span>
                  <span className="font-mono tabular-nums text-white">$2</span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    addLedgerCharge(
                      booking.id,
                      'laundry_medium',
                      'Средняя стирка (55 мин)',
                      3,
                      { startLaundryMode: 'medium' }
                    )
                  }
                  className="px-3 py-2 rounded-lg bg-[#0B0F17] hover:bg-[#1A2234] border border-white/[0.08] text-xs text-slate-200 flex items-center justify-between transition-colors"
                >
                  <span className="inline-flex items-center gap-1.5">
                    <WashingMachine className="w-3.5 h-3.5 text-cyan-400" />
                    Стирка 55 мин
                  </span>
                  <span className="font-mono tabular-nums text-white">$3</span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    addLedgerCharge(
                      booking.id,
                      'early_late',
                      'Ранний заезд / Поздний выезд (+50%)',
                      round2((lastSeg?.nightlyRateUsd ?? 18) * 0.5)
                    )
                  }
                  className="px-3 py-2 rounded-lg bg-[#0B0F17] hover:bg-[#1A2234] border border-white/[0.08] text-xs text-slate-200 flex items-center justify-between transition-colors"
                >
                  <span>Ранний/Поздний +50%</span>
                  <span className="font-mono tabular-nums text-white">
                    {formatUsd(round2((lastSeg?.nightlyRateUsd ?? 18) * 0.5))}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    addLedgerCharge(booking.id, 'penalty', 'Штраф (утеря ключа / ущерб)', 10)
                  }
                  className="col-span-2 px-3 py-2 rounded-lg bg-[#0B0F17] hover:bg-[#F43F5E]/10 border border-white/[0.08] text-xs text-slate-200 flex items-center justify-between transition-colors"
                >
                  <span>Штраф (утеря ключа / порча имущества)</span>
                  <span className="font-mono tabular-nums text-[#F43F5E]">$10</span>
                </button>
              </div>
            </div>

            {/* Split Payment Form */}
            {showPaymentForm && (
              <form
                onSubmit={handlePaymentSubmit}
                className="p-4 rounded-xl bg-[#0B0F17] border border-[#10B981]/35 space-y-3"
              >
                <div className="flex items-center justify-between text-xs font-semibold text-[#10B981]">
                  <span>Принять оплату (сплит в любой из 6 карманов)</span>
                  <button
                    type="button"
                    onClick={() => setShowPaymentForm(false)}
                    className="text-slate-400 hover:text-white"
                  >
                    Скрыть
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Карман кассы</label>
                    <select
                      value={pocketId}
                      onChange={(e) => {
                        const p = e.target.value as CashPocketId;
                        setPocketId(p);
                        if (p === 'cash_usd') setPayCurrency('USD');
                        else if (p === 'cash_eur') setPayCurrency('EUR');
                        else setPayCurrency('UZS');
                      }}
                      className="w-full bg-[#121826] border border-white/[0.1] rounded-lg px-3 py-2 text-xs text-white"
                    >
                      {state.pockets
                        .filter((p) => p.id !== 'safe')
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">
                      Сумма ({payCurrency})
                    </label>
                    <input
                      type="number"
                      step="any"
                      min="0"
                      value={payAmount}
                      onChange={(e) => setPayAmount(e.target.value)}
                      className="w-full bg-[#121826] border border-white/[0.1] rounded-lg px-3 py-2 font-mono tabular-nums text-xs text-white"
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between text-xs text-slate-300 font-mono tabular-nums">
                  <span>Эквивалент: {formatUsd(payUsdEq)}</span>
                  {changeUzsOut > 0 && (
                    <span className="text-[#F59E0B]">Сдача сумами: {formatUzs(changeUzsOut)}</span>
                  )}
                </div>
                <button
                  type="submit"
                  className="w-full py-2.5 rounded-lg bg-[#10B981] hover:bg-emerald-600 text-slate-950 text-xs font-semibold flex items-center justify-center gap-1.5"
                >
                  <ShieldCheck className="w-4 h-4" />
                  Провести оплату в кассу
                </button>
              </form>
            )}

            {/* Financial Ledger */}
            <div className="space-y-2">
              <div className="text-xs font-semibold text-slate-300">
                История фолио ({booking.ledgerEntries.length})
              </div>
              <div className="divide-y divide-white/[0.06] border border-white/[0.08] rounded-xl bg-[#0B0F17] overflow-hidden">
                {booking.ledgerEntries.map((entry) => (
                  <div
                    key={entry.id}
                    className="px-3.5 py-2.5 flex items-center justify-between gap-3 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="text-slate-200 truncate">{entry.label}</div>
                      <div className="text-slate-500">
                        {entry.actor}
                        {entry.originalAmount && entry.originalCurrency !== 'USD'
                          ? ` · ${entry.originalAmount.toLocaleString('ru-RU')} ${entry.originalCurrency}`
                          : ''}
                      </div>
                    </div>
                    <div
                      className={`font-mono tabular-nums font-semibold shrink-0 ${
                        entry.type === 'payment' ? 'text-[#10B981]' : 'text-white'
                      }`}
                    >
                      {entry.type === 'payment' ? '−' : '+'}
                      {formatUsd(entry.amountUsd)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Sticky Drawer Footer */}
          <div className="p-4 border-t border-white/[0.08] bg-[#0B0F17] flex items-center gap-3">
            <button
              type="button"
              onClick={() => setShowPaymentForm((v) => !v)}
              className="flex-1 py-2.5 px-4 rounded-lg bg-[#10B981] hover:bg-emerald-600 text-slate-950 text-sm font-semibold transition-colors inline-flex items-center justify-center gap-2"
            >
              <Plus className="w-4 h-4" />
              <Banknote className="w-4 h-4" />
              Оплата
            </button>
            <button
              type="button"
              onClick={() => openCheckOutModal(booking.id)}
              className="flex-1 py-2.5 px-4 rounded-lg bg-[#1A2234] hover:bg-[#F59E0B] hover:text-slate-950 text-white border border-white/[0.1] text-sm font-semibold transition-colors inline-flex items-center justify-center gap-2"
            >
              <DoorOpen className="w-4 h-4" />
              Выселить (Check-out)
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};
