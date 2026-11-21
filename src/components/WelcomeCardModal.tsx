import React, { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Check,
  Coffee,
  Copy,
  KeyRound,
  MapPin,
  Printer,
  Shirt,
  Wifi,
  X,
} from 'lucide-react';
import { useOps } from '../context/OpsContext';
import { TopchanMark } from './ui';
import { SPRING_SNAPPY } from '../utils/motion';
import { getTashkentTodayIso } from '../utils/time';

export const WelcomeCardModal: React.FC = () => {
  const {
    state,
    welcomeCardBookingId,
    closeWelcomeCardModal,
    pushToast,
  } = useOps();

  const [lang, setLang] = useState<'ru' | 'en'>('ru');
  const [copied, setCopied] = useState(false);

  const booking = useMemo(
    () => state.bookings.find((b) => b.id === welcomeCardBookingId) ?? null,
    [state.bookings, welcomeCardBookingId]
  );

  const cardInfo = useMemo(() => {
    if (!booking) return null;
    const firstSeg = booking.segments[0];
    const lastSeg = booking.segments[booking.segments.length - 1];
    const room = state.physicalRooms.find((r) => r.id === lastSeg?.roomId);
    const bed = lastSeg?.bedId ? room?.beds?.find((b) => b.id === lastSeg.bedId) : undefined;
    const roomLabel = room ? (bed ? `${room.code} · ${bed.label}` : room.code) : 'Topchan Room';
    const guestNames = booking.guests.map((g) => g.fullName).join(', ');
    return {
      guestNames,
      roomLabel,
      fromDate: firstSeg?.fromDate ?? state.operationalDate ?? getTashkentTodayIso(),
      toDate: lastSeg?.toDate ?? state.operationalDate ?? getTashkentTodayIso(),
      bnovoId: booking.bnovoId,
      wifiSsid: state.integrations.wifiSsid || 'Topchan_5G',
      wifiPass: state.integrations.wifiPass || 'topchan42',
      doorCode: state.integrations.doorCode || '4242',
    };
  }, [booking, state.physicalRooms, state.integrations, state.operationalDate]);

  const messengerText = useMemo(() => {
    if (!cardInfo) return '';
    if (lang === 'en') {
      return [
        `Welcome to Topchan Hostel, ${cardInfo.guestNames}!`,
        `Room / Bed: ${cardInfo.roomLabel} (${cardInfo.fromDate} → ${cardInfo.toDate})`,
        `Wi-Fi: ${cardInfo.wifiSsid} · Password: ${cardInfo.wifiPass}`,
        `Main door code: ${cardInfo.doorCode}`,
        `Free breakfast: 08:00–10:00 (late breakfast after 10:00 — $2)`,
        `Check-in: 14:00 · Check-out: 12:00`,
        `Laundry: Fast 22 min — $2 · Medium 55 min — $3`,
        `Kitchen disinfection: daily at 00:00`,
        `Address: 104, 8-Mart st., Mirabad district, Tashkent (3 km from airport)`,
      ].join('\n');
    }
    return [
      `Добро пожаловать в Topchan Hostel, ${cardInfo.guestNames}!`,
      `Комната / койка: ${cardInfo.roomLabel} (${cardInfo.fromDate} → ${cardInfo.toDate})`,
      `Wi-Fi: ${cardInfo.wifiSsid} · Пароль: ${cardInfo.wifiPass}`,
      `Код входной двери: ${cardInfo.doorCode}`,
      `Бесплатный завтрак: 08:00–10:00 (поздний после 10:00 — $2)`,
      `Заезд: 14:00 · Выезд: до 12:00`,
      `Стирка: быстрая 22 мин — $2 · средняя 55 мин — $3`,
      `Дезинфекция кухни: ежедневно в 00:00`,
      `Адрес: Ташкент, Мирабадский р-н, ул. 8 Марта, 104 (3 км от аэропорта)`,
    ].join('\n');
  }, [cardInfo, lang]);

  const handleCopy = () => {
    if (!messengerText) return;
    navigator.clipboard?.writeText(messengerText).catch(() => {});
    setCopied(true);
    pushToast(
      'Welcome-карта скопирована',
      lang === 'ru'
        ? 'Текст готов для отправки гостю в WhatsApp / Telegram'
        : 'English welcome message copied for WhatsApp / Telegram',
      'emerald'
    );
    window.setTimeout(() => setCopied(false), 1800);
  };

  const handlePrint = () => {
    document.body.dataset.printTarget = 'welcome-card';
    window.print();
    window.setTimeout(() => {
      delete document.body.dataset.printTarget;
    }, 600);
  };

  return (
    <AnimatePresence>
      {booking && cardInfo && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5 overflow-y-auto"
          style={{ backgroundColor: 'var(--backdrop-scrim)' }}
          onClick={closeWelcomeCardModal}
        >
          <motion.div
            initial={{ opacity: 0, y: 14, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={SPRING_SNAPPY}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Welcome-карта гостя"
            style={{ boxShadow: 'var(--shadow-popover)' }}
            className="w-full max-w-xl rounded-2xl border border-[var(--border-strong)] bg-[var(--bg-surface)] overflow-hidden my-auto"
          >
            {/* Header */}
            <div className="px-5 py-3.5 border-b border-[var(--border-subtle)] flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <TopchanMark size={26} />
                <div>
                  <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                    Welcome-карта гостя
                  </h2>
                  <p className="text-[11px] text-[var(--text-muted)]">
                    Печать на ресепшн или отправка в WhatsApp / Telegram
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="inline-flex rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-0.5 text-xs">
                  <button
                    type="button"
                    onClick={() => setLang('ru')}
                    className={`px-2.5 py-1 rounded-md font-semibold transition-colors ${
                      lang === 'ru'
                        ? 'bg-[var(--bg-surface)] text-[var(--text-primary)]'
                        : 'text-[var(--text-muted)]'
                    }`}
                  >
                    RU
                  </button>
                  <button
                    type="button"
                    onClick={() => setLang('en')}
                    className={`px-2.5 py-1 rounded-md font-semibold transition-colors ${
                      lang === 'en'
                        ? 'bg-[var(--bg-surface)] text-[var(--text-primary)]'
                        : 'text-[var(--text-muted)]'
                    }`}
                  >
                    EN
                  </button>
                </div>
                <button
                  type="button"
                  aria-label="Закрыть Welcome-карту"
                  onClick={closeWelcomeCardModal}
                  className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                >
                  <X className="w-4 h-4" strokeWidth={1.75} />
                </button>
              </div>
            </div>

            {/* Printable Card Preview */}
            <div className="p-5">
              <div
                id="printable-welcome-card"
                className="rounded-2xl border border-[var(--border-strong)] bg-[var(--bg-elevated)] p-5 space-y-4"
              >
                <div className="flex items-start justify-between gap-3 border-b border-[var(--border-subtle)] pb-3.5">
                  <div className="flex items-center gap-2.5">
                    <TopchanMark size={32} />
                    <div>
                      <div className="text-sm font-bold tracking-tight text-[var(--text-primary)]">
                        Topchan Hostel · Tashkent
                      </div>
                      <div className="text-[11px] text-[var(--text-muted)]">
                        {lang === 'ru'
                          ? 'Добро пожаловать! Ваш путеводитель по хостелу'
                          : 'Welcome home in Tashkent! Your quick stay card'}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-xs font-bold text-[var(--brand-primary)]">
                      {cardInfo.roomLabel}
                    </div>
                    <div className="font-mono text-[11px] tabular-nums text-[var(--text-muted)]">
                      {cardInfo.fromDate} → {cardInfo.toDate}
                    </div>
                  </div>
                </div>

                <div>
                  <div className="text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
                    {lang === 'ru' ? 'Гость' : 'Guest'}
                  </div>
                  <div className="text-base font-bold text-[var(--text-primary)] mt-0.5">
                    {cardInfo.guestNames}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
                    <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
                      <Wifi className="w-3.5 h-3.5" strokeWidth={1.75} />
                      <span>Wi-Fi ({cardInfo.wifiSsid})</span>
                    </div>
                    <div className="font-mono text-sm font-bold text-[var(--text-primary)] mt-1">
                      {cardInfo.wifiPass}
                    </div>
                  </div>

                  <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
                    <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
                      <KeyRound className="w-3.5 h-3.5" strokeWidth={1.75} />
                      <span>{lang === 'ru' ? 'Код входной двери' : 'Front Door Code'}</span>
                    </div>
                    <div className="font-mono text-sm font-bold text-[var(--text-primary)] mt-1">
                      {cardInfo.doorCode}
                    </div>
                  </div>
                </div>

                <div className="space-y-2 text-xs text-[var(--text-secondary)]">
                  <div className="flex items-start gap-2">
                    <Coffee className="w-3.5 h-3.5 shrink-0 mt-0.5 text-[var(--brand-primary)]" strokeWidth={1.75} />
                    <span>
                      {lang === 'ru'
                        ? 'Бесплатный завтрак: 08:00–10:00 (поздний после 10:00 — $2). Выезд до 12:00.'
                        : 'Free breakfast: 08:00–10:00 (late breakfast after 10:00 — $2). Check-out by 12:00.'}
                    </span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Shirt className="w-3.5 h-3.5 shrink-0 mt-0.5 text-[var(--brand-primary)]" strokeWidth={1.75} />
                    <span>
                      {lang === 'ru'
                        ? 'Стирка: быстрая 22 мин ($2) / средняя 55 мин ($3). Дезинфекция кухни в 00:00.'
                        : 'Laundry: Fast 22 min ($2) / Medium 55 min ($3). Kitchen disinfection daily at 00:00.'}
                    </span>
                  </div>
                  <div className="flex items-start gap-2">
                    <MapPin className="w-3.5 h-3.5 shrink-0 mt-0.5 text-[var(--brand-primary)]" strokeWidth={1.75} />
                    <span>
                      {lang === 'ru'
                        ? 'Ташкент, Мирабадский р-н, ул. 8 Марта, 104 (3 км от аэропорта)'
                        : '104, 8-Mart st., Mirabad district, Tashkent (3 km from airport)'}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Footer actions */}
            <div className="px-5 py-3.5 border-t border-[var(--border-subtle)] bg-[var(--bg-elevated)] flex flex-wrap items-center justify-between gap-2.5">
              <button
                type="button"
                onClick={handlePrint}
                className="px-3.5 py-2 rounded-xl border border-[var(--border-strong)] bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] text-xs font-semibold text-[var(--text-primary)] inline-flex items-center gap-1.5 transition-colors"
              >
                <Printer className="w-3.5 h-3.5" strokeWidth={1.75} />
                Печать карточки
              </button>
              <button
                type="button"
                onClick={handleCopy}
                className="ops-brand-btn px-4 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5"
              >
                {copied ? (
                  <Check className="w-3.5 h-3.5" strokeWidth={2} />
                ) : (
                  <Copy className="w-3.5 h-3.5" strokeWidth={1.75} />
                )}
                {copied ? 'Скопировано!' : 'Скопировать для WhatsApp / Telegram'}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
