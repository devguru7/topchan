import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertTriangle,
  Briefcase,
  CheckCircle2,
  Copy,
  DoorOpen,
  ShieldAlert,
  Star,
  X,
} from 'lucide-react';
import { useOps } from '../../context/OpsContext';
import type { GuestLang } from '../../types/ops';
import { calcBookingTotals, formatUsd } from '../../utils/math';

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
    setAddLuggage(false);
    setBagsCount(1);
    setFlightTime('23:40');
    setLuggageNotes('');
  }, [checkOutBookingId]);

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
  const hasForeigner = booking.guests.some((g) => g.isForeigner);
  const debtCleared =
    financials.debtUsd === 0 || (overrideDebt && overrideReason.trim().length >= 5);
  const slipSatisfied = !hasForeigner || slipPrinted;

  const canComplete =
    keyReturned && bnovoEmehmonClosed && slipSatisfied && roomInspected && debtCleared;

  const handleConfirm = () => {
    if (!canComplete) return;
    checkOut({
      bookingId: booking.id,
      debtOverrideReason:
        financials.debtUsd > 0 && overrideDebt ? overrideReason.trim() : undefined,
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
            {/* Debt Status Block */}
            {financials.debtUsd > 0 ? (
              <div className="bg-[#F43F5E]/10 border border-[#F43F5E]/35 rounded-xl p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2.5">
                    <ShieldAlert className="w-5 h-5 text-[#F43F5E] shrink-0 mt-0.5" />
                    <div>
                      <div className="text-sm font-semibold text-[#F43F5E]">
                        Обнаружен неоплаченный долг: {formatUsd(financials.debtUsd)}
                      </div>
                      <p className="text-xs text-slate-300 mt-0.5">
                        Примите оплату в фолио гостя перед выселением или оформите принудительное
                        закрытие с указанием причины в аудит-лог.
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

                <label className="flex items-center gap-2 text-xs text-slate-200 cursor-pointer pt-1">
                  <input
                    type="checkbox"
                    checked={overrideDebt}
                    onChange={(e) => setOverrideDebt(e.target.checked)}
                    className="w-4 h-4 accent-[#F43F5E]"
                  />
                  <span>Закрыть с долгом (требуется причина для аудит-лога)</span>
                </label>

                {overrideDebt && (
                  <input
                    type="text"
                    value={overrideReason}
                    onChange={(e) => setOverrideReason(e.target.value)}
                    placeholder="Укажите причину (например: гость переведёт на карту позже / согласовано с владельцем)"
                    className="w-full bg-[#0B0F17] border border-[#F43F5E]/40 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-[#F43F5E]"
                  />
                )}
              </div>
            ) : (
              <div className="bg-[#10B981]/10 border border-[#10B981]/30 rounded-xl px-4 py-3 flex items-center gap-2.5 text-sm text-[#10B981]">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>Баланс сходится в $0 — долгов у гостя нет.</span>
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
                      className={`px-2 py-0.5 rounded-md text-xs font-bold uppercase ${
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
                  Отметьте все пункты проверки и урегулируйте долг для завершения выселения.
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
