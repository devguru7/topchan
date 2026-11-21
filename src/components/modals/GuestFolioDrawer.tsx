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
import { SegmentedControl, StatusPill } from '../ui';

const EXTEND_MODE_OPTIONS = [
  { id: 'extend' as const, label: 'Продлить здесь' },
  { id: 'move' as const, label: 'Переселить' },
];

export const GuestFolioDrawer: React.FC = () => {
  const {
    state,
    selectedBookingId,
    setSelectedBookingId,
    folioAutoOpenPayment,
    clearFolioAutoOpenPayment,
    addLedgerCharge,
    addPayment,
    extendOrMoveStay,
    markGuestEmehmonRegistered,
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
    if (!booking) return;
    const fin = calcBookingTotals(booking);
    setPayAmount(String(fin.debtUsd > 0 ? fin.debtUsd : 10));
    setPocketId('cash_usd');
    setPayCurrency('USD');
    setShowExtendForm(false);
    setShowPaymentForm(false);
  }, [booking?.id]);

  useEffect(() => {
    if (!booking || !folioAutoOpenPayment) return;
    setShowPaymentForm(true);
    clearFolioAutoOpenPayment();
  }, [booking?.id, folioAutoOpenPayment, clearFolioAutoOpenPayment]);

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

  const targetMove =
    availableRoomsForMove.find((o) => o.key === moveRoomKey) ?? availableRoomsForMove[0];
  const extFromDate =
    extendMode === 'move' ? getTashkentTodayIso() : (lastSeg?.toDate ?? getTashkentTodayIso());
  const extToDate = addDaysIso(extFromDate, Math.max(1, extraNights));
  const extTargetRoomId =
    extendMode === 'move' && targetMove ? targetMove.roomId : (lastSeg?.roomId ?? '');
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
        className="fixed inset-0 z-40 backdrop-blur-xs flex justify-end"
        style={{ backgroundColor: 'var(--backdrop-scrim)' }}
        onClick={() => setSelectedBookingId(null)}
      >
        <motion.div
          initial={{ x: '100%' }}
          animate={{ x: 0 }}
          exit={{ x: '100%' }}
          transition={{ type: 'spring', stiffness: 300, damping: 28 }}
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-label={`Счёт гостя ${roomTitle}`}
          className="w-full max-w-xl bg-[var(--bg-surface)] border-l border-[var(--border-strong)] h-full flex flex-col shadow-2xl"
        >
          {/* Header */}
          <div className="px-5 py-4 border-b border-[var(--border-subtle)] flex items-center justify-between gap-3 shrink-0">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs text-[var(--text-muted)] flex-wrap">
                <span className="font-mono tabular-nums">{booking.bnovoId}</span>
                <span aria-hidden="true">·</span>
                <span>{booking.source}</span>
                {booking.checkingOutToday && (
                  <StatusPill tone="amber">Выезд сегодня 12:00</StatusPill>
                )}
              </div>
              <h2 className="text-lg font-semibold text-[var(--text-primary)] truncate mt-0.5">
                Счёт гостя · {roomTitle}
              </h2>
            </div>
            <button
              type="button"
              aria-label="Закрыть счёт гостя"
              onClick={() => setSelectedBookingId(null)}
              className="p-2 rounded-xl text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
            >
              <X className="w-5 h-5" strokeWidth={1.75} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-5">
            {/* Financial Summary Bar */}
            <div className="grid grid-cols-3 gap-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4">
              <div>
                <div className="text-xs text-[var(--text-muted)]">Начислено</div>
                <div className="text-lg font-bold font-mono tabular-nums text-[var(--text-primary)] mt-1">
                  {formatUsd(financials.totalChargesUsd)}
                </div>
              </div>
              <div>
                <div className="text-xs text-[var(--text-muted)]">Оплачено</div>
                <div
                  className="text-lg font-bold font-mono tabular-nums mt-1"
                  style={{ color: 'var(--tone-emerald-fg)' }}
                >
                  {formatUsd(financials.totalPaymentsUsd)}
                </div>
              </div>
              <div>
                <div className="text-xs text-[var(--text-muted)]">
                  {financials.overpaidUsd > 0 ? 'Переплата' : 'Долг'}
                </div>
                <div
                  className="text-lg font-bold font-mono tabular-nums mt-1"
                  style={{
                    color:
                      financials.debtUsd > 0
                        ? 'var(--tone-rose-fg)'
                        : financials.overpaidUsd > 0
                          ? 'var(--tone-cobalt-fg)'
                          : 'var(--tone-emerald-fg)',
                  }}
                >
                  {financials.overpaidUsd > 0
                    ? formatUsd(financials.overpaidUsd)
                    : formatUsd(financials.debtUsd)}
                </div>
                {financials.debtUsd > 0 && (
                  <div className="text-xs font-mono tabular-nums text-[var(--text-muted)]">
                    {formatUzs(calcAccommodationUzs(financials.debtUsd, state.currency.accRate))}
                  </div>
                )}
              </div>
            </div>

            {/* Split Payment Form (shown near top when triggered via + Оплата) */}
            {showPaymentForm && (
              <form
                onSubmit={handlePaymentSubmit}
                className="p-4 rounded-2xl border space-y-3"
                style={{
                  backgroundColor: 'var(--tone-emerald-bg)',
                  borderColor: 'var(--tone-emerald-border)',
                }}
              >
                <div className="flex items-center justify-between text-xs font-semibold">
                  <span style={{ color: 'var(--tone-emerald-fg)' }}>
                    Принять оплату в кассу
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowPaymentForm(false)}
                    className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                  >
                    Скрыть
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-[var(--text-secondary)] mb-1">
                      Карман кассы
                    </label>
                    <select
                      value={pocketId}
                      onChange={(e) => {
                        const p = e.target.value as CashPocketId;
                        setPocketId(p);
                        if (p === 'cash_usd') setPayCurrency('USD');
                        else if (p === 'cash_eur') setPayCurrency('EUR');
                        else setPayCurrency('UZS');
                      }}
                      className="ops-input w-full px-3 py-2 text-xs"
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
                    <label className="block text-xs text-[var(--text-secondary)] mb-1">
                      Сумма ({payCurrency})
                    </label>
                    <input
                      type="number"
                      step="any"
                      min="0"
                      value={payAmount}
                      onChange={(e) => setPayAmount(e.target.value)}
                      className="ops-input w-full px-3 py-2 font-mono tabular-nums text-xs"
                    />
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--text-secondary)] font-mono tabular-nums">
                  <span>Эквивалент: {formatUsd(payUsdEq)}</span>
                  {changeUzsOut > 0 && (
                    <span style={{ color: 'var(--tone-amber-fg)' }} className="font-semibold">
                      Сдача сумами: {formatUzs(changeUzsOut)}
                    </span>
                  )}
                  {!isCashPocket && (
                    <span className="text-[var(--text-muted)]">Безнал (без сдачи)</span>
                  )}
                </div>
                <button
                  type="submit"
                  className="w-full py-2.5 rounded-xl bg-[#059669] hover:bg-[#047857] text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
                >
                  <ShieldCheck className="w-4 h-4" strokeWidth={1.75} />
                  Провести оплату в кассу
                </button>
              </form>
            )}

            {/* Guests List */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-[var(--text-secondary)]">
                  Гости в номере ({booking.guests.length})
                </span>
                <span className="text-[var(--text-muted)] font-mono tabular-nums">
                  Турсбор: {formatUzs(touristTaxUzs)}
                </span>
              </div>
              <div className="divide-y divide-[var(--border-subtle)] border border-[var(--border-subtle)] rounded-2xl bg-[var(--bg-elevated)] overflow-hidden">
                {booking.guests.map((guest) => {
                  const profile = state.guestProfiles.find(
                    (p) => p.passportNo === guest.passportNo
                  );
                  return (
                    <div key={guest.id} className="p-3.5 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-[var(--text-primary)]">
                            {guest.fullName}
                          </span>
                          {profile?.tag === 'vip' && (
                            <StatusPill tone="amber" icon={Sparkles}>
                              VIP · визит #{profile.visitsCount}
                            </StatusPill>
                          )}
                          {guest.age < 16 && (
                            <StatusPill tone="cobalt">
                              Ребёнок ({guest.age} лет · 0 турсбор)
                            </StatusPill>
                          )}
                        </div>
                        <div className="text-xs text-[var(--text-muted)] font-mono tabular-nums mt-1">
                          {guest.citizenship} · {guest.passportNo} · ДР {guest.dob}
                        </div>
                      </div>
                      <div className="text-right text-xs shrink-0 space-y-1.5 flex flex-col items-end">
                        <StatusPill tone={guest.emehmonRegistered ? 'emerald' : 'rose'}>
                          {guest.emehmonRegistered ? 'E-mehmon ✓' : 'Нет E-mehmon'}
                        </StatusPill>
                        {!guest.emehmonRegistered && (
                          <button
                            type="button"
                            onClick={() => markGuestEmehmonRegistered(booking.id, guest.id)}
                            className="px-2 py-1 rounded-md bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-xs font-semibold transition-colors"
                          >
                            Оформить E-mehmon
                          </button>
                        )}
                        <div className="text-[var(--text-muted)]">
                          {guest.keyIssued ? 'Ключ на руках' : 'Без ключа'}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              {booking.notes && (
                <p className="text-xs text-[var(--text-secondary)] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-xl px-3.5 py-2.5 leading-relaxed">
                  {booking.notes}
                </p>
              )}
            </div>

            {/* Stay Periods + Extend / Move */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[var(--text-secondary)]">
                  Продление и переезд
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setShowExtendForm((s) => !s);
                    if (!moveRoomKey && availableRoomsForMove[0]) {
                      setMoveRoomKey(availableRoomsForMove[0].key);
                    }
                  }}
                  className="text-xs font-semibold hover:underline inline-flex items-center gap-1"
                  style={{ color: 'var(--tone-cobalt-fg)' }}
                >
                  <ArrowRightLeft className="w-3.5 h-3.5" strokeWidth={1.75} />
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
                      className="px-3.5 py-2.5 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] flex items-center justify-between gap-2 text-xs"
                    >
                      <span className="font-semibold text-[var(--text-primary)]">
                        {r?.code ?? seg.roomId}
                        {bd ? ` · Койка ${bd.label}` : ''}
                      </span>
                      <span className="font-mono tabular-nums text-[var(--text-secondary)]">
                        {seg.fromDate} → {seg.toDate} ({seg.nights} н. × ${seg.nightlyRateUsd})
                      </span>
                    </div>
                  );
                })}
              </div>

              {showExtendForm && (
                <form
                  onSubmit={handleExtendSubmit}
                  className="p-4 rounded-2xl bg-[var(--bg-elevated)] border space-y-3"
                  style={{ borderColor: 'var(--tone-cobalt-border)' }}
                >
                  <SegmentedControl
                    options={EXTEND_MODE_OPTIONS}
                    value={extendMode}
                    onChange={setExtendMode}
                    layoutId="folioExtendMode"
                    ariaLabel="Режим продления или переселения"
                    size="sm"
                    fullWidth
                  />
                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-xs text-[var(--text-muted)] mb-1">
                        Кол-во ночей
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={30}
                        value={extraNights}
                        onChange={(e) =>
                          setExtraNights(Math.max(1, parseInt(e.target.value, 10) || 1))
                        }
                        className="ops-input w-full px-3 py-2 font-mono tabular-nums text-xs"
                      />
                    </div>
                    {extendMode === 'move' && (
                      <div>
                        <label className="block text-xs text-[var(--text-muted)] mb-1">
                          Новая комната
                        </label>
                        <select
                          value={moveRoomKey}
                          onChange={(e) => setMoveRoomKey(e.target.value)}
                          className="ops-input w-full px-2.5 py-2 text-xs"
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
                    <div
                      className="rounded-xl border p-3 text-xs space-y-2"
                      style={{
                        backgroundColor: 'var(--tone-rose-bg)',
                        borderColor: 'var(--tone-rose-border)',
                      }}
                    >
                      <div className="flex items-start gap-1.5">
                        <AlertTriangle
                          className="w-4 h-4 shrink-0 mt-0.5"
                          strokeWidth={1.75}
                          style={{ color: 'var(--tone-rose-fg)' }}
                        />
                        <span className="text-[var(--text-secondary)]">
                          Конфликт дат (<span className="font-mono">{extFromDate} → {extToDate}</span>)
                          с {extendConflicts[0].guestName}. Выберите свободную комнату:
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
                                className="px-2.5 py-1 rounded-xl border font-semibold text-xs"
                                style={{
                                  backgroundColor: 'var(--tone-emerald-bg)',
                                  borderColor: 'var(--tone-emerald-border)',
                                  color: 'var(--tone-emerald-fg)',
                                }}
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
                    className="w-full py-2.5 rounded-xl bg-[#2563EB] hover:bg-[#1D4ED8] disabled:bg-[var(--bg-hover)] disabled:text-[var(--text-muted)] text-xs font-semibold text-white transition-colors"
                  >
                    {extendMode === 'move' ? 'Подтвердить переселение' : 'Продлить проживание'}
                  </button>
                </form>
              )}
            </div>

            {/* 1-Click Extra Charges */}
            <div className="space-y-2">
              <div className="text-xs font-semibold text-[var(--text-secondary)]">
                Дополнительные услуги (в 1 клик)
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() =>
                    addLedgerCharge(booking.id, 'late_breakfast', 'Поздний завтрак', 2)
                  }
                  className="px-3 py-2.5 rounded-xl bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)] flex items-center justify-between transition-colors"
                >
                  <span className="inline-flex items-center gap-1.5">
                    <Coffee
                      className="w-3.5 h-3.5 shrink-0"
                      strokeWidth={1.75}
                      style={{ color: 'var(--tone-amber-fg)' }}
                    />
                    Поздний завтрак
                  </span>
                  <span className="font-mono tabular-nums font-semibold">$2</span>
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
                  className="px-3 py-2.5 rounded-xl bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)] flex items-center justify-between transition-colors"
                >
                  <span className="inline-flex items-center gap-1.5">
                    <WashingMachine
                      className="w-3.5 h-3.5 shrink-0"
                      strokeWidth={1.75}
                      style={{ color: 'var(--tone-cobalt-fg)' }}
                    />
                    Стирка 22 мин
                  </span>
                  <span className="font-mono tabular-nums font-semibold">$2</span>
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
                  className="px-3 py-2.5 rounded-xl bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)] flex items-center justify-between transition-colors"
                >
                  <span className="inline-flex items-center gap-1.5">
                    <WashingMachine
                      className="w-3.5 h-3.5 shrink-0"
                      strokeWidth={1.75}
                      style={{ color: 'var(--tone-emerald-fg)' }}
                    />
                    Стирка 55 мин
                  </span>
                  <span className="font-mono tabular-nums font-semibold">$3</span>
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
                  className="px-3 py-2.5 rounded-xl bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)] flex items-center justify-between transition-colors"
                >
                  <span className="truncate">Ранний/Поздний +50%</span>
                  <span className="font-mono tabular-nums font-semibold">
                    {formatUsd(round2((lastSeg?.nightlyRateUsd ?? 18) * 0.5))}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    addLedgerCharge(booking.id, 'penalty', 'Штраф (утеря ключа / ущерб)', 10)
                  }
                  className="col-span-2 px-3 py-2.5 rounded-xl bg-[var(--bg-elevated)] hover:bg-[var(--tone-rose-bg)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)] flex items-center justify-between transition-colors"
                >
                  <span>Штраф (утеря ключа / порча имущества)</span>
                  <span
                    className="font-mono tabular-nums font-semibold"
                    style={{ color: 'var(--tone-rose-fg)' }}
                  >
                    $10
                  </span>
                </button>
              </div>
            </div>

            {/* Payment & Charge History */}
            <div className="space-y-2">
              <div className="text-xs font-semibold text-[var(--text-secondary)]">
                История оплат и начислений ({booking.ledgerEntries.length})
              </div>
              <div className="divide-y divide-[var(--border-subtle)] border border-[var(--border-subtle)] rounded-2xl bg-[var(--bg-elevated)] overflow-hidden">
                {booking.ledgerEntries.map((entry) => (
                  <div
                    key={entry.id}
                    className="px-3.5 py-2.5 flex items-center justify-between gap-3 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="text-[var(--text-primary)] font-medium truncate">
                        {entry.label}
                      </div>
                      <div className="text-[var(--text-muted)]">
                        {entry.actor}
                        {entry.originalAmount && entry.originalCurrency !== 'USD'
                          ? ` · ${entry.originalAmount.toLocaleString('ru-RU')} ${entry.originalCurrency}`
                          : ''}
                      </div>
                    </div>
                    <div
                      className="font-mono tabular-nums font-semibold shrink-0"
                      style={{
                        color:
                          entry.type === 'payment'
                            ? 'var(--tone-emerald-fg)'
                            : 'var(--text-primary)',
                      }}
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
          <div className="p-4 border-t border-[var(--border-subtle)] bg-[var(--bg-elevated)] flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => setShowPaymentForm((v) => !v)}
              className="flex-1 py-2.5 px-4 rounded-xl bg-[#059669] hover:bg-[#047857] text-white text-sm font-semibold transition-colors inline-flex items-center justify-center gap-1.5"
            >
              <Plus className="w-4 h-4" strokeWidth={1.75} />
              <Banknote className="w-4 h-4" strokeWidth={1.75} />
              Оплата
            </button>
            <button
              type="button"
              onClick={() => openCheckOutModal(booking.id)}
              className="flex-1 py-2.5 px-4 rounded-xl bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] text-[var(--text-primary)] border border-[var(--border-strong)] text-sm font-semibold transition-colors inline-flex items-center justify-center gap-2"
            >
              <DoorOpen className="w-4 h-4" strokeWidth={1.75} />
              Выселить
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};
