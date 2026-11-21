import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertTriangle,
  Banknote,
  Briefcase,
  CheckCircle2,
  Copy,
  DoorOpen,
  ShieldAlert,
  ShieldCheck,
  Star,
  X,
} from 'lucide-react';
import { useOps } from '../../context/OpsContext';
import type { AdminRole, GuestLang } from '../../types/ops';
import { calcBookingTotals, calcChangeUzs, formatUsd, formatUzs } from '../../utils/math';

const REVIEW_STAGE_TEMPLATES: Record<GuestLang, (name: string) => string> = {
  ru: (name) =>
    `Здравствуйте, ${name}! Спасибо, что выбрали Topchan Hostel в Ташкенте. Оцените, пожалуйста, ваше проживание от 1 до 5 — если что-то можно улучшить, напишите нам лично. Если всё на 5★, будем рады отзыву на Google Maps: https://g.page/r/topchan-hostel-review`,
  en: (name) =>
    `Hi ${name}! Thank you for staying at Topchan Hostel Tashkent. How would you rate your stay from 1 to 5? If anything wasn't perfect, reply directly so we can fix it. If it was 5★, we'd love your review on Google Maps: https://g.page/r/topchan-hostel-review`,
  uz: (name) =>
    `Salom, ${name}! Toshkentdagi Topchan Hostelni tanlaganingiz uchun rahmat. Yashashingizni 1 dan 5 gacha baholang — agar 5★ bo‘lsa, Google Maps sahifamizda izoh qoldirsangiz juda xursand bo‘lamiz: https://g.page/r/topchan-hostel-review`,
  zh: (name) =>
    `您好 ${name}！感谢入住塔什干 Topchan Hostel。请为本次入住打分（1–5星）：如有任何建议欢迎直接私信我们；如果满意（5★），欢迎在 Google Maps 为我们留下好评：https://g.page/r/topchan-hostel-review`,
};

