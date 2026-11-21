import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Briefcase,
  FastForward,
  Minus,
  Package,
  Phone,
  Plane,
  Plus,
  Printer,
  QrCode,
  Star,
  WashingMachine,
  Wifi,
} from 'lucide-react';
import { useOps, useTimers } from '../../context/OpsContext';
import type { ServicesSubTab } from '../../context/UIContext';
import type { GuestLang, LaundryJob, TransferStatus } from '../../types/ops';
import { formatTimer } from '../../utils/math';
import { CopyButton, EmptyState, SegmentedControl, StatusPill, type StatusTone } from '../ui';
import { HousekeepingBoard } from '../HousekeepingBoard';
import { LuggageTracker } from '../LuggageTracker';

const QR_COPY: Record<
  GuestLang,
  {
    welcome: string;
    subtitle: string;
    wifiLabel: string;
    doorLabel: string;
    breakfastNote: string;
    extendBtn: string;
    laundryFastBtn: string;
    laundryMedBtn: string;
    transferBtn: string;
    lateBreakfastBtn: string;
  }
> = {
  ru: {
    welcome: 'Добро пожаловать в Topchan',
    subtitle: 'Быстрый заказ услуг прямо на ресепшн без ожидания',
    wifiLabel: 'Wi-Fi',
    doorLabel: 'Код двери',
    breakfastNote: 'Бесплатный завтрак 08:00–10:00 · Кухня открыта до 00:00',
    extendBtn: 'Продлить ночь напрямую',
    laundryFastBtn: 'Быстрая стирка 22 мин ($2)',
    laundryMedBtn: 'Средняя стирка 55 мин ($3)',
    transferBtn: 'Трансфер в аэропорт ($5)',
    lateBreakfastBtn: 'Поздний завтрак ($2)',
  },
  en: {
    welcome: 'Welcome to Topchan Hostel',
    subtitle: 'Instant reception requests from your phone',
    wifiLabel: 'Wi-Fi',
    doorLabel: 'Door code',
    breakfastNote: 'Free breakfast 08:00–10:00 · Kitchen closes at 00:00',
    extendBtn: 'Extend 1 night direct',
    laundryFastBtn: 'Quick wash 22 min ($2)',
    laundryMedBtn: 'Medium wash 55 min ($3)',
    transferBtn: 'Airport transfer 3 km ($5)',
    lateBreakfastBtn: 'Late breakfast ($2)',
  },
  uz: {
    welcome: 'Topchan Hostelga xush kelibsiz',
    subtitle: 'Resepshnga tezkor xizmat buyurtma qiling',
    wifiLabel: 'Wi-Fi',
    doorLabel: 'Eshik kodi',
    breakfastNote: 'Bepul nonushta 08:00–10:00 · Oshxona 00:00 gacha',
    extendBtn: 'Yana 1 kecha uzaytirish',
    laundryFastBtn: 'Tez yuvish 22 daq ($2)',
    laundryMedBtn: 'Oʻrtacha yuvish 55 daq ($3)',
    transferBtn: 'Aeroport transfer ($5)',
    lateBreakfastBtn: 'Kechki nonushta ($2)',
  },
  zh: {
    welcome: '欢迎入住 Topchan 青旅',
    subtitle: '一键向前台发送服务请求',
    wifiLabel: '无线网络',
    doorLabel: '门禁密码',
    breakfastNote: '免费早餐 08:00–10:00 · 厨房开放至 00:00',
    extendBtn: '直接续住一晚',
    laundryFastBtn: '快洗 22 分钟 ($2)',
    laundryMedBtn: '标准洗 55 分钟 ($3)',
    transferBtn: '机场接送 3公里 ($5)',
    lateBreakfastBtn: '延迟早餐 ($2)',
  },
};

const TRANSFER_STATUS_META: Record<TransferStatus, { text: string; tone: StatusTone }> = {
  assigned: { text: 'Назначен', tone: 'cobalt' },
  en_route: { text: 'В пути', tone: 'amber' },
  picked_up: { text: 'Забрал', tone: 'emerald' },
};

