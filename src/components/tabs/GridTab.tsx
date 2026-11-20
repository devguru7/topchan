import React, { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  AlertCircle,
  BedDouble,
  CheckCircle2,
  Clock,
  Plus,
  Search,
  Sparkles,
  UserPlus,
} from 'lucide-react';
import { useOps } from '../../context/OpsContext';
import { calcBookingTotals, formatUsd } from '../../utils/math';

type GridFilter = 'all' | 'available' | 'occupied' | 'checkout' | 'debt' | 'dirty';

const FILTERS: Array<{ id: GridFilter; label: string }> = [
  { id: 'all', label: 'Все' },
  { id: 'available', label: 'Свободные' },
  { id: 'occupied', label: 'Занятые' },
  { id: 'checkout', label: 'Выезд 12:00' },
  { id: 'debt', label: 'Должники' },
  { id: 'dirty', label: 'Уборка' },
];

export const GridTab: React.FC = () => {
  const {
    state,
    openCheckInModal,
    setSelectedBookingId,
    setActiveTab,
    pushToast,
  } = useOps();

  const [filter, setFilter] = useState<GridFilter>('all');
  const [search, setSearch] = useState('');

  const activeRooms = useMemo(
    () => state.physicalRooms.filter((r) => !r.archived),
    [state.physicalRooms]
  );

  // Map active booking by roomId or roomId:bedId
  const activeBookingMap = useMemo(() => {
    const map = new Map<string, (typeof state.bookings)[number]>();
    for (const b of state.bookings) {
      if (b.status !== 'active') continue;
      const seg = b.segments[b.segments.length - 1];
      if (!seg) continue;
      const key = seg.bedId ? `${seg.roomId}:${seg.bedId}` : seg.roomId;
      map.set(key, b);
    }
    return map;
  }, [state.bookings]);

  // Compute live KPIs across all units (private rooms + individual dorm beds)
  const kpis = useMemo(() => {
    let totalUnits = 0;
    let occupiedUnits = 0;
    let availableUnits = 0;
    let dirtyUnits = 0;

    for (const room of activeRooms) {
      if (room.beds) {
        for (const bed of room.beds) {
          totalUnits += 1;
          if (bed.status === 'occupied') occupiedUnits += 1;
          else if (bed.status === 'dirty') dirtyUnits += 1;
          else availableUnits += 1;
        }
      } else {
        totalUnits += 1;
        if (room.status === 'occupied') occupiedUnits += 1;
        else if (room.status === 'dirty') dirtyUnits += 1;
        else availableUnits += 1;
      }
    }

    const activeBookings = state.bookings.filter((b) => b.status === 'active');
    const checkoutTodayCount = activeBookings.filter((b) => b.checkingOutToday).length;
    const totalDebtUsd = activeBookings.reduce(
      (sum, b) => sum + calcBookingTotals(b).debtUsd,
      0
    );

    return {
      occupancyPct: totalUnits > 0 ? Math.round((occupiedUnits / totalUnits) * 100) : 0,
      availableUnits,
      totalUnits,
      checkoutTodayCount,
      totalDebtUsd,
      dirtyUnits,
    };
  }, [activeRooms, state.bookings]);

  const query = search.trim().toLowerCase();

  const matchesUnit = (
    roomCode: string,
    status: string,
    booking?: (typeof state.bookings)[number]
  ): boolean => {
    const fin = booking ? calcBookingTotals(booking) : null;
    if (filter === 'available' && status !== 'available') return false;
    if (filter === 'occupied' && status !== 'occupied') return false;
    if (filter === 'checkout' && !booking?.checkingOutToday) return false;
    if (filter === 'debt' && (!fin || fin.debtUsd <= 0)) return false;
    if (filter === 'dirty' && status !== 'dirty') return false;

    if (!query) return true;
    if (roomCode.toLowerCase().includes(query)) return true;
    if (
      booking &&
      (booking.bnovoId.toLowerCase().includes(query) ||
        booking.guests.some(
          (g) =>
            g.fullName.toLowerCase().includes(query) ||
            g.passportNo.toLowerCase().includes(query) ||
            g.citizenship.toLowerCase().includes(query)
        ))
    ) {
      return true;
    }
    return false;
  };

  const groupedCategories = useMemo(() => {
    return state.roomCategories
      .map((cat) => {
        const rooms = activeRooms.filter((r) => r.categoryId === cat.id);
        return { category: cat, rooms };
      })
      .filter((g) => g.rooms.length > 0);
  }, [state.roomCategories, activeRooms]);

  const hasVisibleResults = useMemo(() => {
    for (const grp of groupedCategories) {
      for (const room of grp.rooms) {
        if (room.beds) {
          for (const bed of room.beds) {
            const b = activeBookingMap.get(`${room.id}:${bed.id}`);
            if (matchesUnit(`${room.code} ${bed.label}`, bed.status, b)) return true;
          }
        } else {
          const b = activeBookingMap.get(room.id);
          if (matchesUnit(room.code, room.status, b)) return true;
        }
      }
    }
    return false;
  }, [groupedCategories, activeBookingMap, filter, query]);

  return (
    <div className="space-y-6">
      {/* Header Row */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white">
            Шахматка номерного фонда
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 mt-0.5">
            Клик по свободной комнате — быстрое заселение · клик по занятой — фолио и расчёт
          </p>
        </div>
        <button
          type="button"
          onClick={() => openCheckInModal()}
          className="px-4 py-2.5 rounded-lg bg-[#10B981] hover:bg-emerald-600 text-slate-950 text-sm font-semibold transition-colors inline-flex items-center gap-2 whitespace-nowrap shrink-0"
        >
          <UserPlus className="w-4 h-4" />
          Заселить гостя
        </button>
      </div>

      {/* Top KPI Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 sm:gap-3">
        <div className="bg-[#121826] border border-white/[0.08] rounded-xl p-3 sm:p-4">
          <div className="text-xs text-slate-400">Загрузка сейчас</div>
          <div className="text-xl sm:text-2xl font-bold font-mono tabular-nums text-white mt-1">
            {kpis.occupancyPct}%
          </div>
          <div className="text-xs text-slate-400 font-mono tabular-nums mt-0.5">
            из {kpis.totalUnits} мест
          </div>
        </div>

        <button
          type="button"
          onClick={() => setFilter(filter === 'available' ? 'all' : 'available')}
          className="text-left bg-[#121826] hover:bg-[#1A2234] border border-white/[0.08] rounded-xl p-3 sm:p-4 transition-colors"
        >
          <div className="text-xs text-slate-400">Свободно</div>
          <div className="text-xl sm:text-2xl font-bold font-mono tabular-nums text-[#10B981] mt-1">
            {kpis.availableUnits}
          </div>
          <div className="text-xs text-slate-400 mt-0.5">комнат и коек</div>
        </button>

        <button
          type="button"
          onClick={() => setFilter(filter === 'checkout' ? 'all' : 'checkout')}
          className="text-left bg-[#121826] hover:bg-[#1A2234] border border-white/[0.08] rounded-xl p-3 sm:p-4 transition-colors"
        >
          <div className="text-xs text-slate-400">Выезд в 12:00</div>
          <div className="text-xl sm:text-2xl font-bold font-mono tabular-nums text-[#F59E0B] mt-1">
            {kpis.checkoutTodayCount}
          </div>
          <div className="text-xs text-slate-400 mt-0.5">сегодня до полудня</div>
        </button>

        <button
          type="button"
          onClick={() => setFilter(filter === 'debt' ? 'all' : 'debt')}
          className="text-left bg-[#121826] hover:bg-[#1A2234] border border-white/[0.08] rounded-xl p-3 sm:p-4 transition-colors"
        >
          <div className="text-xs text-slate-400">Открытые долги</div>
          <div
            className={`text-xl sm:text-2xl font-bold font-mono tabular-nums mt-1 ${
              kpis.totalDebtUsd > 0 ? 'text-[#F43F5E]' : 'text-[#10B981]'
            }`}
          >
            {formatUsd(kpis.totalDebtUsd)}
          </div>
          <div className="text-xs text-slate-400 mt-0.5">по активным фолио</div>
        </button>

        <button
          type="button"
          onClick={() => setFilter(filter === 'dirty' ? 'all' : 'dirty')}
          className="col-span-2 sm:col-span-1 text-left bg-[#121826] hover:bg-[#1A2234] border border-white/[0.08] rounded-xl p-3 sm:p-4 transition-colors"
        >
          <div className="text-xs text-slate-400">На уборке</div>
          <div
            className={`text-xl sm:text-2xl font-bold font-mono tabular-nums mt-1 ${
              kpis.dirtyUnits > 0 ? 'text-[#F59E0B]' : 'text-slate-300'
            }`}
          >
            {kpis.dirtyUnits}
          </div>
          <div className="text-xs text-slate-400 mt-0.5">ожидают горничную</div>
        </button>
      </div>

      {/* Filter Bar + Search */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        <div
          role="tablist"
          aria-label="Фильтры комнат"
          className="flex flex-wrap sm:flex-nowrap items-center gap-1 p-1 bg-[#121826] border border-white/[0.08] rounded-xl"
        >
          {FILTERS.map((f) => {
            const active = filter === f.id;
            return (
              <button
                key={f.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setFilter(f.id)}
                className={`relative px-2.5 sm:px-3.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                  active ? 'text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="activeFilterPill"
                    transition={{ type: 'spring', stiffness: 300, damping: 28 }}
                    className="absolute inset-0 bg-[#1A2234] border border-white/[0.1] rounded-lg"
                  />
                )}
                <span className="relative z-10">{f.label}</span>
              </button>
            );
          })}
        </div>

        <div className="relative md:w-72 shrink-0">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            aria-label="Поиск по гостю, паспорту или комнате"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Гость, паспорт или Small #1..."
            className="w-full bg-[#121826] border border-white/[0.08] rounded-xl pl-9 pr-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-[#3B82F6]"
          />
        </div>
      </div>

      {/* Empty Search/Filter State */}
      {!hasVisibleResults && (
        <div className="bg-[#121826] border border-white/[0.08] rounded-2xl p-8 text-center space-y-3">
          <p className="text-sm text-slate-300">По выбранному фильтру комнат не найдено.</p>
          <button
            type="button"
            onClick={() => {
              setFilter('all');
              setSearch('');
            }}
            className="px-4 py-2 rounded-lg bg-[#1A2234] hover:bg-slate-700 text-xs font-medium text-white border border-white/[0.08]"
          >
            Сбросить фильтры
          </button>
        </div>
      )}

      {/* Category-Grouped Bento Grid */}
      <div className="space-y-6">
        {groupedCategories.map(({ category, rooms }) => {
          // Check if category has any matching rooms/beds
          const visibleUnits: Array<{
            room: (typeof rooms)[number];
            bed: NonNullable<(typeof rooms)[number]['beds']>[number] | undefined;
          }> = rooms.flatMap((room) => {
            if (room.beds) {
              return room.beds
                .filter((bed) =>
                  matchesUnit(
                    `${room.code} ${bed.label}`,
                    bed.status,
                    activeBookingMap.get(`${room.id}:${bed.id}`)
                  )
                )
                .map((bed) => ({ room, bed: bed as NonNullable<(typeof rooms)[number]['beds']>[number] | undefined }));
            }
            const b = activeBookingMap.get(room.id);
            return matchesUnit(room.code, room.status, b) ? [{ room, bed: undefined }] : [];
          });

          if (visibleUnits.length === 0) return null;

          const priceSummary = Object.entries(category.pricesUsd)
            .map(([occ, price]) => (category.isDorm ? `$${price}/койка` : `${occ}ч: $${price}`))
            .join(' · ');

          return (
            <section key={category.id} className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 pb-1.5 border-b border-white/[0.06]">
                <div className="flex items-center gap-2.5">
                  <span
                    className="w-2.5 h-2.5 rounded-xs shrink-0"
                    style={{ backgroundColor: category.colorHex }}
                    aria-hidden="true"
                  />
                  <h2 className="text-sm font-semibold text-white">{category.name}</h2>
                  <span className="text-xs text-slate-400">
                    {category.bathroomType === 'private' ? 'Свой санузел' : 'Общий душ'}
                  </span>
                </div>
                <div className="text-xs font-mono tabular-nums text-slate-400">
                  {priceSummary} · {category.bnovoCategoryId}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {visibleUnits.map(({ room, bed }) => {
                  const key = bed ? `${room.id}:${bed.id}` : room.id;
                  const status = bed ? bed.status : room.status;
                  const booking = activeBookingMap.get(key);
                  const fin = booking ? calcBookingTotals(booking) : null;
                  const primaryGuest = booking?.guests[0];
                  const vipProfile = primaryGuest
                    ? state.guestProfiles.find(
                        (p) => p.passportNo === primaryGuest.passportNo && p.tag === 'vip'
                      )
                    : undefined;
                  const hasForeigner = booking?.guests.some((g) => g.isForeigner);

                  const borderClass =
                    fin && fin.debtUsd > 0
                      ? 'border-[#F43F5E]/45 hover:border-[#F43F5E]/70'
                      : booking?.checkingOutToday
                        ? 'border-[#F59E0B]/45 hover:border-[#F59E0B]/70'
                        : status === 'dirty'
                          ? 'border-[#F59E0B]/40 hover:border-[#F59E0B]/65'
                          : status === 'occupied'
                            ? 'border-[#3B82F6]/30 hover:border-[#3B82F6]/60'
                            : 'border-white/[0.08] hover:border-[#10B981]/50';

                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => {
                        if (status === 'occupied' && booking) {
                          setSelectedBookingId(booking.id);
                        } else if (status === 'dirty') {
                          setActiveTab('services');
                          pushToast(
                            `${bed ? `${room.code} ${bed.label}` : room.code} на уборке`,
                            'Переход к очереди горничных для приёмки',
                            'amber'
                          );
                        } else {
                          openCheckInModal({ roomId: room.id, bedId: bed?.id });
                        }
                      }}
                      className={`text-left bg-[#121826] hover:bg-[#1A2234] border ${borderClass} rounded-xl p-4 transition-colors flex flex-col justify-between gap-3 min-h-[126px]`}
                    >
                      <div className="flex items-start justify-between gap-2 w-full">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-white truncate">
                            {bed ? `${room.code} · Койка ${bed.label}` : room.code}
                          </div>
                          {bed && (
                            <div className="text-xs text-slate-400 mt-0.5">{bed.tier}</div>
                          )}
                        </div>
                        <div className="text-xs font-medium shrink-0">
                          {status === 'available' && (
                            <span className="text-[#10B981] inline-flex items-center gap-1">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              Свободна
                            </span>
                          )}
                          {status === 'dirty' && (
                            <span className="text-[#F59E0B] inline-flex items-center gap-1">
                              <Clock className="w-3.5 h-3.5" />
                              Уборка
                            </span>
                          )}
                          {status === 'occupied' && fin && fin.debtUsd > 0 && (
                            <span className="text-[#F43F5E] font-mono tabular-nums inline-flex items-center gap-1">
                              <AlertCircle className="w-3.5 h-3.5" />
                              Долг {formatUsd(fin.debtUsd)}
                            </span>
                          )}
                          {status === 'occupied' &&
                            (!fin || fin.debtUsd === 0) &&
                            booking?.checkingOutToday && (
                              <span className="text-[#F59E0B] inline-flex items-center gap-1">
                                <Clock className="w-3.5 h-3.5" />
                                Выезд 12:00
                              </span>
                            )}
                          {status === 'occupied' &&
                            (!fin || fin.debtUsd === 0) &&
                            !booking?.checkingOutToday && (
                              <span className="text-[#10B981]">Оплачено</span>
                            )}
                        </div>
                      </div>

                      {status === 'occupied' && booking && primaryGuest ? (
                        <div className="space-y-1 w-full">
                          <div className="flex items-center gap-1.5 text-sm font-medium text-slate-100 truncate">
                            {vipProfile && (
                              <Sparkles className="w-3.5 h-3.5 text-[#F59E0B] shrink-0" />
                            )}
                            <span className="truncate">
                              {primaryGuest.fullName}
                              {booking.guests.length > 1
                                ? ` +${booking.guests.length - 1}`
                                : ''}
                            </span>
                          </div>
                          <div className="flex items-center justify-between text-xs text-slate-400 font-mono tabular-nums">
                            <span>
                              {primaryGuest.citizenship}
                              {booking.checkingOutToday && fin && fin.debtUsd > 0
                                ? ' · Выезд 12:00'
                                : hasForeigner && !primaryGuest.emehmonRegistered
                                  ? ' · Нет E-mehmon'
                                  : ''}
                            </span>
                            <span>
                              до {booking.segments[booking.segments.length - 1]?.toDate.slice(5)}
                            </span>
                          </div>
                        </div>
                      ) : status === 'dirty' ? (
                        <div className="text-xs text-amber-300/90 flex items-center justify-between w-full">
                          <span>Ожидает приёмки горничной</span>
                          <span className="underline">Принять →</span>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between text-xs text-slate-400 w-full">
                          <span className="font-mono tabular-nums">
                            от ${category.pricesUsd[1]}/ночь
                          </span>
                          <span className="inline-flex items-center gap-1 text-[#10B981] font-medium">
                            <Plus className="w-3.5 h-3.5" />
                            Заселить
                          </span>
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      {/* Dorms Legend Footer */}
      <div className="flex items-center justify-between text-xs text-slate-400 pt-2 border-t border-white/[0.06]">
        <div className="flex items-center gap-2">
          <BedDouble className="w-4 h-4 text-slate-500" />
          <span>Все комнаты динамические — добавляйте новые номера и тарифы во вкладке «Настройки»</span>
        </div>
      </div>
    </div>
  );
};
