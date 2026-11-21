import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  Banknote,
  BedDouble,
  CalendarRange,
  CheckCircle2,
  Clock,
  DoorOpen,
  LayoutGrid,
  Plus,
  QrCode,
  Search,
  Sparkles,
  UserPlus,
  WashingMachine,
} from 'lucide-react';
import { useOps } from '../../context/OpsContext';
import type { GridFilterId } from '../../context/UIContext';
import { calcBookingTotals, formatUsd } from '../../utils/math';
import { getTopchanRoomColor } from '../../utils/roomColors';
import {
  formatShortDateColumn,
  getDateRangeIso,
  getTashkentTodayIso,
} from '../../utils/time';
import { EmptyState, MetricTile, SegmentedControl, StatusPill } from '../ui';

type GridViewMode = 'cards' | 'tape';

const VIEW_MODE_OPTIONS = [
  { id: 'cards' as const, label: 'Карточки сегодня', icon: LayoutGrid },
  { id: 'tape' as const, label: 'Календарь 14 дней', icon: CalendarRange },
];

export const GridTab: React.FC = () => {
  const {
    state,
    gridFilter,
    setGridFilter,
    openCheckInModal,
    openCheckOutModal,
    openQrPosterModal,
    openBookingFolio,
    setSelectedBookingId,
    setActiveTab,
    setServicesSubTab,
    addLedgerCharge,
    pushToast,
  } = useOps();

  const [viewMode, setViewMode] = useState<GridViewMode>('cards');
  const [search, setSearch] = useState('');

  const todayIso = useMemo(() => getTashkentTodayIso(), []);
  const tapeDates = useMemo(() => getDateRangeIso(todayIso, 14), [todayIso]);

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
    const debtBookingsCount = activeBookings.filter((b) => calcBookingTotals(b).debtUsd > 0).length;
    const totalDebtUsd = activeBookings.reduce(
      (sum, b) => sum + calcBookingTotals(b).debtUsd,
      0
    );

    return {
      occupancyPct: totalUnits > 0 ? Math.round((occupiedUnits / totalUnits) * 100) : 0,
      occupiedUnits,
      availableUnits,
      totalUnits,
      checkoutTodayCount,
      debtBookingsCount,
      totalDebtUsd,
      dirtyUnits,
    };
  }, [activeRooms, state.bookings]);

  const filterOptions = useMemo<
    Array<{ id: GridFilterId; label: string; badge?: number }>
  >(
    () => [
      { id: 'all', label: 'Все' },
      { id: 'available', label: 'Свободные', badge: kpis.availableUnits },
      { id: 'occupied', label: 'Занятые', badge: kpis.occupiedUnits },
      { id: 'checkout', label: 'Выезд 12:00', badge: kpis.checkoutTodayCount },
      { id: 'debt', label: 'Долги', badge: kpis.debtBookingsCount },
      { id: 'dirty', label: 'Уборка', badge: kpis.dirtyUnits },
    ],
    [kpis]
  );

  const query = search.trim().toLowerCase();

  const matchesUnit = (
    roomCode: string,
    status: string,
    booking?: (typeof state.bookings)[number]
  ): boolean => {
    const fin = booking ? calcBookingTotals(booking) : null;
    if (gridFilter === 'available' && status !== 'available') return false;
    if (gridFilter === 'occupied' && status !== 'occupied') return false;
    if (gridFilter === 'checkout' && !booking?.checkingOutToday) return false;
    if (gridFilter === 'debt' && (!fin || fin.debtUsd <= 0)) return false;
    if (gridFilter === 'dirty' && status !== 'dirty') return false;

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
  }, [groupedCategories, activeBookingMap, gridFilter, query]);

  // Flat rows for 14-day Calendar Tape Chart
  const tapeRows = useMemo(() => {
    const rows: Array<{
      key: string;
      roomId: string;
      bedId?: string;
      label: string;
      subLabel: string;
      colorHex: string;
      status: string;
    }> = [];
    for (const { category, rooms } of groupedCategories) {
      const refinedColor = getTopchanRoomColor(category.id, category.colorHex);
      for (const room of rooms) {
        if (room.beds) {
          for (const bed of room.beds) {
            const b = activeBookingMap.get(`${room.id}:${bed.id}`);
            if (!matchesUnit(`${room.code} ${bed.label}`, bed.status, b)) continue;
            rows.push({
              key: `${room.id}:${bed.id}`,
              roomId: room.id,
              bedId: bed.id,
              label: `${room.code} ${bed.label}`,
              subLabel: bed.tier,
              colorHex: refinedColor,
              status: bed.status,
            });
          }
        } else {
          const b = activeBookingMap.get(room.id);
          if (!matchesUnit(room.code, room.status, b)) continue;
          rows.push({
            key: room.id,
            roomId: room.id,
            label: room.code,
            subLabel: category.shortName,
            colorHex: refinedColor,
            status: room.status,
          });
        }
      }
    }
    return rows;
  }, [groupedCategories, activeBookingMap, gridFilter, query]);

  return (
    <div className="space-y-6">
      {/* Header Row */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[var(--text-primary)]">
            Шахматка номерного фонда
          </h1>
          <p className="text-xs sm:text-sm text-[var(--text-muted)] mt-0.5">
            Быстрые действия прямо на карточке: оплата, стирка, выезд или новое заселение в 1 клик
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl
            options={VIEW_MODE_OPTIONS}
            value={viewMode}
            onChange={setViewMode}
            layoutId="gridViewMode"
            ariaLabel="Режим отображения шахматки"
          />

          <button
            type="button"
            onClick={() => openQrPosterModal()}
            className="px-3.5 py-2.5 rounded-xl bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] hover:border-[var(--border-strong)] text-[var(--text-primary)] text-xs font-semibold transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            <QrCode
              className="w-4 h-4 shrink-0"
              strokeWidth={1.75}
              style={{ color: 'var(--tone-emerald-fg)' }}
            />
            QR-постеры
          </button>

          <button
            type="button"
            onClick={() => openCheckInModal()}
            className="px-4 py-2.5 rounded-xl bg-[#059669] hover:bg-[#047857] text-white text-xs sm:text-sm font-semibold transition-colors inline-flex items-center gap-2 whitespace-nowrap shrink-0"
          >
            <UserPlus className="w-4 h-4 shrink-0" strokeWidth={1.75} />
            Заселить гостя
          </button>
        </div>
      </div>

      {/* Top 4 KPI Strip (Calm 4-card max) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MetricTile
          label="Загрузка сейчас"
          value={`${kpis.occupancyPct}%`}
          subtext={`${kpis.occupiedUnits} из ${kpis.totalUnits} мест`}
          tone="neutral"
          active={gridFilter === 'occupied'}
          onClick={() => setGridFilter(gridFilter === 'occupied' ? 'all' : 'occupied')}
        />
        <MetricTile
          label="Свободно"
          value={kpis.availableUnits}
          subtext="комнат и коек готово"
          tone="emerald"
          active={gridFilter === 'available'}
          onClick={() => setGridFilter(gridFilter === 'available' ? 'all' : 'available')}
        />
        <MetricTile
          label="Выезд в 12:00"
          value={kpis.checkoutTodayCount}
          subtext="сегодня до полудня"
          tone={kpis.checkoutTodayCount > 0 ? 'amber' : 'neutral'}
          active={gridFilter === 'checkout'}
          onClick={() => setGridFilter(gridFilter === 'checkout' ? 'all' : 'checkout')}
        />
        <MetricTile
          label="Открытые долги"
          value={formatUsd(kpis.totalDebtUsd)}
          subtext={
            kpis.debtBookingsCount > 0
              ? `по ${kpis.debtBookingsCount} счетам гостей`
              : 'все счета оплачены'
          }
          tone={kpis.totalDebtUsd > 0 ? 'rose' : 'emerald'}
          active={gridFilter === 'debt'}
          onClick={() => setGridFilter(gridFilter === 'debt' ? 'all' : 'debt')}
        />
      </div>

      {/* Filter Bar + Search */}
      <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
        <SegmentedControl
          options={filterOptions}
          value={gridFilter}
          onChange={setGridFilter}
          layoutId="gridFilterBar"
          ariaLabel="Фильтры комнат"
        />

        <div className="relative lg:w-72 shrink-0">
          <Search
            className="w-4 h-4 text-[var(--text-muted)] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
            strokeWidth={1.75}
          />
          <input
            type="search"
            aria-label="Поиск по гостю, паспорту или комнате"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Гость, паспорт или Small #1..."
            className="ops-input w-full pl-10 pr-3.5 py-2.5 text-sm"
          />
        </div>
      </div>

      {/* 14-Day Horizontal Calendar Tape Chart */}
      {viewMode === 'tape' && hasVisibleResults && (
        <div className="ops-card overflow-hidden">
          <div className="px-4 py-3 border-b border-[var(--border-subtle)] flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2 text-[var(--text-primary)] font-semibold">
              <CalendarRange
                className="w-4 h-4 shrink-0"
                strokeWidth={1.75}
                style={{ color: 'var(--tone-cobalt-fg)' }}
              />
              <span>Календарь заселения на 14 дней (Ташкент UZT)</span>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-[var(--text-muted)]">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-[#059669]" /> Оплачено
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-[#D97706]" /> Выезд 12:00
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-[#E11D48]" /> Долг
              </span>
            </div>
          </div>

          <div className="overflow-x-auto max-h-[68vh] overflow-y-auto">
            <div className="min-w-[1260px]">
              {/* Sticky Top Date Column Header */}
              <div
                className="grid sticky top-0 z-20 border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)]"
                style={{ gridTemplateColumns: '196px repeat(14, minmax(76px, 1fr))' }}
              >
                <div className="sticky left-0 z-30 bg-[var(--bg-elevated)] px-3.5 py-2.5 text-xs font-semibold text-[var(--text-muted)] border-r border-[var(--border-subtle)] flex items-center">
                  Комната / Койка
                </div>
                {tapeDates.map((iso, idx) => {
                  const col = formatShortDateColumn(iso);
                  const isToday = idx === 0;
                  return (
                    <div
                      key={iso}
                      className="px-2 py-2 text-center border-r border-[var(--border-subtle)]"
                      style={
                        isToday
                          ? {
                              backgroundColor: 'var(--tone-emerald-bg)',
                              color: 'var(--tone-emerald-fg)',
                            }
                          : col.isWeekend
                            ? {
                                backgroundColor: 'var(--bg-hover)',
                                color: 'var(--text-primary)',
                              }
                            : { color: 'var(--text-muted)' }
                      }
                    >
                      <div className="text-xs font-semibold uppercase">
                        {isToday ? 'Сег' : col.weekday}
                      </div>
                      <div className="text-xs font-mono tabular-nums font-bold">{col.dayMonth}</div>
                    </div>
                  );
                })}
              </div>

              {/* Room / Bed Rows */}
              <div className="divide-y divide-[var(--border-subtle)]">
                {tapeRows.map((row) => {
                  const rowSegments = state.bookings
                    .filter((b) => b.status === 'active')
                    .flatMap((b) =>
                      b.segments
                        .filter(
                          (seg) =>
                            seg.roomId === row.roomId &&
                            (row.bedId ? seg.bedId === row.bedId : !seg.bedId)
                        )
                        .map((seg) => ({ booking: b, segment: seg }))
                    );

                  const windowStart = tapeDates[0];
                  const windowEndExclusive = (() => {
                    const last = new Date(`${tapeDates[tapeDates.length - 1]}T12:00:00Z`);
                    last.setUTCDate(last.getUTCDate() + 1);
                    return last.toISOString().slice(0, 10);
                  })();

                  return (
                    <div
                      key={row.key}
                      className="grid relative items-stretch min-h-[50px] hover:bg-[var(--bg-hover)]/40 transition-colors"
                      style={{ gridTemplateColumns: '196px repeat(14, minmax(76px, 1fr))' }}
                    >
                      {/* Sticky Left Room Label */}
                      <div className="sticky left-0 z-10 bg-[var(--bg-surface)] px-3.5 py-2 border-r border-[var(--border-subtle)] flex items-center gap-2.5 min-w-0">
                        <span
                          className="w-1 h-7 rounded-full shrink-0"
                          style={{ backgroundColor: row.colorHex }}
                        />
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-[var(--text-primary)] truncate">
                            {row.label}
                          </div>
                          <div className="text-xs text-[var(--text-muted)] truncate">
                            {row.status === 'dirty' ? 'На уборке' : row.subLabel}
                          </div>
                        </div>
                      </div>

                      {/* 14 Clickable Day Cells */}
                      {tapeDates.map((iso, idx) => (
                        <button
                          key={iso}
                          type="button"
                          onClick={() =>
                            openCheckInModal({
                              roomId: row.roomId,
                              bedId: row.bedId,
                              fromDate: iso,
                            })
                          }
                          title={`Заселить в ${row.label} с ${iso}`}
                          className="border-r border-[var(--border-subtle)] h-full min-h-[50px] transition-colors hover:bg-[var(--tone-emerald-bg)] focus:outline-none"
                          style={idx === 0 ? { backgroundColor: 'var(--tone-emerald-bg)' } : undefined}
                        />
                      ))}

                      {/* Overlay Spanning Booking Bars */}
                      <div
                        className="pointer-events-none absolute inset-y-1.5 right-0 grid"
                        style={{
                          left: '196px',
                          gridTemplateColumns: 'repeat(14, minmax(76px, 1fr))',
                        }}
                      >
                        {rowSegments.map(({ booking, segment }) => {
                          if (
                            segment.toDate <= windowStart ||
                            segment.fromDate >= windowEndExclusive
                          ) {
                            return null;
                          }
                          const startIdx = Math.max(
                            0,
                            tapeDates.findIndex((d) => d >= segment.fromDate)
                          );
                          const endIdxRaw = tapeDates.findIndex((d) => d >= segment.toDate);
                          const endIdx = endIdxRaw === -1 ? 14 : endIdxRaw;
                          const spanCols = Math.max(1, endIdx - startIdx);
                          const fin = calcBookingTotals(booking);
                          const guest = booking.guests[0];
                          const isVip =
                            guest &&
                            state.guestProfiles.some(
                              (p) => p.passportNo === guest.passportNo && p.tag === 'vip'
                            );

                          const toneStyle =
                            fin.debtUsd > 0
                              ? {
                                  backgroundColor: 'var(--tone-rose-bg)',
                                  borderColor: 'var(--tone-rose-border)',
                                  color: 'var(--tone-rose-fg)',
                                }
                              : booking.checkingOutToday
                                ? {
                                    backgroundColor: 'var(--tone-amber-bg)',
                                    borderColor: 'var(--tone-amber-border)',
                                    color: 'var(--tone-amber-fg)',
                                  }
                                : {
                                    backgroundColor: 'var(--tone-emerald-bg)',
                                    borderColor: 'var(--tone-emerald-border)',
                                    color: 'var(--tone-emerald-fg)',
                                  };

                          const tooltipText = `${guest?.fullName ?? 'Гость'} · ${segment.fromDate} → ${segment.toDate} · ${
                            fin.debtUsd > 0
                              ? `Долг ${formatUsd(fin.debtUsd)}`
                              : 'Оплачено'
                          }`;

                          return (
                            <button
                              key={segment.id}
                              type="button"
                              title={tooltipText}
                              onClick={() => setSelectedBookingId(booking.id)}
                              style={{
                                gridColumn: `${startIdx + 1} / span ${spanCols}`,
                                ...toneStyle,
                              }}
                              className="pointer-events-auto mx-1 rounded-xl border px-2.5 py-1 text-left flex items-center justify-between gap-1.5 overflow-hidden transition-opacity hover:opacity-90"
                            >
                              <span className="flex items-center gap-1.5 text-xs font-semibold truncate">
                                {isVip && (
                                  <Sparkles
                                    className="w-3.5 h-3.5 shrink-0"
                                    strokeWidth={1.75}
                                    style={{ color: 'var(--tone-amber-fg)' }}
                                  />
                                )}
                                <span className="truncate">{guest?.fullName ?? 'Гость'}</span>
                              </span>
                              {fin.debtUsd > 0 && (
                                <span className="font-mono text-xs font-bold shrink-0 tabular-nums">
                                  −${fin.debtUsd}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Empty Search / Filter State */}
      {!hasVisibleResults && (
        <EmptyState
          icon={BedDouble}
          title="По выбранному фильтру комнат не найдено"
          description="Попробуйте сбросить активный фильтр или очистить поисковый запрос по имени гостя."
          actionLabel="Сбросить фильтры"
          onAction={() => {
            setGridFilter('all');
            setSearch('');
          }}
        />
      )}

      {/* Category-Grouped Room Cards */}
      {viewMode === 'cards' && hasVisibleResults && (
        <div className="space-y-6">
          {groupedCategories.map(({ category, rooms }) => {
            const refinedColor = getTopchanRoomColor(category.id, category.colorHex);
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
                  .map((bed) => ({
                    room,
                    bed: bed as NonNullable<(typeof rooms)[number]['beds']>[number] | undefined,
                  }));
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
                <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-[var(--border-subtle)]">
                  <div className="flex items-center gap-2.5">
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: refinedColor }}
                      aria-hidden="true"
                    />
                    <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                      {category.name}
                    </h2>
                    <span className="text-xs text-[var(--text-muted)]">
                      {category.bathroomType === 'private' ? 'Свой санузел' : 'Общий душ'}
                    </span>
                  </div>
                  <div className="text-xs font-mono tabular-nums text-[var(--text-muted)]">
                    {priceSummary}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3.5">
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
                    const hasUnregisteredForeigner = Boolean(
                      booking?.guests.some((g) => g.isForeigner && !g.emehmonRegistered)
                    );

                    const openPrimaryAction = () => {
                      if (status === 'occupied' && booking) {
                        openBookingFolio(booking.id);
                      } else if (status === 'dirty') {
                        setServicesSubTab('laundry_hk');
                        setActiveTab('services');
                        pushToast(
                          `${bed ? `${room.code} ${bed.label}` : room.code} на уборке`,
                          'Переход в раздел уборки для приёмки комнаты',
                          'amber'
                        );
                      } else {
                        openCheckInModal({ roomId: room.id, bedId: bed?.id });
                      }
                    };

                    return (
                      <div
                        key={key}
                        className="relative rounded-2xl border border-[var(--border-subtle)] hover:border-[var(--border-strong)] bg-[var(--bg-surface)] overflow-hidden transition-colors flex flex-col justify-between"
                      >
                        {/* Subtle 3px Left Topchan Room Color Accent Bar */}
                        <span
                          aria-hidden="true"
                          className="absolute left-0 top-0 bottom-0 w-[3px]"
                          style={{ backgroundColor: refinedColor }}
                        />

                        {/* Main Clickable Card Area */}
                        <button
                          type="button"
                          onClick={openPrimaryAction}
                          className="text-left pl-4 pr-3.5 pt-3.5 pb-3 hover:bg-[var(--bg-hover)]/45 transition-colors flex-1 flex flex-col justify-between gap-3 w-full"
                        >
                          <div className="flex items-start justify-between gap-2 w-full">
                            <div className="min-w-0">
                              <div className="text-sm font-semibold text-[var(--text-primary)] truncate">
                                {bed ? `${room.code} · Койка ${bed.label}` : room.code}
                              </div>
                              {bed && (
                                <div className="text-xs text-[var(--text-muted)] mt-0.5">
                                  {bed.tier}
                                </div>
                              )}
                            </div>

                            {/* Primary Status Pill (clean, max 1 in top-right) */}
                            {status === 'available' && (
                              <StatusPill tone="emerald" icon={CheckCircle2}>
                                Свободна
                              </StatusPill>
                            )}
                            {status === 'dirty' && (
                              <StatusPill tone="amber" icon={Clock}>
                                Уборка
                              </StatusPill>
                            )}
                            {status === 'occupied' && fin && fin.debtUsd > 0 && (
                              <StatusPill tone="rose" icon={AlertCircle} mono>
                                −{formatUsd(fin.debtUsd)}
                              </StatusPill>
                            )}
                            {status === 'occupied' &&
                              (!fin || fin.debtUsd === 0) &&
                              booking?.checkingOutToday && (
                                <StatusPill tone="amber" icon={Clock}>
                                  Выезд 12:00
                                </StatusPill>
                              )}
                            {status === 'occupied' &&
                              (!fin || fin.debtUsd === 0) &&
                              !booking?.checkingOutToday && (
                                <StatusPill tone="emerald">Оплачено</StatusPill>
                              )}
                          </div>

                          {status === 'occupied' && booking && primaryGuest ? (
                            <div className="space-y-1.5 w-full">
                              <div className="flex items-center gap-1.5 text-sm font-medium text-[var(--text-primary)] truncate">
                                {vipProfile && (
                                  <Sparkles
                                    className="w-3.5 h-3.5 shrink-0"
                                    strokeWidth={1.75}
                                    style={{ color: 'var(--tone-amber-fg)' }}
                                  />
                                )}
                                <span className="truncate">
                                  {primaryGuest.fullName}
                                  {booking.guests.length > 1
                                    ? ` +${booking.guests.length - 1}`
                                    : ''}
                                </span>
                              </div>
                              <div className="flex items-center justify-between gap-2 text-xs text-[var(--text-muted)] font-mono tabular-nums">
                                <span className="truncate">
                                  {primaryGuest.citizenship}
                                  {hasUnregisteredForeigner ? ' · Нет E-mehmon' : ''}
                                </span>
                                <span className="shrink-0">
                                  до {booking.segments[booking.segments.length - 1]?.toDate.slice(5)}
                                </span>
                              </div>
                            </div>
                          ) : status === 'dirty' ? (
                            <div className="text-xs text-[var(--text-secondary)]">
                              Ожидает уборки и приёмки администратором
                            </div>
                          ) : (
                            <div className="text-xs text-[var(--text-muted)] font-mono tabular-nums">
                              Тариф от ${category.pricesUsd[1]}/ночь
                            </div>
                          )}
                        </button>

                        {/* 1-Click Quick-Action Strip */}
                        <div className="pl-4 pr-3 py-2 border-t border-[var(--border-subtle)] bg-[var(--bg-elevated)] flex items-center gap-1.5">
                          {status === 'occupied' && booking ? (
                            <>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openBookingFolio(booking.id, { openPayment: true });
                                }}
                                className="flex-1 py-1.5 px-2 rounded-xl bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-xs font-semibold text-[var(--text-primary)] inline-flex items-center justify-center gap-1 transition-colors whitespace-nowrap"
                              >
                                <Banknote
                                  className="w-3.5 h-3.5 shrink-0"
                                  strokeWidth={1.75}
                                  style={{ color: 'var(--tone-emerald-fg)' }}
                                />
                                Оплата
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  addLedgerCharge(
                                    booking.id,
                                    'laundry_fast',
                                    'Быстрая стирка (22 мин)',
                                    2,
                                    { startLaundryMode: 'fast' }
                                  );
                                }}
                                className="flex-1 py-1.5 px-2 rounded-xl bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-xs font-semibold text-[var(--text-primary)] inline-flex items-center justify-center gap-1 transition-colors whitespace-nowrap"
                              >
                                <WashingMachine
                                  className="w-3.5 h-3.5 shrink-0"
                                  strokeWidth={1.75}
                                  style={{ color: 'var(--tone-cobalt-fg)' }}
                                />
                                Стирка
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openCheckOutModal(booking.id);
                                }}
                                className="py-1.5 px-2.5 rounded-xl bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-xs font-semibold text-[var(--text-primary)] inline-flex items-center justify-center gap-1 transition-colors whitespace-nowrap"
                              >
                                <DoorOpen
                                  className="w-3.5 h-3.5 shrink-0"
                                  strokeWidth={1.75}
                                  style={{ color: 'var(--tone-amber-fg)' }}
                                />
                                Выезд
                              </button>
                            </>
                          ) : status === 'dirty' ? (
                            <button
                              type="button"
                              onClick={openPrimaryAction}
                              className="w-full py-1.5 px-3 rounded-xl border text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors"
                              style={{
                                backgroundColor: 'var(--tone-amber-bg)',
                                borderColor: 'var(--tone-amber-border)',
                                color: 'var(--tone-amber-fg)',
                              }}
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" strokeWidth={1.75} />
                              Принять уборку
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => openCheckInModal({ roomId: room.id, bedId: bed?.id })}
                              className="w-full py-1.5 px-3 rounded-xl border text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors"
                              style={{
                                backgroundColor: 'var(--tone-emerald-bg)',
                                borderColor: 'var(--tone-emerald-border)',
                                color: 'var(--tone-emerald-fg)',
                              }}
                            >
                              <Plus className="w-3.5 h-3.5" strokeWidth={1.75} />
                              Заселить гостя
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {/* Subtle Footer Note */}
      <div className="flex items-center gap-2 text-xs text-[var(--text-muted)] pt-2 border-t border-[var(--border-subtle)]">
        <BedDouble className="w-4 h-4 shrink-0" strokeWidth={1.75} />
        <span>
          Номерной фонд и тарифы редактируются во вкладке «Настройки» → «Комнаты и прайс»
        </span>
      </div>
    </div>
  );
};
