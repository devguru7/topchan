import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertTriangle,
  Banknote,
  Briefcase,
  CheckCircle2,
  DoorOpen,
  ShieldAlert,
  ShieldCheck,
  Star,
  X,
} from 'lucide-react';
import { useOps } from '../../context/OpsContext';
import type { AdminRole, GuestLang } from '../../types/ops';
import { calcBookingTotals, calcChangeUzs, formatUsd, formatUzs } from '../../utils/math';
import { CopyButton, SegmentedControl, StatusPill } from '../ui';

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

const REVIEW_LANG_OPTIONS: ReadonlyArray<{ id: GuestLang; label: string }> = [
  { id: 'ru', label: 'RU' },
  { id: 'en', label: 'EN' },
  { id: 'uz', label: 'UZ' },
  { id: 'zh', label: '中文' },
];

export const CheckOutModal: React.FC = () => {
  const {
    state,
    checkOutBookingId,
    closeCheckOutModal,
    checkOut,
    issueRefund,
    markGuestEmehmonRegistered,
    openBookingFolio,
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

  const blockerMessage = (() => {
    if (!debtCleared) {
      if (overrideDebt && !canOverrideDebtRole) {
        return 'Для закрытия с долгом выберите роль Старшего админа или Владельца';
      }
      if (overrideDebt) {
        return `Укажите причину особого разрешения (ещё ${Math.max(0, 8 - overrideReason.trim().length)} симв.)`;
      }
      return `Закройте долг ${formatUsd(financials.debtUsd)} или оформите особое разрешение`;
    }
    if (!emehmonCleared) {
      return `Отметьте E-mehmon для ${unregisteredForeigners.length} гост. или укажите основание (≥ 8 симв.)`;
    }
    if (!keyReturned) return 'Подтвердите возврат ключа от комнаты';
    if (!bnovoEmehmonClosed) return 'Подтвердите выписку гостя в Bnovo и E-mehmon';
    if (!slipSatisfied) return 'Подтвердите выдачу печатного квитка E-mehmon';
    if (!roomInspected) return 'Подтвердите осмотр комнаты перед выселением';
    return null;
  })();

  const refundUzsAmount =
    financials.overpaidUsd > 0 ? calcChangeUzs(financials.overpaidUsd, state.currency.exRate) : 0;

  const refundOptions = [
    { id: 'UZS' as const, label: `UZS (${formatUzs(refundUzsAmount)})` },
    { id: 'USD' as const, label: `USD (${formatUsd(financials.overpaidUsd)})` },
  ];

  const handleIssueOverpaymentRefund = () => {
    if (financials.overpaidUsd <= 0) return;
    if (refundCurrency === 'UZS') {
      issueRefund({
        bookingId: booking.id,
        pocketId: 'cash_uzs',
        currency: 'UZS',
        amountOriginal:
          refundUzsAmount > 0
            ? refundUzsAmount
            : Math.round(financials.overpaidUsd * state.currency.exRate),
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

  const reviewTemplateText = REVIEW_STAGE_TEMPLATES[reviewLang](
    booking.guests[0]?.fullName ?? 'Guest'
  );

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5 overflow-y-auto"
        style={{ backgroundColor: 'var(--backdrop-scrim)' }}
        onClick={closeCheckOutModal}
      >
        <motion.div
          initial={{ opacity: 0, y: 14, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.98 }}
          transition={{ type: 'spring', stiffness: 300, damping: 28 }}
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-label="Выселение гостя"
          className="w-full max-w-2xl rounded-2xl border border-[var(--border-strong)] bg-[var(--bg-surface)] shadow-2xl overflow-hidden my-auto max-h-[92vh] flex flex-col"
        >
          {/* Header */}
          <div className="px-5 py-4 border-b border-[var(--border-subtle)] flex items-center justify-between gap-3 shrink-0">
            <div className="flex items-center gap-3 min-w-0">
              <div
                className="w-9 h-9 rounded-xl border flex items-center justify-center shrink-0"
                style={{
                  backgroundColor: 'var(--tone-amber-bg)',
                  borderColor: 'var(--tone-amber-border)',
                  color: 'var(--tone-amber-fg)',
                }}
              >
                <DoorOpen className="w-4 h-4" strokeWidth={1.75} />
              </div>
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-[var(--text-primary)] truncate">
                  Выселение · {roomLabel}
                </h2>
                <p className="text-xs text-[var(--text-muted)] truncate">
                  {booking.guests.map((g) => g.fullName).join(', ')}
                  {booking.segments.length > 1
                    ? ` · ${booking.segments.length} периода проживания`
                    : ''}
                </p>
              </div>
            </div>
            <button
              type="button"
              aria-label="Закрыть выселение"
              onClick={closeCheckOutModal}
              className="p-2 rounded-xl text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
            >
              <X className="w-4 h-4" strokeWidth={1.75} />
            </button>
          </div>

          {/* 3-Card Status Overview */}
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {/* CARD 1: Balance / Overpayment / Debt Guard */}
            <section
              className="rounded-2xl border p-4 space-y-3"
              style={
                financials.debtUsd > 0
                  ? {
                      backgroundColor: 'var(--tone-rose-bg)',
                      borderColor: 'var(--tone-rose-border)',
                    }
                  : financials.overpaidUsd > 0
                    ? {
                        backgroundColor: 'var(--tone-cobalt-bg)',
                        borderColor: 'var(--tone-cobalt-border)',
                      }
                    : {
                        backgroundColor: 'var(--tone-emerald-bg)',
                        borderColor: 'var(--tone-emerald-border)',
                      }
              }
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-[var(--text-primary)]">
                  {financials.debtUsd > 0 ? (
                    <ShieldAlert
                      className="w-4 h-4 shrink-0"
                      strokeWidth={1.75}
                      style={{ color: 'var(--tone-rose-fg)' }}
                    />
                  ) : financials.overpaidUsd > 0 ? (
                    <Banknote
                      className="w-4 h-4 shrink-0"
                      strokeWidth={1.75}
                      style={{ color: 'var(--tone-cobalt-fg)' }}
                    />
                  ) : (
                    <CheckCircle2
                      className="w-4 h-4 shrink-0"
                      strokeWidth={1.75}
                      style={{ color: 'var(--tone-emerald-fg)' }}
                    />
                  )}
                  <span>1. Баланс и расчёт</span>
                </div>
                <StatusPill
                  tone={
                    financials.debtUsd > 0
                      ? 'rose'
                      : financials.overpaidUsd > 0
                        ? 'cobalt'
                        : 'emerald'
                  }
                  mono
                >
                  {financials.debtUsd > 0
                    ? `Долг ${formatUsd(financials.debtUsd)}`
                    : financials.overpaidUsd > 0
                      ? `Переплата ${formatUsd(financials.overpaidUsd)}`
                      : 'Баланс $0'}
                </StatusPill>
              </div>

              {financials.debtUsd > 0 ? (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-xs text-[var(--text-secondary)] max-w-md leading-relaxed">
                      Примите оплату в счёте гостя перед выселением или оформите особое разрешение
                      (только Старший админ или Владелец, причина от 8 символов).
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        closeCheckOutModal();
                        openBookingFolio(booking.id, { openPayment: true });
                      }}
                      className="px-3.5 py-2 rounded-xl bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] border border-[var(--border-strong)] text-xs font-semibold text-[var(--text-primary)] whitespace-nowrap shrink-0 transition-colors"
                    >
                      Открыть оплату
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[var(--border-subtle)]">
                    <label className="flex items-center gap-2 text-xs font-medium text-[var(--text-primary)] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={overrideDebt}
                        onChange={(e) => setOverrideDebt(e.target.checked)}
                        className="w-4 h-4 accent-[#E11D48]"
                      />
                      <span>Особое разрешение: закрыть с долгом</span>
                    </label>
                    <select
                      aria-label="Роль подтверждающего"
                      value={actorRole}
                      onChange={(e) => setActorRole(e.target.value as AdminRole)}
                      className="ops-input px-2.5 py-1.5 text-xs"
                    >
                      <option value="senior_admin">Старший админ</option>
                      <option value="owner">Владелец</option>
                      <option value="reception">Админ ресепшн (нет прав)</option>
                    </select>
                  </div>

                  {overrideDebt && !canOverrideDebtRole && (
                    <p className="text-xs font-medium" style={{ color: 'var(--tone-rose-fg)' }}>
                      Администратор смены не может закрывать выезд с долгом — требуется подтверждение
                      старшего администратора или владельца.
                    </p>
                  )}

                  {overrideDebt && canOverrideDebtRole && (
                    <div className="space-y-1">
                      <input
                        type="text"
                        value={overrideReason}
                        onChange={(e) => setOverrideReason(e.target.value)}
                        placeholder="Причина (минимум 8 символов: например, согласовано с владельцем)"
                        className="ops-input w-full px-3 py-2 text-xs"
                      />
                      <div className="text-xs text-[var(--text-muted)] font-mono tabular-nums">
                        Символов: {overrideReason.trim().length} / 8 мин.
                      </div>
                    </div>
                  )}
                </div>
              ) : financials.overpaidUsd > 0 ? (
                <div className="space-y-3">
                  <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                    К возврату по курсу обмена Ex ({state.currency.exRate.toLocaleString('ru-RU')}):{' '}
                    <strong className="font-mono tabular-nums text-[var(--text-primary)]">
                      {formatUzs(refundUzsAmount)}
                    </strong>
                    . Выдайте возврат сейчас или завершите выселение.
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <SegmentedControl
                      options={refundOptions}
                      value={refundCurrency}
                      onChange={setRefundCurrency}
                      layoutId="checkoutRefundCurr"
                      ariaLabel="Валюта возврата переплаты"
                      size="sm"
                    />
                    <button
                      type="button"
                      onClick={handleIssueOverpaymentRefund}
                      className="px-3.5 py-2 rounded-xl bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors"
                    >
                      <Banknote className="w-3.5 h-3.5" strokeWidth={1.75} />
                      Выдать возврат из кассы
                    </button>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-[var(--text-secondary)]">
                  Счёт гостя полностью оплачен — задолженностей и переплат нет.
                </p>
              )}
            </section>

            {/* CARD 2: E-mehmon Per-Guest Legal Compliance */}
            <section
              className="rounded-2xl border p-4 space-y-3"
              style={
                !hasForeigner
                  ? {
                      backgroundColor: 'var(--bg-elevated)',
                      borderColor: 'var(--border-subtle)',
                    }
                  : unregisteredForeigners.length > 0
                    ? {
                        backgroundColor: 'var(--tone-rose-bg)',
                        borderColor: 'var(--tone-rose-border)',
                      }
                    : {
                        backgroundColor: 'var(--bg-elevated)',
                        borderColor: 'var(--tone-emerald-border)',
                      }
              }
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-[var(--text-primary)]">
                  {unregisteredForeigners.length > 0 ? (
                    <ShieldAlert
                      className="w-4 h-4 shrink-0"
                      strokeWidth={1.75}
                      style={{ color: 'var(--tone-rose-fg)' }}
                    />
                  ) : (
                    <ShieldCheck
                      className="w-4 h-4 shrink-0"
                      strokeWidth={1.75}
                      style={{ color: 'var(--tone-emerald-fg)' }}
                    />
                  )}
                  <span>2. Регистрация E-mehmon</span>
                </div>
                <StatusPill
                  tone={
                    !hasForeigner
                      ? 'neutral'
                      : unregisteredForeigners.length > 0
                        ? 'rose'
                        : 'emerald'
                  }
                >
                  {!hasForeigner
                    ? 'Граждане РУз'
                    : unregisteredForeigners.length > 0
                      ? `Не отмечено: ${unregisteredForeigners.length}`
                      : 'Все зарегистрированы'}
                </StatusPill>
              </div>

              {!hasForeigner ? (
                <p className="text-xs text-[var(--text-muted)]">
                  В бронировании нет иностранных граждан — печать квитка E-mehmon не требуется.
                </p>
              ) : (
                <>
                  <div className="space-y-2">
                    {foreignGuests.map((guest) => (
                      <div
                        key={guest.id}
                        className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs"
                      >
                        <div className="min-w-0">
                          <span className="font-semibold text-[var(--text-primary)]">
                            {guest.fullName}
                          </span>
                          <span className="text-[var(--text-muted)] font-mono ml-2">
                            {guest.citizenship} · {guest.passportNo}
                          </span>
                        </div>
                        {guest.emehmonRegistered ? (
                          <StatusPill tone="emerald">Зарегистрирован</StatusPill>
                        ) : (
                          <button
                            type="button"
                            onClick={() => markGuestEmehmonRegistered(booking.id, guest.id)}
                            className="px-3 py-1.5 rounded-xl bg-[#059669] hover:bg-[#047857] text-white text-xs font-semibold transition-colors"
                          >
                            Отметить E-mehmon
                          </button>
                        )}
                      </div>
                    ))}
                  </div>

                  {unregisteredForeigners.length > 0 && (
                    <div className="space-y-2 pt-2 border-t border-[var(--border-subtle)]">
                      <label className="flex items-center gap-2 text-xs font-medium text-[var(--text-primary)] cursor-pointer">
                        <input
                          type="checkbox"
                          checked={overrideEmehmon}
                          onChange={(e) => setOverrideEmehmon(e.target.checked)}
                          className="w-4 h-4 accent-[#E11D48]"
                        />
                        <span>Оформить особое исключение E-mehmon (причина ≥ 8 символов)</span>
                      </label>
                      {overrideEmehmon && (
                        <input
                          type="text"
                          value={emehmonOverrideReason}
                          onChange={(e) => setEmehmonOverrideReason(e.target.value)}
                          placeholder="Укажите основание (дип. паспорт / технический сбой портала, номер заявки)"
                          className="ops-input w-full px-3 py-2 text-xs"
                        />
                      )}
                    </div>
                  )}
                </>
              )}
            </section>

            {/* CARD 3: Room Checklist, Luggage & Post-Checkout Review */}
            <section className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-[var(--text-primary)]">
                  3. Проверка комнаты, багаж и отзыв
                </span>
                <span className="text-xs text-[var(--text-muted)]">Обязательные пункты</span>
              </div>

              <div className="space-y-2">
                {[
                  {
                    checked: keyReturned,
                    set: setKeyReturned,
                    label: 'Ключ от комнаты и карточка сданы на ресепшн',
                    highlight: false,
                  },
                  {
                    checked: bnovoEmehmonClosed,
                    set: setBnovoEmehmonClosed,
                    label: 'Гость выписан в Bnovo и E-mehmon',
                    highlight: false,
                  },
                  ...(hasForeigner
                    ? [
                        {
                          checked: slipPrinted,
                          set: setSlipPrinted,
                          label:
                            'Квиток регистрации E-mehmon распечатан и выдан на руки (обязательно для иностранцев)',
                          highlight: true,
                        },
                      ]
                    : []),
                  {
                    checked: roomInspected,
                    set: setRoomInspected,
                    label: 'Комната осмотрена (зарядки, полотенца, целостность)',
                    highlight: false,
                  },
                ].map((item) => (
                  <label
                    key={item.label}
                    className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors text-xs ${
                      item.checked
                        ? 'border-[var(--tone-emerald-border)] bg-[var(--tone-emerald-bg)] text-[var(--text-primary)]'
                        : item.highlight
                          ? 'border-[var(--tone-amber-border)] bg-[var(--tone-amber-bg)] text-[var(--text-primary)]'
                          : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)]'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={item.checked}
                      onChange={(e) => item.set(e.target.checked)}
                      className="mt-0.5 w-4 h-4 accent-[#059669] shrink-0"
                    />
                    <span className="leading-relaxed font-medium">{item.label}</span>
                  </label>
                ))}
              </div>

              {/* Optional Luggage Storage Tag */}
              <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3.5 space-y-3">
                <label className="flex items-center gap-2.5 text-xs font-semibold text-[var(--text-primary)] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={addLuggage}
                    onChange={(e) => setAddLuggage(e.target.checked)}
                    className="w-4 h-4 accent-[#2563EB]"
                  />
                  <Briefcase
                    className="w-4 h-4 shrink-0"
                    strokeWidth={1.75}
                    style={{ color: 'var(--tone-cobalt-fg)' }}
                  />
                  <span>
                    Оставляет багаж до рейса (бирка{' '}
                    <span className="font-mono tabular-nums">#B{14 + state.luggageItems.length}</span>
                    )
                  </span>
                </label>

                {addLuggage && (
                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <div>
                      <label className="block text-xs text-[var(--text-muted)] mb-1">
                        Кол-во мест
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={10}
                        value={bagsCount}
                        onChange={(e) => setBagsCount(parseInt(e.target.value, 10) || 1)}
                        className="ops-input w-full px-3 py-1.5 font-mono tabular-nums text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-[var(--text-muted)] mb-1">
                        Время вылета
                      </label>
                      <input
                        type="time"
                        value={flightTime}
                        onChange={(e) => setFlightTime(e.target.value)}
                        className="ops-input w-full px-3 py-1.5 font-mono tabular-nums text-xs"
                      />
                    </div>
                    <div className="col-span-2">
                      <input
                        type="text"
                        value={luggageNotes}
                        onChange={(e) => setLuggageNotes(e.target.value)}
                        placeholder="Заметка (например: синий чемодан + рюкзак)"
                        className="ops-input w-full px-3 py-1.5 text-xs"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* 2-Stage Review Request */}
              <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3.5 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-semibold text-[var(--text-primary)]">
                    <Star
                      className="w-4 h-4 shrink-0"
                      strokeWidth={1.75}
                      style={{ color: 'var(--tone-amber-fg)' }}
                    />
                    <span>Запрос отзыва (WhatsApp / Telegram)</span>
                  </div>
                  <SegmentedControl
                    options={REVIEW_LANG_OPTIONS}
                    value={reviewLang}
                    onChange={setReviewLang}
                    layoutId="checkoutReviewLang"
                    ariaLabel="Язык шаблона отзыва"
                    size="sm"
                  />
                </div>
                <p className="text-xs text-[var(--text-secondary)] leading-relaxed rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] p-3">
                  {reviewTemplateText}
                </p>
                <CopyButton
                  text={reviewTemplateText}
                  label="Скопировать сообщение"
                  onCopied={() =>
                    pushToast(
                      'Приглашение на отзыв скопировано',
                      `Язык: ${reviewLang.toUpperCase()} — готово к отправке`,
                      'emerald'
                    )
                  }
                />
              </div>
            </section>
          </div>

          {/* Sticky Bottom Confirmation Bar */}
          <div className="px-5 py-3.5 border-t border-[var(--border-subtle)] bg-[var(--bg-elevated)] shrink-0 space-y-2.5">
            {blockerMessage && (
              <div
                className="flex items-center gap-2 text-xs font-medium"
                style={{ color: 'var(--tone-amber-fg)' }}
              >
                <AlertTriangle className="w-4 h-4 shrink-0" strokeWidth={1.75} />
                <span>{blockerMessage}</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={closeCheckOutModal}
                className="px-4 py-2.5 rounded-xl border border-[var(--border-strong)] bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] text-xs font-semibold text-[var(--text-primary)] transition-colors"
              >
                Отмена
              </button>
              <button
                type="button"
                disabled={!canComplete}
                onClick={handleConfirm}
                className="px-5 py-2.5 rounded-xl bg-[#059669] hover:bg-[#047857] disabled:bg-[var(--bg-hover)] disabled:text-[var(--text-muted)] text-white text-xs font-semibold transition-colors"
              >
                Завершить выселение и вызвать уборку
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};
