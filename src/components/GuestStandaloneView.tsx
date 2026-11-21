import React, { useMemo, useState } from 'react';
import {
  ArrowLeft,
  BedDouble,
  CheckCircle2,
  Clock,
  Coffee,
  KeyRound,
  Plane,
  Shirt,
  Sparkles,
  Wifi,
} from 'lucide-react';
import type { GuestLang } from '../types/ops';
import { useOpsData, useUI } from '../context/OpsContext';
import { ToastStack } from './ToastStack';

const COPY: Record<
  GuestLang,
  {
    welcome: string;
    subtitle: string;
    wifi: string;
    door: string;
    breakfast: string;
    checkout: string;
    quiet: string;
    servicesTitle: string;
    extend: string;
    extendDesc: string;
    laundryFast: string;
    laundryFastDesc: string;
    laundryMed: string;
    laundryMedDesc: string;
    transfer: string;
    transferDesc: string;
    lateBreakfast: string;
    lateBreakfastDesc: string;
    sent: string;
    adminBack: string;
  }
> = {
  ru: {
    welcome: 'Добро пожаловать в Topchan Hostel',
    subtitle: 'Ваш цифровой консьерж в Ташкенте — все услуги в 1 касание без очередей',
    wifi: 'Wi-Fi',
    door: 'Код двери',
    breakfast: 'Завтрак: 07:30 – 10:30',
    checkout: 'Выезд: до 12:00',
    quiet: 'Тихий час: с 23:00',
    servicesTitle: 'Заказать на ресепшен',
    extend: 'Продлить ночь напрямую',
    extendDesc: 'Без комиссии агрегаторов — ресепшен подтвердит за 1 мин',
    laundryFast: 'Быстрая стирка (22 мин)',
    laundryFastDesc: 'Загрузка до 5 кг + порошок',
    laundryMed: 'Средняя стирка (55 мин)',
    laundryMedDesc: 'Полный цикл + отжим',
    transfer: 'Трансфер в аэропорт (3 км)',
    transferDesc: 'Проверенный водитель · 10 мин до терминала',
    lateBreakfast: 'Поздний завтрак',
    lateBreakfastDesc: 'Подадим после 10:30 в уютный топчан-двор',
    sent: 'Заявка отправлена на ресепшен',
    adminBack: 'Режим администратора',
  },
  en: {
    welcome: 'Welcome to Topchan Hostel',
    subtitle: 'Your Tashkent pocket concierge — request services in 1 tap',
    wifi: 'Wi-Fi',
    door: 'Door Code',
    breakfast: 'Breakfast: 07:30 – 10:30',
    checkout: 'Check-out: 12:00',
    quiet: 'Quiet hours: 23:00',
    servicesTitle: 'Request from Reception',
    extend: 'Extend 1 More Night Directly',
    extendDesc: 'Best direct hostel rate — instant reception confirmation',
    laundryFast: 'Fast Laundry (22 min)',
    laundryFastDesc: 'Up to 5 kg wash + detergent',
    laundryMed: 'Medium Laundry (55 min)',
    laundryMedDesc: 'Full cycle + spin',
    transfer: 'Tashkent Airport Transfer (3 km)',
    transferDesc: 'Trusted hostel driver · 10 min ride',
    lateBreakfast: 'Late Breakfast',
    lateBreakfastDesc: 'Served after 10:30 in our courtyard',
    sent: 'Request sent to reception',
    adminBack: 'Staff Console',
  },
  uz: {
    welcome: 'Topchan Hostelga xush kelibsiz',
    subtitle: 'Toshkentdagi raqamli konsyerj — barcha xizmatlar 1 bosishda',
    wifi: 'Wi-Fi',
    door: 'Eshik kodi',
    breakfast: 'Nonushta: 07:30 – 10:30',
    checkout: 'Chiqish: 12:00 gacha',
    quiet: 'Tinchlik soati: 23:00',
    servicesTitle: 'Resepshenga buyurtma',
    extend: 'Yana 1 kechaga uzaytirish',
    extendDesc: 'Komissiyasiz to‘g‘ridan-to‘g‘ri narx',
    laundryFast: 'Tezkor kir yuvish (22 daq)',
    laundryFastDesc: '5 kg gacha + kukun',
    laundryMed: 'O‘rtacha kir yuvish (55 daq)',
    laundryMedDesc: 'To‘liq sikl',
    transfer: 'Aeroportga transfer (3 km)',
    transferDesc: 'Ishonchli haydovchi · 10 daqiqa',
    lateBreakfast: 'Kechki nonushta',
    lateBreakfastDesc: '10:30 dan keyin hovlida',
    sent: 'So‘rov resepshenga yuborildi',
    adminBack: 'Administrator paneli',
  },
  zh: {
    welcome: '欢迎入住 Topchan Hostel',
    subtitle: '塔什干电子礼宾服务 — 一键预约洗衣、续住与送机',
    wifi: '无线网络',
    door: '门禁密码',
    breakfast: '早餐: 07:30 – 10:30',
    checkout: '退房: 12:00 前',
    quiet: '安静时段: 23:00 起',
    servicesTitle: '一键预约前台服务',
    extend: '直接续住一晚',
    extendDesc: '前台直订优惠价，无需平台佣金',
    laundryFast: '快速洗衣 (22分钟)',
    laundryFastDesc: '含洗衣液，5公斤以内',
    laundryMed: '标准洗衣 (55分钟)',
    laundryMedDesc: '深度清洁与脱水',
    transfer: '塔什干机场送机 (3公里)',
    transferDesc: '合作司机直达航站楼 · 约10分钟',
    lateBreakfast: '延迟早餐',
    lateBreakfastDesc: '10:30 后在庭院供应',
    sent: '预约已发送至前台',
    adminBack: '员工后台',
  },
};