export const CheckOutModal: React.FC = () => {
  const {
    state,
    checkOutBookingId,
    closeCheckOutModal,
    checkOut,
    issueRefund,
    markGuestEmehmonRegistered,
    setSelectedBookingId,
    pushToast,
  } = useOps();

  const booking = useMemo(
    () => state.bookings.find((b) => b.id === checkOutBookingId) ?? null,
    [state.bookings, checkOutBookingId]
  );

  const [keyReturned, setKeyReturned] = useState(false);
  const [bnovoEmehmonClosed, setBnovoEmehmonClosed] = useState(false);
  const [slipPrinted, setSlipPrinted] = useState(false);
  const [roomInspected, setRoomInspected] = useState(false);

  const [overrideDebt, setOverrideDebt] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const [actorRole, setActorRole] = useState<AdminRole>(state.adminRole ?? 'senior_admin');

  const [overrideEmehmon, setOverrideEmehmon] = useState(false);
  const [emehmonOverrideReason, setEmehmonOverrideReason] = useState('');
  const [refundCurrency, setRefundCurrency] = useState<'UZS' | 'USD'>('UZS');

  const [addLuggage, setAddLuggage] = useState(false);
  const [bagsCount, setBagsCount] = useState(1);
  const [flightTime, setFlightTime] = useState('23:40');
  const [luggageNotes, setLuggageNotes] = useState('');
  const [reviewLang, setReviewLang] = useState<GuestLang>('en');

  useEffect(() => {
    if (!checkOutBookingId) return;
    setKeyReturned(false);
    setBnovoEmehmonClosed(false);
    setSlipPrinted(false);
    setRoomInspected(false);
    setOverrideDebt(false);
    setOverrideReason('');
    setActorRole(state.adminRole ?? 'senior_admin');
    setOverrideEmehmon(false);
    setEmehmonOverrideReason('');
    setRefundCurrency('UZS');
    setAddLuggage(false);
    setBagsCount(1);
    setFlightTime('23:40');
    setLuggageNotes('');
  }, [checkOutBookingId, state.adminRole]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && checkOutBookingId) closeCheckOutModal();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [checkOutBookingId, closeCheckOutModal]);

  if (!booking) return null;

  const lastSeg = booking.segments[booking.segments.length - 1];
  const room = state.physicalRooms.find((r) => r.id === lastSeg?.roomId);
  const bed = room?.beds?.find((b) => b.id === lastSeg?.bedId);
  const roomLabel = room ? (bed ? `${room.code} · Койка ${bed.label}` : room.code) : 'Номер';

  const financials = calcBookingTotals(booking);
  const foreignGuests = booking.guests.filter((g) => g.isForeigner);
  const hasForeigner = foreignGuests.length > 0;
  const unregisteredForeigners = foreignGuests.filter((g) => !g.emehmonRegistered);

  const canOverrideDebtRole = actorRole === 'owner' || actorRole === 'senior_admin';
  const debtCleared =
    financials.debtUsd <= 0 ||
    (overrideDebt && canOverrideDebtRole && overrideReason.trim().length >= 8);

  const emehmonCleared =
    unregisteredForeigners.length === 0 ||
    (overrideEmehmon && emehmonOverrideReason.trim().length >= 8);

  const slipSatisfied = !hasForeigner || slipPrinted;

  const canComplete =
    keyReturned &&
    bnovoEmehmonClosed &&
    slipSatisfied &&
    roomInspected &&
    debtCleared &&
    emehmonCleared;

  const refundUzsAmount =
    financials.overpaidUsd > 0 ? calcChangeUzs(financials.overpaidUsd, state.currency.exRate) : 0;

  const handleIssueOverpaymentRefund = () => {
    if (financials.overpaidUsd <= 0) return;
    if (refundCurrency === 'UZS') {
      issueRefund({
        bookingId: booking.id,
        pocketId: 'cash_uzs',
        currency: 'UZS',
        amountOriginal: refundUzsAmount > 0 ? refundUzsAmount : Math.round(financials.overpaidUsd * state.currency.exRate),
        amountUsd: financials.overpaidUsd,
      });
    } else {
      issueRefund({
        bookingId: booking.id,
        pocketId: 'cash_usd',
        currency: 'USD',
        amountOriginal: financials.overpaidUsd,
        amountUsd: financials.overpaidUsd,
      });
    }
  };

  const handleConfirm = () => {
    if (!canComplete) return;
    checkOut({
      bookingId: booking.id,
      debtOverrideReason:
        financials.debtUsd > 0 && overrideDebt ? overrideReason.trim() : undefined,
      emehmonOverrideReason:
        unregisteredForeigners.length > 0 && overrideEmehmon
          ? emehmonOverrideReason.trim()
          : undefined,
      slipPrintedConfirmed: hasForeigner ? slipPrinted : false,
      emehmonClosedConfirmed: bnovoEmehmonClosed,
      actorRole,
      createLuggage: addLuggage
        ? {
            bagsCount,
            flightTime,
            notes: luggageNotes.trim(),
          }
        : undefined,
    });
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5 overflow-y-auto"
        onClick={closeCheckOutModal}
      >
        <motion.div
          initial={{ opacity: 0, y: 16, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 10, scale: 0.98 }}
          transition={{ type: 'spring', stiffness: 300, damping: 28 }}
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-label="Анти-забывашка Check-out"
          className="w-full max-w-xl bg-[#121826] border border-white/[0.1] rounded-2xl shadow-2xl overflow-hidden my-auto"
        >
          <div className="px-5 py-4 border-b border-white/[0.08] flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <DoorOpen className="w-5 h-5 text-[#F59E0B]" />
              <div>
                <h2 className="text-base font-semibold text-white">
                  Выселение (Check-out Guard) · {roomLabel}
                </h2>
                <p className="text-xs text-slate-400">
                  {booking.guests.map((g) => g.fullName).join(', ')}
                  {booking.segments.length > 1
                    ? ` · ${booking.segments.length} сегмента проживания`
                    : ''}
                </p>
              </div>
            </div>
            <button
              type="button"
              aria-label="Закрыть выселение"
              onClick={closeCheckOutModal}
              className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-[#1A2234]"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-5 space-y-4 max-h-[80vh] overflow-y-auto">
            {/* Debt / Overpayment / Zero Balance Status Block */}
            {financials.debtUsd > 0 ? (
              <div className="bg-[#F43F5E]/10 border border-[#F43F5E]/35 rounded-xl p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2.5">
                    <ShieldAlert className="w-5 h-5 text-[#F43F5E] shrink-0 mt-0.5" />
                    <div>
                      <div className="text-sm font-semibold text-[#F43F5E] font-mono tabular-nums">
                        Обнаружен неоплаченный долг: {formatUsd(financials.debtUsd)}
                      </div>
                      <p className="text-xs text-slate-300 mt-0.5">
                        Примите оплату в фолио гостя перед выселением или оформите принудительное
                        закрытие (только Старший админ / Владелец + причина ≥ 8 символов).
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      closeCheckOutModal();
                      setSelectedBookingId(booking.id);
                    }}
                    className="px-3 py-1.5 rounded-lg bg-[#1A2234] hover:bg-slate-700 text-xs font-medium text-white border border-white/[0.1] whitespace-nowrap shrink-0"
                  >
                    Открыть оплату
                  </button>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <label className="flex items-center gap-2 text-xs text-slate-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={overrideDebt}
                      onChange={(e) => setOverrideDebt(e.target.checked)}
                      className="w-4 h-4 accent-[#F43F5E]"
                    />
                    <span>Закрыть с долгом (в аудит-лог)</span>
                  </label>
                  <select
                    aria-label="Роль подтверждающего"
                    value={actorRole}
                    onChange={(e) => setActorRole(e.target.value as AdminRole)}
                    className="bg-[#0B0F17] border border-white/[0.12] rounded-lg px-2.5 py-1 text-xs text-slate-200"
                  >
                    <option value="senior_admin">Старший админ</option>
                    <option value="owner">Владелец</option>
                    <option value="reception">Админ ресепшн (нет прав)</option>
                  </select>
                </div>

                {overrideDebt && !canOverrideDebtRole && (
                  <p className="text-xs text-[#F43F5E]">
                    Ночной администратор не может закрывать выезд с долгом — требуется подтверждение
                    старшего администратора или владельца.
                  </p>
                )}

                {overrideDebt && canOverrideDebtRole && (
                  <div className="space-y-1">
                    <input
                      type="text"
                      value={overrideReason}
                      onChange={(e) => setOverrideReason(e.target.value)}
                      placeholder="Причина (минимум 8 символов: напр. согласовано с владельцем, перевод завтра)"
                      className="w-full bg-[#0B0F17] border border-[#F43F5E]/40 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-[#F43F5E]"
                    />
                    <div className="text-[11px] text-slate-400 font-mono tabular-nums">
                      Символов: {overrideReason.trim().length} / 8 мин.
                    </div>
                  </div>
                )}
              </div>
            ) : financials.overpaidUsd > 0 ? (
              <div className="bg-[#3B82F6]/10 border border-[#3B82F6]/35 rounded-xl p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2.5">
                    <Banknote className="w-5 h-5 text-[#3B82F6] shrink-0 mt-0.5" />
                    <div>
                      <div className="text-sm font-semibold text-blue-200 font-mono tabular-nums">
                        Переплата / Возврат гостю: {formatUsd(financials.overpaidUsd)}
                      </div>
                      <p className="text-xs text-slate-300 mt-0.5 font-mono tabular-nums">
                        Эквивалент к возврату по курсу Ex ({state.currency.exRate}):{' '}
                        <strong className="text-white">{formatUzs(refundUzsAmount)}</strong>. Можно
                        выдать возврат сейчас или завершить выезд (переплата не блокирует Check-out).
                      </p>
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="inline-flex p-0.5 bg-[#0B0F17] border border-white/[0.1] rounded-lg text-xs">
                    <button
                      type="button"
                      onClick={() => setRefundCurrency('UZS')}
                      className={`px-2.5 py-1 rounded-md font-medium ${
                        refundCurrency === 'UZS' ? 'bg-[#1A2234] text-white' : 'text-slate-400'
                      }`}
                    >
                      UZS ({formatUzs(refundUzsAmount)})
                    </button>
                    <button
                      type="button"
                      onClick={() => setRefundCurrency('USD')}
                      className={`px-2.5 py-1 rounded-md font-medium ${
                        refundCurrency === 'USD' ? 'bg-[#1A2234] text-white' : 'text-slate-400'
                      }`}
                    >
                      USD ({formatUsd(financials.overpaidUsd)})
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={handleIssueOverpaymentRefund}
                    className="px-3.5 py-1.5 rounded-lg bg-[#3B82F6] hover:bg-blue-500 text-white text-xs font-semibold inline-flex items-center gap-1.5"
                  >
                    <Banknote className="w-3.5 h-3.5" />
                    Выдать возврат из кассы
                  </button>
                </div>
              </div>
            ) : (
              <div className="bg-[#10B981]/10 border border-[#10B981]/30 rounded-xl px-4 py-3 flex items-center gap-2.5 text-sm text-[#10B981]">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>Баланс сходится в $0 — долгов у гостя нет.</span>
              </div>
            )}

            {/* E-mehmon Per-Guest Legal Compliance Block */}
            {hasForeigner && (
              <div
                className={`rounded-xl p-4 space-y-3 border ${
                  unregisteredForeigners.length > 0
                    ? 'bg-[#F43F5E]/10 border-[#F43F5E]/40'
                    : 'bg-[#0B0F17] border-[#10B981]/30'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-semibold">
                    {unregisteredForeigners.length > 0 ? (
                      <ShieldAlert className="w-4 h-4 text-[#F43F5E] shrink-0" />
                    ) : (
                      <ShieldCheck className="w-4 h-4 text-[#10B981] shrink-0" />
                    )}
                    <span
                      className={
                        unregisteredForeigners.length > 0 ? 'text-[#F43F5E]' : 'text-[#10B981]'
                      }
                    >
                      {unregisteredForeigners.length > 0
                        ? `Нарушение E-mehmon: не зарегистрировано иностранцев — ${unregisteredForeigners.length}`
                        : 'Все иностранные гости зарегистрированы в E-mehmon'}
                    </span>
                  </div>
                </div>

                <div className="space-y-1.5">
                  {foreignGuests.map((guest) => (
                    <div
                      key={guest.id}
                      className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-lg bg-[#0B0F17]/90 border border-white/[0.06] text-xs"
                    >
                      <div>
                        <span className="font-medium text-white">{guest.fullName}</span>
                        <span className="text-slate-400 font-mono ml-2">
                          {guest.citizenship} · {guest.passportNo}
                        </span>
                      </div>
                      {guest.emehmonRegistered ? (
                        <span className="text-[#10B981] font-medium">Зарегистрирован ✓</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => markGuestEmehmonRegistered(booking.id, guest.id)}
                          className="px-2.5 py-1 rounded-md bg-[#10B981] hover:bg-emerald-500 text-slate-950 font-semibold"
                        >
                          Отметить E-mehmon
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                {unregisteredForeigners.length > 0 && (
                  <div className="space-y-2 pt-1">
                    <label className="flex items-center gap-2 text-xs text-rose-200 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={overrideEmehmon}
                        onChange={(e) => setOverrideEmehmon(e.target.checked)}
                        className="w-4 h-4 accent-[#F43F5E]"
                      />
                      <span>Оформить исключение E-mehmon (требуется причина ≥ 8 символов)</span>
                    </label>
                    {overrideEmehmon && (
                      <input
                        type="text"
                        value={emehmonOverrideReason}
                        onChange={(e) => setEmehmonOverrideReason(e.target.value)}
                        placeholder="Укажите основание (напр. дип. паспорт / сбой портала E-mehmon, тикет #...)"
                        className="w-full bg-[#0B0F17] border border-[#F43F5E]/40 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-[#F43F5E]"
                      />
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Hard Guard Checkboxes */}
            <div className="bg-[#0B0F17] border border-white/[0.08] rounded-xl p-4 space-y-2.5">
              <div className="text-xs font-semibold text-slate-300">
                Обязательная проверка (кнопка разблокируется после всех пунктов)
              </div>

              <label className="flex items-start gap-3 p-2 rounded-lg hover:bg-[#1A2234]/60 cursor-pointer text-sm text-slate-200">
                <input
                  type="checkbox"
                  checked={keyReturned}
                  onChange={(e) => setKeyReturned(e.target.checked)}
                  className="mt-0.5 w-4 h-4 accent-[#10B981]"
                />
                <span>Ключ от комнаты и карточка сданы на ресепшн</span>
              </label>

              <label className="flex items-start gap-3 p-2 rounded-lg hover:bg-[#1A2234]/60 cursor-pointer text-sm text-slate-200">
                <input
                  type="checkbox"
                  checked={bnovoEmehmonClosed}
                  onChange={(e) => setBnovoEmehmonClosed(e.target.checked)}
                  className="mt-0.5 w-4 h-4 accent-[#10B981]"
                />
                <span>Гость выписан из Bnovo и E-mehmon</span>
              </label>

              {hasForeigner && (
                <label className="flex items-start gap-3 p-2 rounded-lg bg-[#F59E0B]/10 border border-[#F59E0B]/25 cursor-pointer text-sm text-amber-200">
                  <input
                    type="checkbox"
                    checked={slipPrinted}
                    onChange={(e) => setSlipPrinted(e.target.checked)}
                    className="mt-0.5 w-4 h-4 accent-[#F59E0B]"
                  />
                  <span>
                    Квиток регистрации E-mehmon распечатан и выдан на руки (обязательно для
                    иностранцев)
                  </span>
                </label>
              )}

              <label className="flex items-start gap-3 p-2 rounded-lg hover:bg-[#1A2234]/60 cursor-pointer text-sm text-slate-200">
                <input
                  type="checkbox"
                  checked={roomInspected}
                  onChange={(e) => setRoomInspected(e.target.checked)}
                  className="mt-0.5 w-4 h-4 accent-[#10B981]"
                />
                <span>Комната осмотрена (зарядки, полотенца, целостность)</span>
              </label>
            </div>

            {/* Optional Luggage Storage Tag */}
            <div className="bg-[#0B0F17] border border-white/[0.08] rounded-xl p-4 space-y-3">
              <label className="flex items-center gap-2.5 text-sm font-medium text-white cursor-pointer">
                <input
                  type="checkbox"
                  checked={addLuggage}
                  onChange={(e) => setAddLuggage(e.target.checked)}
                  className="w-4 h-4 accent-[#3B82F6]"
                />
                <Briefcase className="w-4 h-4 text-[#3B82F6]" />
                <span>
                  Оставляет багаж до рейса (создать бирку #B{14 + state.luggageItems.length})
                </span>
              </label>

              {addLuggage && (
                <div className="grid grid-cols-2 gap-3 pt-1">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Кол-во мест</label>
                    <input
                      type="number"
                      min={1}
                      max={10}
                      value={bagsCount}
                      onChange={(e) => setBagsCount(parseInt(e.target.value, 10) || 1)}
                      className="w-full bg-[#121826] border border-white/[0.1] rounded-lg px-3 py-1.5 font-mono text-sm text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Время вылета</label>
                    <input
                      type="time"
                      value={flightTime}
                      onChange={(e) => setFlightTime(e.target.value)}
                      className="w-full bg-[#121826] border border-white/[0.1] rounded-lg px-3 py-1.5 font-mono text-sm text-white"
                    />
                  </div>
                  <div className="col-span-2">
                    <input
                      type="text"
                      value={luggageNotes}
                      onChange={(e) => setLuggageNotes(e.target.value)}
                      placeholder="Заметка (например: синий чемодан + пакет сувениров)"
                      className="w-full bg-[#121826] border border-white/[0.1] rounded-lg px-3 py-1.5 text-xs text-white"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* 2-Stage Post-Checkout Review Booster */}
            <div className="bg-[#0B0F17] border border-white/[0.08] rounded-xl p-4 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-white">
                  <Star className="w-4 h-4 text-[#F59E0B]" />
                  <span>Review Booster (2 этапа: 1–5★ лично → Google Maps)</span>
                </div>
                <div className="flex items-center gap-1">
                  {(['ru', 'en', 'uz', 'zh'] as GuestLang[]).map((l) => (
                    <button
                      key={l}
                      type="button"
                      onClick={() => setReviewLang(l)}
                      className={`px-2 py-0.5 rounded-md text-xs font-bold uppercase whitespace-nowrap ${
                        reviewLang === l
                          ? 'bg-[#F59E0B] text-slate-950'
                          : 'bg-[#121826] text-slate-400 hover:text-white'
                      }`}
                    >
                      {l === 'zh' ? '中文' : l}
                    </button>
                  ))}
                </div>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed bg-[#121826] border border-white/[0.06] rounded-lg p-2.5">
                {REVIEW_STAGE_TEMPLATES[reviewLang](booking.guests[0]?.fullName ?? 'Guest')}
              </p>
              <button
                type="button"
                onClick={() => {
                  const text = REVIEW_STAGE_TEMPLATES[reviewLang](
                    booking.guests[0]?.fullName ?? 'Guest'
                  );
                  navigator.clipboard?.writeText(text).catch(() => {});
                  pushToast(
                    'Приглашение на отзыв скопировано',
                    `Язык: ${reviewLang.toUpperCase()} — готово для WhatsApp / Telegram`,
                    'emerald'
                  );
                }}
                className="px-3 py-1.5 rounded-lg bg-[#1A2234] hover:bg-slate-700 border border-white/[0.08] text-xs font-medium text-slate-200 inline-flex items-center gap-1.5"
              >
                <Copy className="w-3.5 h-3.5" />
                Скопировать для WhatsApp / Telegram
              </button>
            </div>

            {!canComplete && (
              <div className="flex items-center gap-2 text-xs text-[#F59E0B]">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>
                  Подтвердите все обязательные пункты, статус E-mehmon и расчёт с гостем для
                  завершения выселения.
                </span>
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-2 border-t border-white/[0.08]">
              <button
                type="button"
                onClick={closeCheckOutModal}
                className="px-4 py-2.5 rounded-lg bg-[#1A2234] hover:bg-slate-700 text-sm font-medium text-slate-200"
              >
                Отмена
              </button>
              <button
                type="button"
                disabled={!canComplete}
                onClick={handleConfirm}
                className="px-5 py-2.5 rounded-lg bg-[#10B981] hover:bg-emerald-600 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 text-sm font-semibold transition-colors"
              >
                Завершить Check-out и вызвать горничную
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};