const LANG_OPTIONS: ReadonlyArray<{ id: GuestLang; label: string }> = [
  { id: 'ru', label: 'RU' },
  { id: 'en', label: 'EN' },
  { id: 'uz', label: 'UZ' },
  { id: 'zh', label: '中文' },
];

const REVIEW_TEMPLATES: Record<GuestLang, (guest: string) => string> = {
  ru: (guest) =>
    `Здравствуйте, ${guest}! Спасибо, что остановились в Topchan Hostel (Ташкент).\n` +
    `Шаг 1: Всё ли прошло идеально? Если были замечания — напишите прямо сюда, мы исправим.\n` +
    `Шаг 2: Если вам понравилось (5★), будем очень благодарны за короткий отзыв на Google Maps: https://maps.google.com/?q=Topchan+Hostel+Tashkent`,
  en: (guest) =>
    `Hi ${guest}! Thank you for staying at Topchan Hostel Tashkent.\n` +
    `Step 1: Did everything go smoothly? Reply here if anything could be improved.\n` +
    `Step 2: If you loved your stay (5★), a quick Google Maps review means a lot to our team: https://maps.google.com/?q=Topchan+Hostel+Tashkent`,
  uz: (guest) =>
    `Assalomu alaykum, ${guest}! Topchan Hostel (Toshkent)da qolganingiz uchun rahmat.\n` +
    `1-bosqich: Hammasi yoqdimi? Taklifingiz bo'lsa shu yerga yozing.\n` +
    `2-bosqich: Agar 5★ bo'lsa, Google Mapsda qisqa fikr qoldiring: https://maps.google.com/?q=Topchan+Hostel+Tashkent`,
  zh: (guest) =>
    `您好 ${guest}！感谢入住塔什干 Topchan 青旅。\n` +
    `第 1 步：入住体验是否顺利？如有任何建议请直接回复我们。\n` +
    `第 2 步：如果您满意（5★），欢迎在 Google 地图留下简短好评：https://maps.google.com/?q=Topchan+Hostel+Tashkent`,
};

/**
 * Isolated component subscribed to TimerContext so 1-second ticks
 * only re-render the running laundry cards instead of the whole ServicesTab.
 */
const LaundryJobCard: React.FC<{
  job: LaundryJob;
  onSpeedUp: (jobId: string, minutes: number) => void;
}> = ({ job, onSpeedUp }) => {
  const { getRemainingSeconds } = useTimers();
  const remaining = job.status === 'completed' ? 0 : getRemainingSeconds(job);
  const pct =
    job.totalSeconds > 0
      ? Math.min(100, Math.round(((job.totalSeconds - remaining) / job.totalSeconds) * 100))
      : 100;

  return (
    <div className="p-4 rounded-2xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-[var(--text-primary)] truncate">
            {job.roomLabel} · {job.guestName}
          </div>
          <div className="text-xs text-[var(--text-muted)]">
            {job.mode === 'fast' ? 'Быстрая 22 мин ($2)' : 'Средняя 55 мин ($3)'}
          </div>
        </div>
        <div
          className="text-lg font-bold font-mono tabular-nums shrink-0"
          style={{
            color:
              job.status === 'completed' ? 'var(--tone-emerald-fg)' : 'var(--tone-cobalt-fg)',
          }}
        >
          {job.status === 'completed' ? 'Готово!' : formatTimer(remaining)}
        </div>
      </div>

      {/* Animated Progress Bar */}
      <div className="w-full h-2 rounded-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] overflow-hidden">
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{
            width: `${pct}%`,
            backgroundColor: job.status === 'completed' ? 'var(--status-inhouse)' : 'var(--brand-primary)',
          }}
        />
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-mono tabular-nums text-[var(--text-muted)]">
          Прогресс: {pct}%
        </span>
        {job.status === 'running' ? (
          <button
            type="button"
            onClick={() => onSpeedUp(job.id, 10)}
            className="px-3 py-1.5 rounded-xl bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] text-xs font-semibold text-[var(--text-primary)] inline-flex items-center gap-1.5 border border-[var(--border-subtle)] transition-colors"
          >
            <FastForward
              className="w-3.5 h-3.5 shrink-0"
              strokeWidth={1.75}
              style={{ color: 'var(--tone-amber-fg)' }}
            />
            +10 мин (ускорить)
          </button>
        ) : (
          <StatusPill tone="emerald">Завершено</StatusPill>
        )}
      </div>
    </div>
  );
};