export const GuestStandaloneView: React.FC<{ roomParam: string | null }> = ({ roomParam }) => {
  const { state, submitGuestQrRequest } = useOpsData();
  const { pushToast } = useUI();
  const [lang, setLang] = useState<GuestLang>('en');
  const [lastRequested, setLastRequested] = useState<string | null>(null);

  const t = COPY[lang];

  const matchedRoom = useMemo(() => {
    if (!roomParam) return state.physicalRooms.find((r) => !r.archived);
    const norm = roomParam.toLowerCase().replace(/[^a-z0-9]/g, '');
    return (
      state.physicalRooms.find(
        (r) => r.code.toLowerCase().replace(/[^a-z0-9]/g, '') === norm
      ) ?? state.physicalRooms.find((r) => !r.archived)
    );
  }, [roomParam, state.physicalRooms]);

  const activeBooking = useMemo(() => {
    if (matchedRoom) {
      const byRoom = state.bookings.find(
        (b) =>
          b.status === 'active' &&
          b.segments.some((s) => s.roomId === matchedRoom.id)
      );
      if (byRoom) return byRoom;
    }
    return state.bookings.find((b) => b.status === 'active');
  }, [matchedRoom, state.bookings]);

  const roomLabel = matchedRoom?.code ?? roomParam ?? 'Topchan Room';
  const extendPrice =
    activeBooking?.segments[activeBooking.segments.length - 1]?.nightlyRateUsd ?? 18;

  const handleRequest = (
    serviceType: 'extend' | 'laundry_fast' | 'laundry_medium' | 'transfer' | 'late_breakfast',
    title: string
  ) => {
    submitGuestQrRequest({
      bookingId: activeBooking?.id ?? '',
      serviceType,
      lang,
    });
    setLastRequested(title);
    pushToast(t.sent, `${roomLabel} · ${title}`, 'emerald');
  };

  const services = [
    {
      key: 'extend' as const,
      title: t.extend,
      desc: t.extendDesc,
      price: `$${extendPrice}`,
      icon: BedDouble,
      accent: 'text-emerald-400',
    },
    {
      key: 'laundry_fast' as const,
      title: t.laundryFast,
      desc: t.laundryFastDesc,
      price: '$2',
      icon: Shirt,
      accent: 'text-blue-400',
    },
    {
      key: 'laundry_medium' as const,
      title: t.laundryMed,
      desc: t.laundryMedDesc,
      price: '$3',
      icon: Shirt,
      accent: 'text-blue-400',
    },
    {
      key: 'transfer' as const,
      title: t.transfer,
      desc: t.transferDesc,
      price: '$5',
      icon: Plane,
      accent: 'text-amber-400',
    },
    {
      key: 'late_breakfast' as const,
      title: t.lateBreakfast,
      desc: t.lateBreakfastDesc,
      price: '$2',
      icon: Coffee,
      accent: 'text-amber-400',
    },
  ];

  return (
    <div className="min-h-screen bg-[#0B0F17] text-slate-100">
      <div className="mx-auto max-w-md px-4 pb-10 pt-5">
        {/* Top bar: Brand + Language Switcher */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-400">
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-50">{state.integrations.propertyName}</p>
              <p className="text-xs text-slate-400">{roomLabel}</p>
            </div>
          </div>

          <div className="flex items-center gap-1 rounded-xl border border-white/[0.08] bg-[#121826] p-1">
            {(['ru', 'en', 'uz', 'zh'] as GuestLang[]).map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => setLang(code)}
                className={`rounded-lg px-2 py-1 text-xs font-bold uppercase transition ${
                  lang === code
                    ? 'bg-emerald-500 text-slate-950'
                    : 'text-slate-400 hover:text-slate-100'
                }`}
              >
                {code === 'zh' ? '中文' : code}
              </button>
            ))}
          </div>
        </div>

        {/* Hero Welcome */}
        <div className="mt-5 rounded-2xl border border-white/[0.08] bg-[#121826] p-5">
          <h1 className="text-xl font-extrabold tracking-tight text-slate-50">{t.welcome}</h1>
          <p className="mt-1.5 text-sm text-slate-400">{t.subtitle}</p>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-white/[0.08] bg-[#0B0F17] p-3">
              <div className="flex items-center gap-1.5 text-xs text-slate-400">
                <Wifi className="h-3.5 w-3.5 text-emerald-400" />
                {t.wifi}
              </div>
              <p className="mt-1 text-sm font-bold text-slate-100">{state.integrations.wifiSsid}</p>
              <p className="font-mono text-xs text-emerald-400">{state.integrations.wifiPass}</p>
            </div>
            <div className="rounded-xl border border-white/[0.08] bg-[#0B0F17] p-3">
              <div className="flex items-center gap-1.5 text-xs text-slate-400">
                <KeyRound className="h-3.5 w-3.5 text-amber-400" />
                {t.door}
              </div>
              <p className="mt-1 font-mono text-lg font-extrabold text-slate-50 tabular-nums">
                {state.integrations.doorCode}
              </p>
              <p className="text-xs text-slate-400">{t.checkout}</p>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-400">
            <span className="flex items-center gap-1">
              <Clock className="h-3.5 w-3.5 text-slate-500" />
              {t.breakfast}
            </span>
            <span>·</span>
            <span>{t.quiet}</span>
          </div>
        </div>

        {lastRequested && (
          <div className="mt-4 flex items-center gap-2.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-200">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
            <span>
              <strong>{t.sent}:</strong> {lastRequested}
            </span>
          </div>
        )}

        {/* Services List */}
        <h2 className="mt-6 mb-3 text-xs font-bold uppercase tracking-wider text-slate-400">
          {t.servicesTitle}
        </h2>
        <div className="space-y-2.5">
          {services.map((svc) => {
            const Icon = svc.icon;
            return (
              <button
                key={svc.key}
                type="button"
                onClick={() => handleRequest(svc.key, svc.title)}
                className="flex w-full items-center justify-between gap-3 rounded-2xl border border-white/[0.08] bg-[#121826] p-4 text-left transition hover:border-emerald-500/35 hover:bg-[#1A2234] active:scale-[0.99]"
              >
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 rounded-xl bg-[#0B0F17] p-2.5">
                    <Icon className={`h-5 w-5 ${svc.accent}`} />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-100">{svc.title}</p>
                    <p className="mt-0.5 text-xs text-slate-400">{svc.desc}</p>
                  </div>
                </div>
                <span className="shrink-0 rounded-lg bg-emerald-500/15 px-3 py-1.5 font-mono text-sm font-bold text-emerald-300 tabular-nums">
                  {svc.price}
                </span>
              </button>
            );
          })}
        </div>

        {/* Footer subtle back to admin */}
        <div className="mt-8 flex justify-center">
          <a
            href="/"
            className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {t.adminBack}
          </a>
        </div>
      </div>
      <ToastStack />
    </div>
  );
};
