import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Briefcase,
  Camera,
  CheckCircle2,
  FastForward,
  Minus,
  Package,
  Phone,
  Plane,
  Plus,
  QrCode,
  Sparkles,
  WashingMachine,
  Wifi,
} from 'lucide-react';
import { useOps } from '../../context/OpsContext';
import type { GuestLang, TransferStatus } from '../../types/ops';
import { formatTimer } from '../../utils/math';

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

const TRANSFER_STATUS_LABEL: Record<TransferStatus, { text: string; color: string }> = {
  assigned: { text: 'Назначен', color: 'text-[#3B82F6]' },
  en_route: { text: 'В пути', color: 'text-[#F59E0B]' },
  picked_up: { text: 'Забрал', color: 'text-[#10B981]' },
};

export const ServicesTab: React.FC = () => {
  const {
    state,
    startLaundryJob,
    speedUpLaundry,
    maidMarkCleaned,
    adminApproveHousekeeping,
    addLuggageItem,
    releaseLuggageItem,
    addTransferJob,
    cycleTransferStatus,
    adjustStock,
    submitGuestQrRequest,
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

  // Luggage form
  const [lugGuest, setLugGuest] = useState('');
  const [lugBags, setLugBags] = useState('1');
  const [lugFlight, setLugFlight] = useState('23:40');
  const [lugNotes, setLugNotes] = useState('');

  // Transfer form
  const [trGuest, setTrGuest] = useState('');
  const [trDir, setTrDir] = useState<'to_airport' | 'from_airport'>('to_airport');
  const [trTime, setTrTime] = useState('18:30');
  const [trFlight, setTrFlight] = useState('HY-601');
  const [trDriver, setTrDriver] = useState('Рустам (Cobalt)');

  // QR Concierge Preview
  const [qrLang, setQrLang] = useState<GuestLang>('ru');
  const [qrBookingId, setQrBookingId] = useState(activeBookings[0]?.id ?? '');

  const qrCopy = QR_COPY[qrLang];
  const pendingHkTasks = state.housekeepingTasks.filter((t) => t.status !== 'approved');

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

  const handleAddLuggage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!lugGuest.trim()) return;
    addLuggageItem({
      guestName: lugGuest.trim(),
      bagsCount: Math.max(1, parseInt(lugBags, 10) || 1),
      flightTime: lugFlight,
      notes: lugNotes.trim(),
    });
    setLugGuest('');
    setLugNotes('');
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white">
          Сервисы, Горничные и Гостевой QR-консьерж
        </h1>
        <p className="text-xs sm:text-sm text-slate-400 mt-0.5">
          Таймеры стирки · приёмка комнат · багаж и трансферы в аэропорт (3 км) · расходники ·
          симулятор QR-телефона
        </p>
      </div>

      {/* Row 1: Laundry Timers + Housekeeping Queue */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Washing Machine Live Timers */}
        <section className="lg:col-span-6 bg-[#121826] border border-white/[0.08] rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <WashingMachine className="w-4 h-4 text-[#3B82F6]" />
              <h2 className="text-sm font-semibold text-white">Стиральная машина (таймеры)</h2>
            </div>
            <span className="text-xs text-slate-400">22 мин ($2) · 55 мин ($3)</span>
          </div>

          <form onSubmit={handleStartLaundry} className="space-y-3 bg-[#0B0F17] border border-white/[0.08] rounded-xl p-3.5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <select
                aria-label="Выберите гостя для стирки"
                value={laundryBookingId}
                onChange={(e) => setLaundryBookingId(e.target.value)}
                className="bg-[#121826] border border-white/[0.1] rounded-lg px-3 py-2 text-xs text-white"
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
                  className={`py-2 px-2 rounded-lg text-xs font-medium transition-colors ${
                    laundryMode === 'fast'
                      ? 'bg-[#3B82F6] text-white'
                      : 'bg-[#121826] text-slate-300 border border-white/[0.08]'
                  }`}
                >
                  22 мин · $2
                </button>
                <button
                  type="button"
                  onClick={() => setLaundryMode('medium')}
                  className={`py-2 px-2 rounded-lg text-xs font-medium transition-colors ${
                    laundryMode === 'medium'
                      ? 'bg-[#3B82F6] text-white'
                      : 'bg-[#121826] text-slate-300 border border-white/[0.08]'
                  }`}
                >
                  55 мин · $3
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between gap-2">
              <label className="inline-flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={chargeLaundry}
                  onChange={(e) => setChargeLaundry(e.target.checked)}
                  className="w-4 h-4 accent-[#10B981]"
                />
                Добавить сумму в фолио гостя
              </label>
              <button
                type="submit"
                className="px-4 py-2 rounded-lg bg-[#10B981] hover:bg-emerald-600 text-slate-950 text-xs font-semibold whitespace-nowrap"
              >
                Запустить стирку
              </button>
            </div>
          </form>

          <div className="space-y-2.5">
            {state.laundryJobs.map((job) => {
              const pct =
                job.totalSeconds > 0
                  ? Math.min(100, Math.round(((job.totalSeconds - job.remainingSeconds) / job.totalSeconds) * 100))
                  : 100;
              return (
                <div
                  key={job.id}
                  className="p-3.5 rounded-xl bg-[#0B0F17] border border-white/[0.08] space-y-2.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-semibold text-white">
                        {job.roomLabel} · {job.guestName}
                      </div>
                      <div className="text-xs text-slate-400">
                        {job.mode === 'fast' ? 'Быстрая 22 мин ($2)' : 'Средняя 55 мин ($3)'}
                      </div>
                    </div>
                    <div className="text-right">
                      <div
                        className={`text-lg font-bold font-mono tabular-nums ${
                          job.status === 'completed' ? 'text-[#10B981]' : 'text-[#3B82F6]'
                        }`}
                      >
                        {job.status === 'completed' ? 'Готово!' : formatTimer(job.remainingSeconds)}
                      </div>
                    </div>
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-[#1A2234] overflow-hidden">
                    <div
                      className={`h-full transition-all duration-500 ${
                        job.status === 'completed' ? 'bg-[#10B981]' : 'bg-[#3B82F6]'
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  {job.status === 'running' && (
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => speedUpLaundry(job.id, 10)}
                        className="px-2.5 py-1 rounded-lg bg-[#1A2234] hover:bg-slate-700 text-xs text-slate-200 inline-flex items-center gap-1.5 border border-white/[0.08]"
                      >
                        <FastForward className="w-3.5 h-3.5 text-[#F59E0B]" />
                        +10 мин тест
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* Housekeeping Queue */}
        <section className="lg:col-span-6 bg-[#121826] border border-white/[0.08] rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-[#F59E0B]" />
              <h2 className="text-sm font-semibold text-white">
                Очередь уборки (Горничные → Админ)
              </h2>
            </div>
            <span className="text-xs font-mono tabular-nums text-slate-400">
              Активных: {pendingHkTasks.length}
            </span>
          </div>

          {pendingHkTasks.length === 0 ? (
            <div className="p-6 rounded-xl bg-[#0B0F17] border border-white/[0.06] text-center space-y-1">
              <CheckCircle2 className="w-6 h-6 text-[#10B981] mx-auto" />
              <p className="text-sm font-medium text-white">Все комнаты убраны и приняты</p>
              <p className="text-xs text-slate-400">
                После выселения гостя новая задача появится здесь автоматически
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {pendingHkTasks.map((task) => (
                <div
                  key={task.id}
                  className="p-4 rounded-xl bg-[#0B0F17] border border-white/[0.08] space-y-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-sm font-semibold text-white">{task.roomLabel}</div>
                      <p className="text-xs text-slate-400 mt-0.5">{task.notes}</p>
                    </div>
                    <span
                      className={`text-xs font-medium shrink-0 ${
                        task.status === 'maid_done' ? 'text-[#10B981]' : 'text-[#F59E0B]'
                      }`}
                    >
                      {task.status === 'maid_done'
                        ? 'Горничная: фото прикреплено'
                        : 'Требуется уборка'}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {task.status === 'dirty' && (
                      <button
                        type="button"
                        onClick={() => maidMarkCleaned(task.id)}
                        className="flex-1 py-2 px-3 rounded-lg bg-[#1A2234] hover:bg-slate-700 text-xs font-medium text-white border border-white/[0.08] inline-flex items-center justify-center gap-1.5"
                      >
                        <Camera className="w-3.5 h-3.5 text-[#3B82F6]" />
                        Горничная: Убрано + фото
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => adminApproveHousekeeping(task.id)}
                      className="flex-1 py-2 px-3 rounded-lg bg-[#10B981] hover:bg-emerald-600 text-slate-950 text-xs font-semibold inline-flex items-center justify-center gap-1.5"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Принять уборку (→ Свободна)
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Row 2: Luggage Storage + Airport Transfers */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Luggage Storage */}
        <section className="lg:col-span-6 bg-[#121826] border border-white/[0.08] rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Briefcase className="w-4 h-4 text-[#3B82F6]" />
              <h2 className="text-sm font-semibold text-white">Камера хранения багажа (#B01+)</h2>
            </div>
            <span className="text-xs font-mono tabular-nums text-slate-400">
              На хранении: {state.luggageItems.filter((l) => l.status === 'stored').length}
            </span>
          </div>

          <form onSubmit={handleAddLuggage} className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-[#0B0F17] p-3 rounded-xl border border-white/[0.08]">
            <input
              type="text"
              value={lugGuest}
              onChange={(e) => setLugGuest(e.target.value)}
              placeholder="Имя гостя"
              className="col-span-2 bg-[#121826] border border-white/[0.1] rounded-lg px-3 py-1.5 text-xs text-white"
            />
            <input
              type="number"
              min="1"
              value={lugBags}
              onChange={(e) => setLugBags(e.target.value)}
              aria-label="Количество сумок"
              className="bg-[#121826] border border-white/[0.1] rounded-lg px-2.5 py-1.5 font-mono text-xs text-white"
            />
            <input
              type="time"
              value={lugFlight}
              onChange={(e) => setLugFlight(e.target.value)}
              aria-label="Время рейса"
              className="bg-[#121826] border border-white/[0.1] rounded-lg px-2 py-1.5 font-mono text-xs text-white"
            />
            <input
              type="text"
              value={lugNotes}
              onChange={(e) => setLugNotes(e.target.value)}
              placeholder="Описание (чемодан, рюкзак...)"
              className="col-span-2 sm:col-span-3 bg-[#121826] border border-white/[0.1] rounded-lg px-3 py-1.5 text-xs text-white"
            />
            <button
              type="submit"
              className="col-span-2 sm:col-span-1 py-1.5 px-3 rounded-lg bg-[#3B82F6] hover:bg-blue-500 text-white text-xs font-semibold"
            >
              Выдать бирку
            </button>
          </form>

          <div className="space-y-2">
            {state.luggageItems.map((item) => (
              <div
                key={item.id}
                className="p-3.5 rounded-xl bg-[#0B0F17] border border-white/[0.08] flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm font-semibold text-white">
                    <span className="font-mono text-[#3B82F6]">{item.tagCode}</span>
                    <span className="truncate">{item.guestName}</span>
                  </div>
                  <div className="text-xs text-slate-400 font-mono tabular-nums mt-0.5">
                    {item.bagsCount} мест · вылет {item.flightTime}
                    {item.notes ? ` · ${item.notes}` : ''}
                  </div>
                </div>
                {item.status === 'stored' ? (
                  <button
                    type="button"
                    onClick={() => releaseLuggageItem(item.id)}
                    className="px-3 py-1.5 rounded-lg bg-[#1A2234] hover:bg-[#10B981] hover:text-slate-950 text-xs font-medium text-white border border-white/[0.08] shrink-0 transition-colors"
                  >
                    Выдать
                  </button>
                ) : (
                  <span className="text-xs text-[#10B981] shrink-0">Выдан</span>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* Airport Transfers */}
        <section className="lg:col-span-6 bg-[#121826] border border-white/[0.08] rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Plane className="w-4 h-4 text-[#3B82F6]" />
              <h2 className="text-sm font-semibold text-white">
                Трансферы (3 км до аэропорта Ташкент)
              </h2>
            </div>
          </div>

          <form onSubmit={handleAddTransfer} className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-[#0B0F17] p-3 rounded-xl border border-white/[0.08]">
            <input
              type="text"
              value={trGuest}
              onChange={(e) => setTrGuest(e.target.value)}
              placeholder="Гость"
              className="col-span-2 bg-[#121826] border border-white/[0.1] rounded-lg px-3 py-1.5 text-xs text-white"
            />
            <select
              value={trDir}
              onChange={(e) => setTrDir(e.target.value as typeof trDir)}
              className="bg-[#121826] border border-white/[0.1] rounded-lg px-2 py-1.5 text-xs text-white"
            >
              <option value="to_airport">В аэропорт</option>
              <option value="from_airport">Из аэропорта</option>
            </select>
            <input
              type="time"
              value={trTime}
              onChange={(e) => setTrTime(e.target.value)}
              className="bg-[#121826] border border-white/[0.1] rounded-lg px-2 py-1.5 font-mono text-xs text-white"
            />
            <input
              type="text"
              value={trFlight}
              onChange={(e) => setTrFlight(e.target.value)}
              placeholder="Рейс (HY-601)"
              className="bg-[#121826] border border-white/[0.1] rounded-lg px-2.5 py-1.5 font-mono text-xs text-white"
            />
            <input
              type="text"
              value={trDriver}
              onChange={(e) => setTrDriver(e.target.value)}
              placeholder="Водитель / авто"
              className="col-span-2 bg-[#121826] border border-white/[0.1] rounded-lg px-2.5 py-1.5 text-xs text-white"
            />
            <button
              type="submit"
              className="py-1.5 px-3 rounded-lg bg-[#3B82F6] hover:bg-blue-500 text-white text-xs font-semibold"
            >
              Добавить
            </button>
          </form>

          <div className="space-y-2">
            {state.transfers.map((tr) => {
              const st = TRANSFER_STATUS_LABEL[tr.status];
              return (
                <div
                  key={tr.id}
                  className="p-3.5 rounded-xl bg-[#0B0F17] border border-white/[0.08] flex flex-wrap items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-white">
                      {tr.pickupTime} · {tr.guestName}{' '}
                      <span className="text-xs font-normal text-slate-400">
                        ({tr.direction === 'to_airport' ? 'В аэропорт' : 'Встреча'})
                      </span>
                    </div>
                    <div className="text-xs text-slate-400 font-mono tabular-nums mt-0.5">
                      Рейс {tr.flightNumber} · {tr.driverName} · ${tr.priceUsd}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => cycleTransferStatus(tr.id)}
                    className={`px-3 py-1.5 rounded-lg bg-[#1A2234] hover:bg-slate-700 border border-white/[0.08] text-xs font-semibold ${st.color}`}
                  >
                    {st.text} →
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      {/* Row 3: Interactive Guest QR Concierge Phone + Stock & Emergency Directory */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Interactive Guest QR Concierge Phone (RU / EN / UZ / ZH) */}
        <section className="lg:col-span-5 bg-[#121826] border border-white/[0.08] rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <QrCode className="w-4 h-4 text-[#10B981]" />
              <h2 className="text-sm font-semibold text-white">
                Гостевой QR-консьерж (интерактив)
              </h2>
            </div>
            <div className="flex items-center gap-1 p-0.5 bg-[#0B0F17] border border-white/[0.08] rounded-lg">
              {(['ru', 'en', 'uz', 'zh'] as GuestLang[]).map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => setQrLang(l)}
                  className={`px-2 py-1 rounded-md text-xs font-mono uppercase transition-colors ${
                    qrLang === l ? 'bg-[#3B82F6] text-white font-semibold' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">
              От имени какого гостя тестируем QR:
            </label>
            <select
              value={selectedQrBooking?.id ?? ''}
              onChange={(e) => setQrBookingId(e.target.value)}
              className="w-full bg-[#0B0F17] border border-white/[0.1] rounded-lg px-3 py-2 text-xs text-white"
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

          {/* Mobile Phone Frame */}
          <div className="mx-auto max-w-[320px] bg-[#0B0F17] border-2 border-slate-700/80 rounded-[28px] p-4 space-y-3.5 shadow-xl">
            <div className="w-16 h-1 bg-slate-700 rounded-full mx-auto" />
            <div className="space-y-1">
              <div className="text-xs font-mono text-[#10B981]">TOPCHAN HOSTEL · TASHKENT</div>
              <h3 className="text-base font-bold text-white leading-snug">{qrCopy.welcome}</h3>
              <p className="text-xs text-slate-400">{qrCopy.subtitle}</p>
            </div>

            <div className="grid grid-cols-2 gap-2 p-2.5 rounded-xl bg-[#121826] border border-white/[0.08] text-xs font-mono">
              <div>
                <div className="text-slate-400 flex items-center gap-1">
                  <Wifi className="w-3 h-3 text-[#3B82F6]" />
                  {qrCopy.wifiLabel}
                </div>
                <div className="text-white font-semibold mt-0.5">{state.integrations.wifiPass}</div>
              </div>
              <div>
                <div className="text-slate-400">{qrCopy.doorLabel}</div>
                <div className="text-white font-semibold mt-0.5">{state.integrations.doorCode}</div>
              </div>
            </div>

            <p className="text-xs text-slate-400 leading-relaxed">{qrCopy.breakfastNote}</p>

            <div className="space-y-2">
              {[
                { key: 'extend' as const, label: qrCopy.extendBtn, accent: 'bg-[#10B981] text-slate-950 hover:bg-emerald-600' },
                { key: 'laundry_fast' as const, label: qrCopy.laundryFastBtn, accent: 'bg-[#1A2234] text-white hover:bg-slate-700 border border-white/[0.08]' },
                { key: 'laundry_medium' as const, label: qrCopy.laundryMedBtn, accent: 'bg-[#1A2234] text-white hover:bg-slate-700 border border-white/[0.08]' },
                { key: 'transfer' as const, label: qrCopy.transferBtn, accent: 'bg-[#1A2234] text-white hover:bg-slate-700 border border-white/[0.08]' },
                { key: 'late_breakfast' as const, label: qrCopy.lateBreakfastBtn, accent: 'bg-[#1A2234] text-white hover:bg-slate-700 border border-white/[0.08]' },
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
                  className={`w-full py-2.5 px-3 rounded-xl text-xs font-semibold transition-colors ${btn.accent}`}
                >
                  {btn.label}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* Stock & Emergency Contacts */}
        <section className="lg:col-span-7 space-y-5">
          {/* Consumables Stock */}
          <div className="bg-[#121826] border border-white/[0.08] rounded-2xl p-5 space-y-3">
            <div className="flex items-center gap-2">
              <Package className="w-4 h-4 text-[#F59E0B]" />
              <h2 className="text-sm font-semibold text-white">Запасы и расходники хостела</h2>
            </div>
            <div className="divide-y divide-white/[0.06] border border-white/[0.08] rounded-xl bg-[#0B0F17] overflow-hidden">
              {state.stockItems.map((item) => {
                const isLow = item.quantity <= item.minThreshold;
                return (
                  <div
                    key={item.id}
                    className="px-4 py-3 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-white truncate">{item.name}</div>
                      <div className="text-xs flex items-center gap-1.5 mt-0.5">
                        {isLow ? (
                          <span className="text-[#F43F5E] inline-flex items-center gap-1 font-medium">
                            <AlertTriangle className="w-3.5 h-3.5" />
                            Низкий остаток (порог {item.minThreshold})
                          </span>
                        ) : (
                          <span className="text-slate-400">
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
                        className="p-1.5 rounded-lg bg-[#1A2234] hover:bg-slate-700 text-slate-200 border border-white/[0.08]"
                      >
                        <Minus className="w-3.5 h-3.5" />
                      </button>
                      <span
                        className={`w-12 text-center font-mono tabular-nums text-sm font-bold ${
                          isLow ? 'text-[#F43F5E]' : 'text-white'
                        }`}
                      >
                        {item.quantity}
                      </span>
                      <button
                        type="button"
                        aria-label={`Добавить 5 ${item.name}`}
                        onClick={() => adjustStock(item.id, 5)}
                        className="px-2.5 py-1.5 rounded-lg bg-[#1A2234] hover:bg-slate-700 text-xs font-mono text-[#10B981] border border-white/[0.08] inline-flex items-center gap-1"
                      >
                        <Plus className="w-3 h-3" />5
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Emergency Contacts */}
          <div className="bg-[#121826] border border-white/[0.08] rounded-2xl p-5 space-y-3">
            <div className="flex items-center gap-2">
              <Phone className="w-4 h-4 text-[#10B981]" />
              <h2 className="text-sm font-semibold text-white">
                Экстренные контакты и службы (Ташкент)
              </h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {state.emergencyContacts.map((c) => (
                <div
                  key={c.id}
                  className="p-3.5 rounded-xl bg-[#0B0F17] border border-white/[0.08] space-y-1.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-[#3B82F6] font-medium">{c.category}</span>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard?.writeText(c.phone).catch(() => {});
                        pushToast('Номер скопирован', `${c.name} · ${c.phone}`, 'emerald');
                      }}
                      className="font-mono tabular-nums text-xs text-[#10B981] hover:underline"
                    >
                      {c.phone}
                    </button>
                  </div>
                  <div className="text-sm font-semibold text-white">
                    {c.name} · <span className="font-normal text-slate-300">{c.role}</span>
                  </div>
                  <p className="text-xs text-slate-400">{c.note}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};