export const ServicesTab: React.FC = () => {
  const {
    state,
    servicesSubTab,
    setServicesSubTab,
    startLaundryJob,
    speedUpLaundry,
    addTransferJob,
    cycleTransferStatus,
    adjustStock,
    submitGuestQrRequest,
    openQrPosterModal,
    pushToast,
  } = useOps();

  const activeBookings = useMemo(
    () => state.bookings.filter((b) => b.status === 'active'),
    [state.bookings]
  );

  // Laundry launch form
  const [laundryBookingId, setLaundryBookingId] = useState(activeBookings[0]?.id ?? '');
  const [laundryMode, setLaundryMode] = useState<'fast' | 'medium'>('fast');
  const [chargeLaundry, setChargeLaundry] = useState(true);

  // Transfer form
  const [trGuest, setTrGuest] = useState('');
  const [trDir, setTrDir] = useState<'to_airport' | 'from_airport'>('to_airport');
  const [trTime, setTrTime] = useState('18:30');
  const [trFlight, setTrFlight] = useState('HY-601');
  const [trDriver, setTrDriver] = useState('Рустам (Cobalt)');

  // QR Concierge Preview
  const [qrLang, setQrLang] = useState<GuestLang>('ru');
  const [qrBookingId, setQrBookingId] = useState(activeBookings[0]?.id ?? '');

  // Review Booster state
  const [reviewLang, setReviewLang] = useState<GuestLang>('ru');
  const [reviewBookingId, setReviewBookingId] = useState(
    state.bookings.find((b) => b.status === 'checked_out')?.id ?? activeBookings[0]?.id ?? ''
  );

  const qrCopy = QR_COPY[qrLang];
  const pendingHkTasks = state.housekeepingTasks.filter((t) => t.status !== 'approved');
  const activeLaundryCount = state.laundryJobs.filter((j) => j.status === 'running').length;
  const storedLuggageCount = state.luggageItems.filter((l) => l.status === 'stored').length;
  const lowStockCount = state.stockItems.filter((i) => i.quantity <= i.minThreshold).length;

  const subTabOptions = useMemo<
    Array<{
      id: ServicesSubTab;
      label: string;
      icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
      badge?: number;
    }>
  >(
    () => [
      {
        id: 'laundry_hk',
        label: 'Стирка и уборка',
        icon: WashingMachine,
        badge: pendingHkTasks.length + activeLaundryCount,
      },
      {
        id: 'luggage_transfers',
        label: 'Багаж и трансферы',
        icon: Briefcase,
        badge: storedLuggageCount,
      },
      {
        id: 'stock_contacts',
        label: 'Запасы и контакты',
        icon: Package,
        badge: lowStockCount,
      },
      {
        id: 'qr_guide',
        label: 'QR-гид гостя',
        icon: QrCode,
      },
    ],
    [pendingHkTasks.length, activeLaundryCount, storedLuggageCount, lowStockCount]
  );

  const handleStartLaundry = (e: React.FormEvent) => {
    e.preventDefault();
    const bkg = activeBookings.find((b) => b.id === laundryBookingId) ?? activeBookings[0];
    if (!bkg) return;
    const seg = bkg.segments[bkg.segments.length - 1];
    const room = state.physicalRooms.find((r) => r.id === seg?.roomId);
    const bed = room?.beds?.find((bd) => bd.id === seg?.bedId);
    const roomLabel = room ? (bed ? `${room.code} ${bed.label}` : room.code) : 'Номер';
    startLaundryJob({
      bookingId: bkg.id,
      guestName: bkg.guests[0]?.fullName ?? 'Гость',
      roomLabel,
      mode: laundryMode,
      chargeToFolio: chargeLaundry,
    });
  };

  const handleAddTransfer = (e: React.FormEvent) => {
    e.preventDefault();
    if (!trGuest.trim()) return;
    addTransferJob({
      guestName: trGuest.trim(),
      roomLabel: 'Ресепшн',
      direction: trDir,
      pickupTime: trTime,
      flightNumber: trFlight.trim() || '—',
      priceUsd: 5,
      driverName: trDriver.trim() || 'Водитель Topchan',
    });
    setTrGuest('');
  };

  const selectedQrBooking =
    activeBookings.find((b) => b.id === qrBookingId) ?? activeBookings[0];

  const reviewTargetGuestName =
    (state.bookings.find((b) => b.id === reviewBookingId) ?? state.bookings[0])?.guests[0]
      ?.fullName ?? 'Гость';
  const reviewMessageText = REVIEW_TEMPLATES[reviewLang](reviewTargetGuestName);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[var(--text-primary)]">
            Сервисы, Уборка и QR-гид гостя
          </h1>
          <p className="text-xs sm:text-sm text-[var(--text-muted)] mt-0.5">
            Таймеры стирки, приёмка комнат, багаж, трансферы в аэропорт и гостевой QR-консьерж
          </p>
        </div>
        <button
          type="button"
          onClick={() => openQrPosterModal()}
          className="px-3.5 py-2.5 rounded-xl bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] hover:border-[var(--border-strong)] text-xs font-semibold text-[var(--text-primary)] inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0"
        >
          <Printer
            className="w-4 h-4 shrink-0"
            strokeWidth={1.75}
            style={{ color: 'var(--tone-emerald-fg)' }}
          />
          Распечатать QR-постер
        </button>
      </div>

      {/* Sub-Tab Switcher */}
      <SegmentedControl
        options={subTabOptions}
        value={servicesSubTab}
        onChange={setServicesSubTab}
        layoutId="servicesSubTab"
        ariaLabel="Разделы сервисов"
      />

      {/* SUB-TAB 1: Laundry & Housekeeping */}
      {servicesSubTab === 'laundry_hk' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Washing Machine Live Timers */}
          <section className="lg:col-span-6 ops-card p-5 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <WashingMachine
                  className="w-4 h-4 shrink-0"
                  strokeWidth={1.75}
                  style={{ color: 'var(--tone-cobalt-fg)' }}
                />
                <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                  Стиральная машина
                </h2>
              </div>
              <StatusPill tone="neutral" mono>
                22 мин ($2) · 55 мин ($3)
              </StatusPill>
            </div>

            <form
              onSubmit={handleStartLaundry}
              className="space-y-3 rounded-2xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] p-4"
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <select
                  aria-label="Выберите гостя для стирки"
                  value={laundryBookingId}
                  onChange={(e) => setLaundryBookingId(e.target.value)}
                  className="ops-input px-3 py-2 text-xs"
                >
                  {activeBookings.map((b) => {
                    const rm = state.physicalRooms.find(
                      (r) => r.id === b.segments[b.segments.length - 1]?.roomId
                    );
                    return (
                      <option key={b.id} value={b.id}>
                        {rm?.code} · {b.guests[0]?.fullName}
                      </option>
                    );
                  })}
                </select>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => setLaundryMode('fast')}
                    className={`py-2 px-2 rounded-xl text-xs font-semibold border transition-colors ${
                      laundryMode === 'fast'
                        ? 'bg-[#2563EB] text-white border-transparent'
                        : 'bg-[var(--bg-surface)] text-[var(--text-secondary)] border-[var(--border-subtle)]'
                    }`}
                  >
                    22 мин · $2
                  </button>
                  <button
                    type="button"
                    onClick={() => setLaundryMode('medium')}
                    className={`py-2 px-2 rounded-xl text-xs font-semibold border transition-colors ${
                      laundryMode === 'medium'
                        ? 'bg-[#2563EB] text-white border-transparent'
                        : 'bg-[var(--bg-surface)] text-[var(--text-secondary)] border-[var(--border-subtle)]'
                    }`}
                  >
                    55 мин · $3
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="inline-flex items-center gap-2 text-xs text-[var(--text-secondary)] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={chargeLaundry}
                    onChange={(e) => setChargeLaundry(e.target.checked)}
                    className="w-4 h-4 accent-[#059669]"
                  />
                  Добавить в счёт гостя
                </label>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-[#059669] hover:bg-[#047857] text-white text-xs font-semibold whitespace-nowrap transition-colors"
                >
                  Запустить стирку
                </button>
              </div>
            </form>

            {state.laundryJobs.length === 0 ? (
              <EmptyState
                icon={WashingMachine}
                title="Активных стирок нет"
                description="Запустите цикл выше или нажмите «Стирка» прямо на карточке комнаты."
              />
            ) : (
              <div className="space-y-2.5">
                {state.laundryJobs.map((job) => (
                  <LaundryJobCard key={job.id} job={job} onSpeedUp={speedUpLaundry} />
                ))}
              </div>
            )}
          </section>

          {/* Live Housekeeping Board */}
          <section className="lg:col-span-6 ops-card p-5">
            <HousekeepingBoard compact />
          </section>
        </div>
      )}

      {/* SUB-TAB 2: Luggage & Lost-Found + Airport Transfers */}
      {servicesSubTab === 'luggage_transfers' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Luggage Storage & Lost/Found Tracker */}
          <section className="lg:col-span-6 ops-card p-5">
            <LuggageTracker />
          </section>

          {/* Airport Transfers */}
          <section className="lg:col-span-6 ops-card p-5 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Plane
                  className="w-4 h-4 shrink-0"
                  strokeWidth={1.75}
                  style={{ color: 'var(--tone-cobalt-fg)' }}
                />
                <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                  Трансферы (3 км до аэропорта Ташкент)
                </h2>
              </div>
              <StatusPill tone="neutral" mono>
                {state.transfers.length}
              </StatusPill>
            </div>

            <form
              onSubmit={handleAddTransfer}
              className="grid grid-cols-2 sm:grid-cols-4 gap-2 rounded-2xl bg-[var(--bg-elevated)] p-3.5 border border-[var(--border-subtle)]"
            >
              <input
                type="text"
                value={trGuest}
                onChange={(e) => setTrGuest(e.target.value)}
                placeholder="Имя гостя"
                className="ops-input col-span-2 px-3 py-2 text-xs"
              />
              <select
                value={trDir}
                onChange={(e) => setTrDir(e.target.value as typeof trDir)}
                className="ops-input px-2.5 py-2 text-xs"
              >
                <option value="to_airport">В аэропорт</option>
                <option value="from_airport">Из аэропорта</option>
              </select>
              <input
                type="time"
                value={trTime}
                onChange={(e) => setTrTime(e.target.value)}
                className="ops-input px-2 py-2 font-mono tabular-nums text-xs"
              />
              <input
                type="text"
                value={trFlight}
                onChange={(e) => setTrFlight(e.target.value)}
                placeholder="Рейс (HY-601)"
                className="ops-input px-2.5 py-2 font-mono text-xs"
              />
              <input
                type="text"
                value={trDriver}
                onChange={(e) => setTrDriver(e.target.value)}
                placeholder="Водитель / авто"
                className="ops-input col-span-2 px-2.5 py-2 text-xs"
              />
              <button
                type="submit"
                className="py-2 px-3 rounded-xl bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-xs font-semibold transition-colors"
              >
                Добавить
              </button>
            </form>

            {state.transfers.length === 0 ? (
              <EmptyState
                icon={Plane}
                title="Трансферов пока нет"
                description="Добавьте заказ трансфера до аэропорта или встречу гостя по номеру рейса."
              />
            ) : (
              <div className="space-y-2.5">
                {state.transfers.map((tr) => {
                  const meta = TRANSFER_STATUS_META[tr.status];
                  return (
                    <div
                      key={tr.id}
                      className="p-3.5 rounded-2xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] flex flex-wrap items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-[var(--text-primary)]">
                          <span className="font-mono tabular-nums">{tr.pickupTime}</span> ·{' '}
                          {tr.guestName}{' '}
                          <span className="text-xs font-normal text-[var(--text-muted)]">
                            ({tr.direction === 'to_airport' ? 'В аэропорт' : 'Встреча'})
                          </span>
                        </div>
                        <div className="text-xs text-[var(--text-muted)] font-mono tabular-nums mt-0.5">
                          Рейс {tr.flightNumber} · {tr.driverName} · ${tr.priceUsd}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => cycleTransferStatus(tr.id)}
                        className="inline-flex items-center gap-1 transition-opacity hover:opacity-85"
                        title="Нажмите, чтобы переключить статус трансфера"
                      >
                        <StatusPill tone={meta.tone}>{meta.text} →</StatusPill>
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      )}

      {/* SUB-TAB 3: Stock, Review Templates & Emergency Contacts */}
      {servicesSubTab === 'stock_contacts' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Consumables Stock */}
          <section className="lg:col-span-6 ops-card p-5 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Package
                  className="w-4 h-4 shrink-0"
                  strokeWidth={1.75}
                  style={{ color: 'var(--tone-amber-fg)' }}
                />
                <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                  Запасы и расходники хостела
                </h2>
              </div>
              {lowStockCount > 0 && (
                <StatusPill tone="rose" icon={AlertTriangle}>
                  Пополнить: {lowStockCount}
                </StatusPill>
              )}
            </div>

            <div className="divide-y divide-[var(--border-subtle)] border border-[var(--border-subtle)] rounded-2xl bg-[var(--bg-elevated)] overflow-hidden">
              {state.stockItems.map((item) => {
                const isLow = item.quantity <= item.minThreshold;
                return (
                  <div
                    key={item.id}
                    className="px-4 py-3 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-[var(--text-primary)] truncate">
                        {item.name}
                      </div>
                      <div className="text-xs flex items-center gap-1.5 mt-0.5">
                        {isLow ? (
                          <span
                            className="inline-flex items-center gap-1 font-semibold"
                            style={{ color: 'var(--tone-rose-fg)' }}
                          >
                            <AlertTriangle className="w-3.5 h-3.5" strokeWidth={1.75} />
                            Низкий остаток (порог {item.minThreshold})
                          </span>
                        ) : (
                          <span className="text-[var(--text-muted)]">
                            Норма (минимум {item.minThreshold} {item.unit})
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        aria-label={`Списать 1 ${item.name}`}
                        onClick={() => adjustStock(item.id, -1)}
                        className="w-8 h-8 rounded-xl bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] text-[var(--text-primary)] border border-[var(--border-subtle)] flex items-center justify-center transition-colors"
                      >
                        <Minus className="w-3.5 h-3.5" strokeWidth={1.75} />
                      </button>
                      <span
                        className="w-12 text-center font-mono tabular-nums text-sm font-bold"
                        style={{
                          color: isLow ? 'var(--tone-rose-fg)' : 'var(--text-primary)',
                        }}
                      >
                        {item.quantity}
                      </span>
                      <button
                        type="button"
                        aria-label={`Добавить 5 ${item.name}`}
                        onClick={() => adjustStock(item.id, 5)}
                        className="h-8 px-2.5 rounded-xl bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] text-xs font-mono font-bold border border-[var(--border-subtle)] inline-flex items-center gap-1 transition-colors"
                        style={{ color: 'var(--tone-emerald-fg)' }}
                      >
                        <Plus className="w-3 h-3" strokeWidth={2} />5
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Right column: Review Booster + Emergency Directory */}
          <div className="lg:col-span-6 space-y-5">
            {/* Review Booster */}
            <section className="ops-card p-5 space-y-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Star
                    className="w-4 h-4 shrink-0"
                    strokeWidth={1.75}
                    style={{ color: 'var(--tone-amber-fg)' }}
                  />
                  <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                    Запрос отзыва после выезда
                  </h2>
                </div>
                <SegmentedControl
                  options={LANG_OPTIONS}
                  value={reviewLang}
                  onChange={setReviewLang}
                  layoutId="servicesReviewLang"
                  ariaLabel="Язык шаблона отзыва"
                  size="sm"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <select
                  aria-label="Гость для запроса отзыва"
                  value={reviewBookingId}
                  onChange={(e) => setReviewBookingId(e.target.value)}
                  className="ops-input flex-1 min-w-[180px] px-3 py-2 text-xs"
                >
                  {state.bookings.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.guests[0]?.fullName ?? 'Гость'} (
                      {b.status === 'checked_out' ? 'Выехал' : 'Проживает'})
                    </option>
                  ))}
                </select>
                <CopyButton
                  text={reviewMessageText}
                  label="Копировать"
                  variant="primary"
                  onCopied={() =>
                    pushToast(
                      'Запрос отзыва скопирован',
                      `Готово для WhatsApp / Telegram (${reviewLang.toUpperCase()})`,
                      'emerald'
                    )
                  }
                />
              </div>

              <pre className="p-3.5 rounded-2xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-xs text-[var(--text-secondary)] whitespace-pre-wrap font-sans leading-relaxed">
                {reviewMessageText}
              </pre>
            </section>

            {/* Emergency Contacts */}
            <section className="ops-card p-5 space-y-3.5">
              <div className="flex items-center gap-2">
                <Phone
                  className="w-4 h-4 shrink-0"
                  strokeWidth={1.75}
                  style={{ color: 'var(--tone-emerald-fg)' }}
                />
                <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                  Экстренные контакты и службы (Ташкент)
                </h2>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {state.emergencyContacts.map((c) => (
                  <div
                    key={c.id}
                    className="p-3.5 rounded-2xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] space-y-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <StatusPill tone="cobalt">{c.category}</StatusPill>
                      <CopyButton
                        text={c.phone}
                        label={c.phone}
                        size="sm"
                        variant="ghost"
                        onCopied={() =>
                          pushToast('Номер скопирован', `${c.name} · ${c.phone}`, 'emerald')
                        }
                      />
                    </div>
                    <div className="text-sm font-semibold text-[var(--text-primary)]">
                      {c.name}{' '}
                      <span className="font-normal text-[var(--text-muted)]">· {c.role}</span>
                    </div>
                    <p className="text-xs text-[var(--text-secondary)]">{c.note}</p>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>
      )}

      {/* SUB-TAB 4: Interactive Guest QR Concierge */}
      {servicesSubTab === 'qr_guide' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Controls & Explanation */}
          <section className="lg:col-span-6 ops-card p-5 space-y-4">
            <div className="flex items-center gap-2">
              <QrCode
                className="w-4 h-4 shrink-0"
                strokeWidth={1.75}
                style={{ color: 'var(--tone-emerald-fg)' }}
              />
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                Настройка и тест гостевого QR-консьержа
              </h2>
            </div>

            <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
              Гость сканирует QR-код в комнате, видит пароль Wi-Fi, код двери и отправляет заявки
              прямо в ленту Telegram-бота ресепшна на своём языке (RU / EN / UZ / 中文).
            </p>

            <div className="space-y-3">
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1.5">
                  Язык интерфейса гостя
                </label>
                <SegmentedControl
                  options={LANG_OPTIONS}
                  value={qrLang}
                  onChange={setQrLang}
                  layoutId="servicesQrLang"
                  ariaLabel="Язык QR-консьержа"
                />
              </div>

              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1.5">
                  От имени какого гостя протестировать заявку
                </label>
                <select
                  value={selectedQrBooking?.id ?? ''}
                  onChange={(e) => setQrBookingId(e.target.value)}
                  className="ops-input w-full px-3 py-2.5 text-xs"
                >
                  {activeBookings.map((b) => {
                    const rm = state.physicalRooms.find(
                      (r) => r.id === b.segments[b.segments.length - 1]?.roomId
                    );
                    return (
                      <option key={b.id} value={b.id}>
                        {rm?.code} · {b.guests[0]?.fullName}
                      </option>
                    );
                  })}
                </select>
              </div>
            </div>

            <div className="pt-2 border-t border-[var(--border-subtle)] flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={() => {
                  const roomId =
                    selectedQrBooking?.segments[selectedQrBooking.segments.length - 1]?.roomId ??
                    state.physicalRooms[0]?.id;
                  openQrPosterModal(roomId);
                }}
                className="px-4 py-2.5 rounded-xl bg-[#059669] hover:bg-[#047857] text-white text-xs font-semibold inline-flex items-center gap-2 transition-colors"
              >
                <Printer className="w-4 h-4 shrink-0" strokeWidth={1.75} />
                Распечатать QR-постер (A5 / A4)
              </button>
            </div>
          </section>

          {/* Clean Phone Mockup Frame */}
          <section className="lg:col-span-6 ops-card p-6 flex justify-center">
            <div
              className="w-full max-w-[332px] bg-[var(--bg-canvas)] border-2 border-[var(--border-strong)] rounded-[32px] p-4 space-y-4"
              style={{ boxShadow: 'var(--shadow-popover)' }}
            >
              <div className="w-16 h-1.5 bg-[var(--border-strong)] rounded-full mx-auto" />
              <div className="space-y-1">
                <div
                  className="text-xs font-mono font-semibold"
                  style={{ color: 'var(--tone-emerald-fg)' }}
                >
                  TOPCHAN HOSTEL · TASHKENT
                </div>
                <h3 className="text-base font-bold text-[var(--text-primary)] leading-snug">
                  {qrCopy.welcome}
                </h3>
                <p className="text-xs text-[var(--text-muted)]">{qrCopy.subtitle}</p>
              </div>

              <div className="grid grid-cols-2 gap-2 p-3 rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs font-mono">
                <div>
                  <div className="text-[var(--text-muted)] flex items-center gap-1">
                    <Wifi
                      className="w-3.5 h-3.5 shrink-0"
                      strokeWidth={1.75}
                      style={{ color: 'var(--tone-cobalt-fg)' }}
                    />
                    {qrCopy.wifiLabel}
                  </div>
                  <div className="text-[var(--text-primary)] font-bold mt-0.5">
                    {state.integrations.wifiPass}
                  </div>
                </div>
                <div>
                  <div className="text-[var(--text-muted)]">{qrCopy.doorLabel}</div>
                  <div className="text-[var(--text-primary)] font-bold mt-0.5">
                    {state.integrations.doorCode}
                  </div>
                </div>
              </div>

              <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                {qrCopy.breakfastNote}
              </p>

              <div className="space-y-2">
                {[
                  { key: 'extend' as const, label: qrCopy.extendBtn, primary: true },
                  { key: 'laundry_fast' as const, label: qrCopy.laundryFastBtn, primary: false },
                  { key: 'laundry_medium' as const, label: qrCopy.laundryMedBtn, primary: false },
                  { key: 'transfer' as const, label: qrCopy.transferBtn, primary: false },
                  { key: 'late_breakfast' as const, label: qrCopy.lateBreakfastBtn, primary: false },
                ].map((btn) => (
                  <button
                    key={btn.key}
                    type="button"
                    disabled={!selectedQrBooking}
                    onClick={() =>
                      selectedQrBooking &&
                      submitGuestQrRequest({
                        bookingId: selectedQrBooking.id,
                        serviceType: btn.key,
                        lang: qrLang,
                      })
                    }
                    className={`w-full py-2.5 px-3 rounded-xl text-xs font-semibold transition-colors ${
                      btn.primary
                        ? 'bg-[#059669] hover:bg-[#047857] text-white'
                        : 'bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] text-[var(--text-primary)] border border-[var(--border-subtle)]'
                    }`}
                  >
                    {btn.label}
                  </button>
                ))}
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
};
