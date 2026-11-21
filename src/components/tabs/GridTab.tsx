import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Banknote,
  BedDouble,
  Brush,
  CalendarRange,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  CreditCard,
  DoorOpen,
  FileText,
  LayoutGrid,
  Plus,
  QrCode,
  Search,
  Wrench,
} from 'lucide-react';
import { useOps, useTimers } from '../../context/OpsContext';
import type { GridFilterId, GridViewMode } from '../../context/UIContext';
import type { BookingGroup, DormBed, PhysicalRoom, RoomCategory, StaySegment } from '../../types/ops';
import { computeDailyAvailabilitySummary } from '../../utils/availability';
import { calcBookingTotals, formatUsd } from '../../utils/math';
import { getTopchanRoomColor } from '../../utils/roomColors';
import {
  addDaysIso,
  formatShortDateColumn,
  getDateRangeIso,
  getTashkentTodayIso,
} from '../../utils/time';
import { EmptyState, MetricTile, SegmentedControl, StatusPill } from '../ui';

const TodayClockBadge: React.FC = () => {
  const { clockStr } = useTimers();
  return (
    <span className="font-mono tabular-nums text-[10px] font-bold tracking-tight opacity-90">
      {clockStr.slice(0, 5)}
    </span>
  );
};

function formatCompactGuestName(fullName?: string): string {
  if (!fullName) return 'Гость';
  const parts = fullName.trim().split(/\s+/);
  if (parts.length <= 1) return parts[0];
  return `${parts[0]} ${parts[1][0]}.`;
}

interface HoverInspectorState {
  booking: BookingGroup;
  segment: StaySegment;
  roomLabel: string;
  x: number;
  y: number;
}

interface DraggingSegmentState {
  bookingId: string;
  segmentId: string;
  mode: 'move' | 'resize-right';
  nights: number;
  origFromDate: string;
  origToDate: string;
  origRoomId: string;
  origBedId?: string;
}

interface DropTargetState {
  roomId: string;
  bedId?: string;
  iso: string;
}

const VIEW_MODE_OPTIONS: Array<{
  id: GridViewMode;
  label: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
}> = [
  { id: 'tape', label: 'Шахматка (14 дней)', icon: CalendarRange },
  { id: 'cards', label: 'Карточки сегодня', icon: LayoutGrid },
];

interface TapeUnitRow {
  key: string;
  roomId: string;
  bedId?: string;
  room: PhysicalRoom;
  bed?: DormBed;
  category: RoomCategory;
  label: string;
  subLabel: string;
  badge?: string;
  colorHex: string;
  status: PhysicalRoom['status'];
}

interface TapeGroup {
  id: string;
  label: string;
  colorHex: string;
  badge?: string;
  rows: TapeUnitRow[];
}

const TAPE_GROUP_DEFS: Array<{
  id: string;
  label: string;
  categoryIds: string[];
  colorHex: string;
  badge?: string;
}> = [
  { id: 'grp-small', label: 'Small', categoryIds: ['cat-small'], colorHex: '#64748B' },
  { id: 'grp-yellow', label: 'Yellow', categoryIds: ['cat-yellow'], colorHex: '#D97706' },
  {
    id: 'grp-colors',
    label: 'Цветные (Violet, Red, Green, Orange, Pink)',
    categoryIds: ['cat-violet', 'cat-red', 'cat-green', 'cat-orange', 'cat-pink'],
    colorHex: '#059669',
  },
  { id: 'grp-blue', label: 'Blue Family', categoryIds: ['cat-blue'], colorHex: '#2563EB' },
  { id: 'grp-mix', label: 'Mix Dorm', categoryIds: ['cat-mix-dorm'], colorHex: '#0D9488' },
  { id: 'grp-six', label: 'Six Dorm', categoryIds: ['cat-six-dorm'], colorHex: '#0284C7' },
  {
    id: 'grp-fem',
    label: 'Fem Dorm',
    categoryIds: ['cat-fem-dorm'],
    colorHex: '#9333EA',
    badge: 'Женский',
  },
];

function nextHousekeepingStatus(
  current: PhysicalRoom['status']
): 'available' | 'dirty' | 'maintenance' {
  if (current === 'available') return 'dirty';
  if (current === 'dirty') return 'maintenance';
  return 'available';
}

export const GridTab: React.FC = () => {
  const {
    state,
    gridViewMode,
    setGridViewMode,
    tapeStartDate,
    setTapeStartDate,
    tapeCategoryFilter,
    setTapeCategoryFilter,
    gridFilter,
    setGridFilter,
    openCheckInModal,
    openCheckOutModal,
    openQrPosterModal,
    openBookingFolio,
    openWelcomeCardModal,
    setSelectedBookingId,
    setRoomHousekeepingStatus,
    moveOrResizeSegment,
  } = useOps();

  const [search, setSearch] = useState('');
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [hoverInspector, setHoverInspector] = useState<HoverInspectorState | null>(null);
  const [draggingSeg, setDraggingSeg] = useState<DraggingSegmentState | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTargetState | null>(null);
  const hoverShowTimerRef = useRef<number | null>(null);
  const hoverHideTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (hoverShowTimerRef.current) window.clearTimeout(hoverShowTimerRef.current);
      if (hoverHideTimerRef.current) window.clearTimeout(hoverHideTimerRef.current);
    };
  }, []);

  const scheduleShowInspector = (
    e: React.MouseEvent<HTMLElement>,
    booking: BookingGroup,
    segment: StaySegment,
    roomLabel: string
  ) => {
    if (hoverHideTimerRef.current) {
      window.clearTimeout(hoverHideTimerRef.current);
      hoverHideTimerRef.current = null;
    }
    if (hoverShowTimerRef.current) {
      window.clearTimeout(hoverShowTimerRef.current);
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.min(Math.max(12, rect.left), window.innerWidth - 304);
    const y = rect.bottom + 8 + 185 > window.innerHeight ? Math.max(12, rect.top - 188) : rect.bottom + 8;
    hoverShowTimerRef.current = window.setTimeout(() => {
      setHoverInspector({ booking, segment, roomLabel, x, y });
    }, 180);
  };

  const scheduleHideInspector = () => {
    if (hoverShowTimerRef.current) {
      window.clearTimeout(hoverShowTimerRef.current);
      hoverShowTimerRef.current = null;
    }
    if (hoverHideTimerRef.current) {
      window.clearTimeout(hoverHideTimerRef.current);
    }
    hoverHideTimerRef.current = window.setTimeout(() => {
      setHoverInspector(null);
    }, 140);
  };

  const keepInspectorOpen = () => {
    if (hoverHideTimerRef.current) {
      window.clearTimeout(hoverHideTimerRef.current);
      hoverHideTimerRef.current = null;
    }
  };

  const todayIso = useMemo(() => getTashkentTodayIso(), []);
  const tapeDates = useMemo(() => getDateRangeIso(tapeStartDate, 14), [tapeStartDate]);
  const todayColIdx = useMemo(() => tapeDates.indexOf(todayIso), [tapeDates, todayIso]);
  const windowStart = tapeDates[0];
  const windowEndExclusive = useMemo(
    () => addDaysIso(tapeDates[tapeDates.length - 1], 1),
    [tapeDates]
  );

  const categoryById = useMemo(
    () => new Map(state.roomCategories.map((c) => [c.id, c])),
    [state.roomCategories]
  );

  const activeRooms = useMemo(
    () => state.physicalRooms.filter((r) => !r.archived),
    [state.physicalRooms]
  );

  // Map active booking by roomId or roomId:bedId
  const activeBookingMap = useMemo(() => {
    const map = new Map<string, BookingGroup>();
    for (const b of state.bookings) {
      if (b.status !== 'active') continue;
      const seg = b.segments[b.segments.length - 1];
      if (!seg) continue;
      const key = seg.bedId ? `${seg.roomId}:${seg.bedId}` : seg.roomId;
      map.set(key, b);
    }
    return map;
  }, [state.bookings]);

  // All 37 bookable units (17 private rooms + 20 dorm beds)
  const allUnits = useMemo<TapeUnitRow[]>(() => {
    const list: TapeUnitRow[] = [];
    for (const room of activeRooms) {
      const cat = categoryById.get(room.categoryId);
      if (!cat) continue;
      const colorHex = getTopchanRoomColor(cat.id, cat.colorHex);
      if (room.beds) {
        for (const bed of room.beds) {
          list.push({
            key: `${room.id}:${bed.id}`,
            roomId: room.id,
            bedId: bed.id,
            room,
            bed,
            category: cat,
            label: bed.label,
            subLabel: bed.tier,
            badge: cat.femaleOnly ? 'Женский' : undefined,
            colorHex,
            status: bed.status,
          });
        }
      } else {
        const badge = cat.bedType
          ? '1 большая кровать'
          : cat.id === 'cat-orange'
            ? 'макс. 2'
            : cat.id === 'cat-pink'
              ? 'макс. 3'
              : undefined;
        list.push({
          key: room.id,
          roomId: room.id,
          room,
          category: cat,
          label: room.code,
          subLabel:
            cat.bathroomType === 'private'
              ? `Свой с/у · до ${cat.maxOccupancy} чел.`
              : `Общий душ · до ${cat.maxOccupancy} чел.`,
          badge,
          colorHex,
          status: room.status,
        });
      }
    }
    return list;
  }, [activeRooms, categoryById]);

  // Live KPIs across all 37 bookable units
  const kpis = useMemo(() => {
    let totalUnits = allUnits.length;
    let occupiedUnits = 0;
    let availableUnits = 0;
    let dirtyUnits = 0;

    for (const u of allUnits) {
      if (u.status === 'occupied') occupiedUnits += 1;
      else if (u.status === 'dirty' || u.status === 'maintenance') dirtyUnits += 1;
      else availableUnits += 1;
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
  }, [allUnits, state.bookings]);

  // Daily availability & occupancy synced with real dirty / maintenance unit statuses
  const dailySummary = useMemo(
    () => computeDailyAvailabilitySummary(state.physicalRooms, state.bookings, tapeDates, todayIso),
    [state.physicalRooms, state.bookings, tapeDates, todayIso]
  );

  const todayStatusBreakdown = useMemo(() => {
    const ready = allUnits.filter((u) => u.status === 'available').length;
    const dirty = allUnits.filter((u) => u.status === 'dirty').length;
    const maintenance = allUnits.filter((u) => u.status === 'maintenance').length;
    return { ready, dirty, maintenance };
  }, [allUnits]);

  const filterOptions = useMemo<Array<{ id: GridFilterId; label: string; badge?: number }>>(
    () => [
      { id: 'all', label: 'Все' },
      { id: 'available', label: 'Свободные', badge: kpis.availableUnits },
      { id: 'occupied', label: 'Занятые', badge: kpis.occupiedUnits },
      { id: 'checkout', label: 'Выезд 12:00', badge: kpis.checkoutTodayCount },
      { id: 'debt', label: 'Долги', badge: kpis.debtBookingsCount },
      { id: 'dirty', label: 'Уборка / Ремонт', badge: kpis.dirtyUnits },
    ],
    [kpis]
  );

  const query = search.trim().toLowerCase();

  const matchesUnit = (unit: TapeUnitRow): boolean => {
    const booking = activeBookingMap.get(unit.key);
    const fin = booking ? calcBookingTotals(booking) : null;

    if (gridFilter === 'available' && unit.status !== 'available') return false;
    if (gridFilter === 'occupied' && unit.status !== 'occupied') return false;
    if (gridFilter === 'checkout' && !booking?.checkingOutToday) return false;
    if (gridFilter === 'debt' && (!fin || fin.debtUsd <= 0)) return false;
    if (gridFilter === 'dirty' && unit.status !== 'dirty' && unit.status !== 'maintenance') {
      return false;
    }

    if (!query) return true;
    if (
      unit.label.toLowerCase().includes(query) ||
      unit.room.code.toLowerCase().includes(query) ||
      unit.category.name.toLowerCase().includes(query)
    ) {
      return true;
    }
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

  // Collapsible Tape Chart groups
  const tapeGroups = useMemo<TapeGroup[]>(() => {
    const handledCatIds = new Set<string>();
    const groups: TapeGroup[] = [];

    for (const def of TAPE_GROUP_DEFS) {
      def.categoryIds.forEach((cid) => handledCatIds.add(cid));
      if (tapeCategoryFilter !== 'all' && tapeCategoryFilter !== def.id) continue;
      const rows = allUnits.filter(
        (u) => def.categoryIds.includes(u.category.id) && matchesUnit(u)
      );
      if (rows.length > 0) {
        groups.push({
          id: def.id,
          label: def.label,
          colorHex: def.colorHex,
          badge: def.badge,
          rows,
        });
      }
    }

    // Any dynamically added custom categories
    const extraUnits = allUnits.filter(
      (u) => !handledCatIds.has(u.category.id) && matchesUnit(u)
    );
    if (extraUnits.length > 0 && tapeCategoryFilter === 'all') {
      groups.push({
        id: 'grp-other',
        label: 'Другие номера',
        colorHex: '#64748B',
        rows: extraUnits,
      });
    }

    return groups;
  }, [allUnits, tapeCategoryFilter, gridFilter, query, activeBookingMap]);

  const hasVisibleResults = tapeGroups.some((g) => g.rows.length > 0);

  // Split units for Cards View: Private categories vs Dorm matrices
  const privateCardGroups = useMemo(
    () => tapeGroups.filter((g) => !g.rows[0]?.category.isDorm),
    [tapeGroups]
  );
  const dormCardGroups = useMemo(
    () => tapeGroups.filter((g) => Boolean(g.rows[0]?.category.isDorm)),
    [tapeGroups]
  );

  const toggleGroupCollapsed = (groupId: string) => {
    setCollapsedGroups((prev) => ({ ...prev, [groupId]: !prev[groupId] }));
  };

  const renderInlineHousekeepingBtn = (unit: TapeUnitRow) => {
    if (unit.status === 'occupied') {
      return (
        <span
          title="Занято гостем"
          className="inline-flex items-center justify-center w-7 h-7 rounded-lg shrink-0"
          style={{
            backgroundColor: 'var(--pms-confirmed-bg)',
            color: 'var(--pms-confirmed-text)',
          }}
        >
          <BedDouble className="w-3.5 h-3.5" strokeWidth={1.75} />
        </span>
      );
    }

    const nextStatus = nextHousekeepingStatus(unit.status);
    const meta =
      unit.status === 'dirty'
        ? {
            title: 'Уборка · Нажмите для смены на «Ремонт»',
            bg: 'var(--tone-amber-bg)',
            border: 'var(--tone-amber-border)',
            fg: 'var(--tone-amber-fg)',
            icon: Brush,
            label: 'Уборка',
          }
        : unit.status === 'maintenance'
          ? {
              title: 'Ремонт · Нажмите для смены на «Чисто»',
              bg: 'var(--tone-rose-bg)',
              border: 'var(--tone-rose-border)',
              fg: 'var(--tone-rose-fg)',
              icon: Wrench,
              label: 'Ремонт',
            }
          : {
              title: 'Чисто · Нажмите для смены на «Уборка»',
              bg: 'var(--tone-emerald-bg)',
              border: 'var(--tone-emerald-border)',
              fg: 'var(--tone-emerald-fg)',
              icon: Check,
              label: 'Чисто',
            };

    const Icon = meta.icon;
    return (
      <button
        type="button"
        data-testid={`hk-toggle-${unit.key}`}
        onClick={(e) => {
          e.stopPropagation();
          setRoomHousekeepingStatus(unit.roomId, nextStatus, unit.bedId);
        }}
        title={meta.title}
        aria-label={`${unit.label}: ${meta.label}. Сменить статус уборки`}
        className="inline-flex items-center justify-center w-7 h-7 rounded-lg border shrink-0 transition-transform active:scale-95"
        style={{
          backgroundColor: meta.bg,
          borderColor: meta.border,
          color: meta.fg,
        }}
      >
        <Icon className="w-3.5 h-3.5" strokeWidth={2} />
      </button>
    );
  };

  return (
    <div className="space-y-4">
      {/* Top Page Header + Mode Switcher (No competing Primary CTA) */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg sm:text-xl font-bold tracking-tight text-[var(--text-primary)]">
            Шахматка номерного фонда
          </h1>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            20 комнат (17 отдельных + 3 дорма · 20 коек = 37 мест) · Клик по пустой ячейке открывает заезд
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl
            options={VIEW_MODE_OPTIONS}
            value={gridViewMode}
            onChange={setGridViewMode}
            layoutId="gridViewMode"
            ariaLabel="Режим отображения шахматки"
          />

          <button
            type="button"
            onClick={() => openQrPosterModal()}
            className="h-10 px-3.5 rounded-lg bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] hover:border-[var(--border-strong)] text-[var(--text-primary)] text-xs font-semibold transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            <QrCode
              className="w-4 h-4 shrink-0"
              strokeWidth={1.75}
              style={{ color: 'var(--tone-cobalt-fg)' }}
            />
            QR-постеры
          </button>
        </div>
      </div>

      {/* Compact 4-Card KPI Strip */}
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
          label="Свободно сегодня"
          value={kpis.availableUnits}
          subtext="чистых комнат и коек"
          tone="emerald"
          active={gridFilter === 'available'}
          onClick={() => setGridFilter(gridFilter === 'available' ? 'all' : 'available')}
        />
        <MetricTile
          label="Выезд сегодня 12:00"
          value={kpis.checkoutTodayCount}
          subtext="требуют контроля к полудню"
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

      {/* Unified PMS Toolbar: Date Navigation (Tape), Category Filter, Status Filter, Search */}
      <div className="ops-card p-3 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          {/* Date Controls (visible in Tape Chart mode) */}
          {gridViewMode === 'tape' ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                data-testid="tape-prev-week"
                onClick={() => setTapeStartDate((d) => addDaysIso(d, -7))}
                className="h-10 px-3 rounded-lg bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-xs font-semibold text-[var(--text-primary)] inline-flex items-center gap-1 transition-colors whitespace-nowrap"
              >
                <ChevronLeft className="w-4 h-4" strokeWidth={1.75} />
                −7 дней
              </button>
              <button
                type="button"
                data-testid="tape-today"
                onClick={() => setTapeStartDate(todayIso)}
                className="h-10 px-3.5 rounded-lg border text-xs font-semibold transition-colors whitespace-nowrap"
                style={
                  tapeStartDate === todayIso
                    ? {
                        backgroundColor: 'var(--tone-cobalt-bg)',
                        borderColor: 'var(--tone-cobalt-border)',
                        color: 'var(--tone-cobalt-fg)',
                      }
                    : {
                        backgroundColor: 'var(--bg-elevated)',
                        borderColor: 'var(--border-subtle)',
                        color: 'var(--text-primary)',
                      }
                }
              >
                Сегодня
              </button>
              <button
                type="button"
                data-testid="tape-next-week"
                onClick={() => setTapeStartDate((d) => addDaysIso(d, 7))}
                className="h-10 px-3 rounded-lg bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-xs font-semibold text-[var(--text-primary)] inline-flex items-center gap-1 transition-colors whitespace-nowrap"
              >
                +7 дней
                <ChevronRight className="w-4 h-4" strokeWidth={1.75} />
              </button>

              <input
                type="date"
                aria-label="Перейти к дате на шахматке"
                value={tapeStartDate}
                onChange={(e) => {
                  if (e.target.value) setTapeStartDate(e.target.value);
                }}
                className="ops-input h-10 px-3 text-xs font-mono tabular-nums"
              />
            </div>
          ) : (
            <div className="text-xs font-semibold text-[var(--text-secondary)]">
              Оперативная сводка на сегодня ({todayIso})
            </div>
          )}

          {/* Category Dropdown + Guest/Room Search */}
          <div className="flex flex-wrap items-center gap-2 flex-1 sm:flex-initial sm:justify-end">
            <select
              aria-label="Фильтр по категории комнат"
              value={tapeCategoryFilter}
              onChange={(e) => setTapeCategoryFilter(e.target.value)}
              className="ops-input h-10 px-3 text-xs font-medium w-full sm:w-auto sm:min-w-[175px]"
            >
              <option value="all">Все категории (37 мест)</option>
              <option value="grp-small">Small (6 комнат)</option>
              <option value="grp-yellow">Yellow (5 комнат)</option>
              <option value="grp-colors">Цветные (Violet, Red, Green, Orange, Pink)</option>
              <option value="grp-blue">Blue Family (1 комната)</option>
              <option value="grp-mix">Mix Dorm (10 коек)</option>
              <option value="grp-six">Six Dorm (6 коек)</option>
              <option value="grp-fem">Fem Dorm (4 койки)</option>
            </select>

            <div className="relative flex-1 sm:w-64 sm:flex-initial">
              <Search
                className="w-4 h-4 text-[var(--text-muted)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                strokeWidth={1.75}
              />
              <input
                type="search"
                aria-label="Поиск по гостю, паспорту или комнате"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Гость, паспорт, Small-1..."
                className="ops-input h-10 w-full pl-9 pr-3 text-xs"
              />
            </div>
          </div>
        </div>

        {/* Status Filter Strip + Legend */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[var(--border-subtle)]">
          <SegmentedControl
            options={filterOptions}
            value={gridFilter}
            onChange={setGridFilter}
            layoutId="gridFilterBar"
            ariaLabel="Фильтры по статусу"
          />

          {gridViewMode === 'tape' && (
            <div className="hidden xl:flex items-center gap-3 text-xs text-[var(--text-secondary)]">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: 'var(--status-inhouse)' }} /> Проживает
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: 'var(--status-confirmed)' }} /> Бронь
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: 'var(--status-checkout)' }} /> Выезд 12:00
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: 'var(--status-debt)' }} /> Долг / E-mehmon
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Empty Search / Filter State */}
      {!hasVisibleResults && (
        <EmptyState
          icon={BedDouble}
          title="По выбранному фильтру комнат не найдено"
          description="Сбросьте фильтр категории, статуса или поисковый запрос, чтобы увидеть весь номерной фонд."
          actionLabel="Сбросить все фильтры"
          onAction={() => {
            setGridFilter('all');
            setTapeCategoryFilter('all');
            setSearch('');
          }}
        />
      )}

      {/* ====================================================================
       * VIEW 1: TRUE BNOVO / CLOUDBEDS 14-DAY TAPE CHART (DESKTOP DEFAULT)
       * ==================================================================== */}
      {gridViewMode === 'tape' && hasVisibleResults && (
        <div className="ops-card overflow-hidden" data-testid="tape-chart-container">
          <div className="overflow-x-auto max-h-[70vh] overflow-y-auto">
            <div className="min-w-[1090px]">
              {/* Sticky Header Block: Date Columns + Daily Availability Summary Row */}
              <div className="sticky top-0 z-20 bg-[var(--bg-elevated)] border-b border-[var(--border-strong)]">
                {/* Row 1: Dates */}
                <div
                  className="grid border-b border-[var(--border-subtle)]"
                  style={{ gridTemplateColumns: '204px repeat(14, minmax(63px, 1fr))' }}
                >
                  <div className="sticky left-0 z-30 bg-[var(--bg-elevated)] px-3.5 py-2 text-xs font-bold text-[var(--text-secondary)] border-r border-[var(--border-subtle)] flex items-center justify-between">
                    <span>Комната / Койка</span>
                    <span className="font-mono text-xs text-[var(--text-muted)]">Уборка</span>
                  </div>
                  {tapeDates.map((iso) => {
                    const col = formatShortDateColumn(iso);
                    const isToday = iso === todayIso;
                    return (
                      <div
                        key={iso}
                        data-testid={isToday ? 'tape-col-today' : undefined}
                        className="px-1.5 py-2 text-center border-r border-[var(--border-subtle)] relative"
                        style={
                          isToday
                            ? {
                                backgroundColor: 'var(--brand-primary-soft)',
                                color: 'var(--brand-primary)',
                                boxShadow: 'inset 0 2px 0 var(--brand-primary)',
                              }
                            : col.isWeekend
                              ? {
                                  backgroundColor: 'var(--bg-hover)',
                                  color: 'var(--text-primary)',
                                }
                              : { color: 'var(--text-secondary)' }
                        }
                      >
                        <div className="text-[11px] font-bold uppercase leading-tight flex items-center justify-center gap-1">
                          <span>{isToday ? 'Сег' : col.weekday}</span>
                          {isToday && <TodayClockBadge />}
                        </div>
                        <div className="text-xs font-mono tabular-nums font-semibold">
                          {col.dayMonth}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Row 2: Availability & Occupancy Summary Strip */}
                <div
                  className="grid bg-[var(--bg-surface)]"
                  data-testid="tape-availability-row"
                  style={{ gridTemplateColumns: '204px repeat(14, minmax(63px, 1fr))' }}
                >
                  <div className="sticky left-0 z-30 bg-[var(--bg-surface)] px-3 py-1.5 text-xs font-semibold text-[var(--text-muted)] border-r border-[var(--border-subtle)] flex flex-col justify-center gap-0.5">
                    <div className="flex items-center justify-between">
                      <span>Свободно / Загрузка</span>
                      <span className="font-mono tabular-nums text-[var(--text-primary)]">
                        {allUnits.length}
                      </span>
                    </div>
                    <div
                      data-testid="tape-status-breakdown"
                      className="text-[11px] font-mono tabular-nums text-[var(--text-muted)] truncate"
                      title={`Готово: ${todayStatusBreakdown.ready} · Уборка: ${todayStatusBreakdown.dirty} · Ремонт: ${todayStatusBreakdown.maintenance}`}
                    >
                      Готово: {todayStatusBreakdown.ready} · Уборка: {todayStatusBreakdown.dirty} · Ремонт: {todayStatusBreakdown.maintenance}
                    </div>
                  </div>
                  {dailySummary.map((day) => {
                    const isToday = day.iso === todayIso;
                    return (
                      <div
                        key={day.iso}
                        title={
                          isToday
                            ? `Готово: ${day.free} · Занято: ${day.occupied} · Уборка: ${day.dirty} · Ремонт: ${day.maintenance}`
                            : `Свободно: ${day.free} · Занято: ${day.occupied} · Ремонт: ${day.maintenance}`
                        }
                        className="px-1 py-1.5 text-center border-r border-[var(--border-subtle)] font-mono tabular-nums leading-tight"
                        style={
                          isToday
                            ? { backgroundColor: 'var(--tone-cobalt-bg)' }
                            : undefined
                        }
                      >
                        <div
                          className="text-xs font-bold"
                          style={{
                            color:
                              day.free === 0
                                ? 'var(--tone-rose-fg)'
                                : day.free <= 5
                                  ? 'var(--tone-amber-fg)'
                                  : 'var(--tone-emerald-fg)',
                          }}
                        >
                          {day.free} своб.
                        </div>
                        <div className="text-[11px] text-[var(--text-muted)]">
                          {day.pct}%
                          {isToday && (day.dirty > 0 || day.maintenance > 0)
                            ? ` · ${day.dirty + day.maintenance} блок`
                            : ''}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Collapsible Category Groups & Rows + Live Vertical Terracotta "Today (UZT)" Line */}
              <div className="relative">
                {todayColIdx >= 0 && (
                  <div
                    aria-hidden="true"
                    data-testid="tape-today-line"
                    className="pointer-events-none absolute top-0 bottom-0 z-15"
                    style={{
                      left: `calc(204px + ((100% - 204px) / 14) * ${todayColIdx})`,
                      width: '1.5px',
                      backgroundColor: 'var(--brand-primary)',
                      opacity: 0.72,
                    }}
                  />
                )}
                {tapeGroups.map((group) => {
                  const isCollapsed = Boolean(collapsedGroups[group.id]);
                  const freeCount = group.rows.filter((r) => r.status === 'available').length;

                  return (
                    <div key={group.id} className="border-b border-[var(--border-subtle)] last:border-b-0">
                      {/* Collapsible Category Group Header */}
                      <button
                        type="button"
                        onClick={() => toggleGroupCollapsed(group.id)}
                        className="w-full grid items-center bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] transition-colors border-b border-[var(--border-subtle)] text-left"
                        style={{ gridTemplateColumns: '204px 1fr' }}
                      >
                        <div className="sticky left-0 z-10 bg-inherit px-3.5 py-2 border-r border-[var(--border-subtle)] flex items-center justify-between gap-2">
                          <span className="flex items-center gap-2 min-w-0">
                            {isCollapsed ? (
                              <ChevronRight className="w-4 h-4 text-[var(--text-muted)] shrink-0" strokeWidth={1.75} />
                            ) : (
                              <ChevronDown className="w-4 h-4 text-[var(--text-muted)] shrink-0" strokeWidth={1.75} />
                            )}
                            <span
                              className="w-2.5 h-2.5 rounded-full shrink-0"
                              style={{ backgroundColor: group.colorHex }}
                            />
                            <span className="text-xs font-bold text-[var(--text-primary)] truncate">
                              {group.label} ({group.rows.length})
                            </span>
                          </span>
                          {group.badge && (
                            <span
                              className="text-xs font-semibold px-1.5 py-0.5 rounded shrink-0"
                              style={{
                                backgroundColor: 'rgba(147,51,234,0.12)',
                                color: '#9333EA',
                              }}
                            >
                              {group.badge}
                            </span>
                          )}
                        </div>
                        <div className="px-3 py-2 text-xs text-[var(--text-muted)] font-mono tabular-nums flex items-center gap-3">
                          <span>Свободно сейчас: {freeCount} из {group.rows.length}</span>
                        </div>
                      </button>

                      {/* Unit Rows inside Group */}
                      {!isCollapsed && (
                        <div className="divide-y divide-[var(--border-subtle)]">
                          {group.rows.map((unit) => {
                            const rowSegments = state.bookings
                              .filter((b) => b.status === 'active' || b.status === 'checked_out')
                              .flatMap((b) =>
                                b.segments
                                  .filter(
                                    (seg) =>
                                      seg.roomId === unit.roomId &&
                                      (unit.bedId ? seg.bedId === unit.bedId : !seg.bedId)
                                  )
                                  .map((seg) => ({ booking: b, segment: seg }))
                              );

                            return (
                              <div
                                key={unit.key}
                                className="grid relative items-stretch min-h-[46px] hover:bg-[var(--bg-hover)]/35 transition-colors"
                                style={{
                                  gridTemplateColumns: '204px repeat(14, minmax(63px, 1fr))',
                                }}
                              >
                                {/* Sticky Left Column: Room Color Bar + Name + Badge + 1-Click Housekeeping Button */}
                                <div className="sticky left-0 z-10 bg-[var(--bg-surface)] px-3 py-1.5 border-r border-[var(--border-subtle)] flex items-center justify-between gap-2 min-w-0">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <span
                                      className="w-[3px] h-7 rounded-full shrink-0"
                                      style={{ backgroundColor: unit.colorHex }}
                                    />
                                    <div className="min-w-0">
                                      <div className="flex items-center gap-1.5 min-w-0">
                                        <span className="text-xs font-bold text-[var(--text-primary)] truncate">
                                          {unit.label}
                                        </span>
                                        {unit.badge && (
                                          <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-secondary)] truncate max-w-[100px]">
                                            {unit.badge}
                                          </span>
                                        )}
                                      </div>
                                      <div className="text-xs text-[var(--text-muted)] truncate">
                                        {unit.status === 'dirty'
                                          ? 'Требуется уборка'
                                          : unit.status === 'maintenance'
                                            ? 'В ремонте'
                                            : unit.subLabel}
                                      </div>
                                    </div>
                                  </div>

                                  {renderInlineHousekeepingBtn(unit)}
                                </div>

                                {/* 14 Clickable & Droppable Day Cells */}
                                {tapeDates.map((iso) => {
                                  const isToday = iso === todayIso;
                                  const col = formatShortDateColumn(iso);
                                  const isDropHover =
                                    dropTarget !== null &&
                                    dropTarget.roomId === unit.roomId &&
                                    (dropTarget.bedId ?? '') === (unit.bedId ?? '') &&
                                    dropTarget.iso === iso;
                                  return (
                                    <button
                                      key={iso}
                                      type="button"
                                      data-testid={`tape-cell-${unit.key}-${iso}`}
                                      onClick={() =>
                                        openCheckInModal({
                                          roomId: unit.roomId,
                                          bedId: unit.bedId,
                                          fromDate: iso,
                                        })
                                      }
                                      onDragOver={(e) => {
                                        if (!draggingSeg) return;
                                        e.preventDefault();
                                        e.dataTransfer.dropEffect = 'move';
                                        if (
                                          !dropTarget ||
                                          dropTarget.roomId !== unit.roomId ||
                                          (dropTarget.bedId ?? '') !== (unit.bedId ?? '') ||
                                          dropTarget.iso !== iso
                                        ) {
                                          setDropTarget({
                                            roomId: unit.roomId,
                                            bedId: unit.bedId,
                                            iso,
                                          });
                                        }
                                      }}
                                      onDragLeave={() => {
                                        if (
                                          dropTarget &&
                                          dropTarget.roomId === unit.roomId &&
                                          (dropTarget.bedId ?? '') === (unit.bedId ?? '') &&
                                          dropTarget.iso === iso
                                        ) {
                                          setDropTarget(null);
                                        }
                                      }}
                                      onDrop={(e) => {
                                        e.preventDefault();
                                        if (!draggingSeg) return;
                                        const activeDrag = draggingSeg;
                                        setDraggingSeg(null);
                                        setDropTarget(null);

                                        if (activeDrag.mode === 'resize-right') {
                                          const candidateToDate = addDaysIso(iso, 1);
                                          if (candidateToDate <= activeDrag.origFromDate) return;
                                          moveOrResizeSegment({
                                            bookingId: activeDrag.bookingId,
                                            segmentId: activeDrag.segmentId,
                                            targetRoomId: activeDrag.origRoomId,
                                            targetBedId: activeDrag.origBedId,
                                            newFromDate: activeDrag.origFromDate,
                                            newToDate: candidateToDate,
                                          });
                                        } else {
                                          const newToDate = addDaysIso(
                                            iso,
                                            Math.max(1, activeDrag.nights)
                                          );
                                          moveOrResizeSegment({
                                            bookingId: activeDrag.bookingId,
                                            segmentId: activeDrag.segmentId,
                                            targetRoomId: unit.roomId,
                                            targetBedId: unit.bedId,
                                            newFromDate: iso,
                                            newToDate,
                                          });
                                        }
                                      }}
                                      title={`Заселить в ${unit.label} с ${iso} (или перетащите бронь сюда)`}
                                      className="border-r border-[var(--border-subtle)] h-full min-h-[46px] transition-colors hover:bg-[var(--tone-cobalt-bg)] focus:outline-none"
                                      style={
                                        isDropHover
                                          ? {
                                              backgroundColor: 'var(--brand-primary-soft)',
                                              boxShadow: 'inset 0 0 0 2px var(--brand-primary)',
                                            }
                                          : isToday
                                            ? { backgroundColor: 'rgba(196, 98, 45, 0.05)' }
                                            : col.isWeekend
                                              ? { backgroundColor: 'rgba(148, 163, 184, 0.05)' }
                                              : undefined
                                      }
                                    />
                                  );
                                })}

                                {/* Overlay Spanning PMS Booking Bars */}
                                <div
                                  className="pointer-events-none absolute inset-y-1 right-0 grid"
                                  style={{
                                    left: '204px',
                                    gridTemplateColumns: 'repeat(14, minmax(63px, 1fr))',
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
                                    const endIdxRaw = tapeDates.findIndex(
                                      (d) => d >= segment.toDate
                                    );
                                    const endIdx = endIdxRaw === -1 ? 14 : endIdxRaw;
                                    const spanCols = Math.max(1, endIdx - startIdx);
                                    const fin = calcBookingTotals(booking);
                                    const guest = booking.guests[0];
                                    const hasUnregForeigner = booking.guests.some(
                                      (g) => g.isForeigner && !g.emehmonRegistered
                                    );
                                    const isArchived = booking.status === 'checked_out';
                                    const isAlert = !isArchived && (fin.debtUsd > 0 || hasUnregForeigner);
                                    const isCheckoutToday = !isArchived && !isAlert && booking.checkingOutToday;
                                    const isFutureArrival = !isArchived && !isAlert && !isCheckoutToday && segment.fromDate > todayIso;

                                    const barStyle = isArchived
                                      ? {
                                          backgroundColor: 'var(--pms-archived-bg)',
                                          borderColor: 'var(--pms-archived-border)',
                                          color: 'var(--pms-archived-text)',
                                          boxShadow: 'inset 3px 0 0 var(--pms-archived-border)',
                                        }
                                      : isAlert
                                        ? {
                                            backgroundColor: 'var(--pms-alert-bg)',
                                            borderColor: 'var(--pms-alert-border)',
                                            color: 'var(--pms-alert-text)',
                                            boxShadow: 'inset 3px 0 0 var(--status-debt)',
                                          }
                                        : isCheckoutToday
                                          ? {
                                              backgroundColor: 'var(--pms-checkout-bg)',
                                              borderColor: 'var(--pms-checkout-border)',
                                              color: 'var(--pms-checkout-text)',
                                              boxShadow: 'inset 3px 0 0 var(--status-checkout)',
                                            }
                                          : isFutureArrival
                                            ? {
                                                backgroundColor: 'var(--pms-confirmed-bg)',
                                                borderColor: 'var(--pms-confirmed-border)',
                                                color: 'var(--pms-confirmed-text)',
                                                boxShadow: 'inset 3px 0 0 var(--status-confirmed)',
                                              }
                                            : {
                                                backgroundColor: 'var(--pms-paid-bg)',
                                                borderColor: 'var(--pms-paid-border)',
                                                color: 'var(--pms-paid-text)',
                                                boxShadow: 'inset 3px 0 0 var(--status-inhouse)',
                                              };

                                    const statusNote = isArchived
                                      ? 'Выехал'
                                      : fin.debtUsd > 0
                                        ? `Долг ${formatUsd(fin.debtUsd)}`
                                        : hasUnregForeigner
                                          ? 'Нужна рег. E-mehmon'
                                          : booking.checkingOutToday
                                            ? 'Выезд сегодня 12:00'
                                            : 'Оплачено';

                                    const segIndex = booking.segments.findIndex(
                                      (s) => s.id === segment.id
                                    );
                                    const isSplitBooking = booking.segments.length > 1;
                                    const isBeingDragged =
                                      draggingSeg?.segmentId === segment.id &&
                                      draggingSeg?.bookingId === booking.id;

                                    return (
                                      <div
                                        key={segment.id}
                                        role="button"
                                        tabIndex={0}
                                        draggable={!isArchived}
                                        data-testid={`tape-bar-${booking.id}`}
                                        title={`${guest?.fullName ?? 'Гость'} · ${segment.fromDate} → ${segment.toDate} · ${statusNote}${!isArchived ? ' · Перетащите для переноса или потяните правый край' : ''}`}
                                        onClick={() => {
                                          setHoverInspector(null);
                                          setSelectedBookingId(booking.id);
                                        }}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter' || e.key === ' ') {
                                            e.preventDefault();
                                            setHoverInspector(null);
                                            setSelectedBookingId(booking.id);
                                          }
                                        }}
                                        onDragStart={(e) => {
                                          if (isArchived) {
                                            e.preventDefault();
                                            return;
                                          }
                                          setHoverInspector(null);
                                          e.dataTransfer.effectAllowed = 'move';
                                          e.dataTransfer.setData('text/plain', segment.id);
                                          setDraggingSeg({
                                            bookingId: booking.id,
                                            segmentId: segment.id,
                                            mode: 'move',
                                            nights: segment.nights,
                                            origFromDate: segment.fromDate,
                                            origToDate: segment.toDate,
                                            origRoomId: segment.roomId,
                                            origBedId: segment.bedId,
                                          });
                                        }}
                                        onDragEnd={() => {
                                          setDraggingSeg(null);
                                          setDropTarget(null);
                                        }}
                                        onMouseEnter={(e) => {
                                          if (!draggingSeg) {
                                            scheduleShowInspector(e, booking, segment, unit.label);
                                          }
                                        }}
                                        onMouseLeave={scheduleHideInspector}
                                        style={{
                                          gridColumn: `${startIdx + 1} / span ${spanCols}`,
                                          ...barStyle,
                                          opacity: isBeingDragged ? 0.45 : undefined,
                                        }}
                                        className={`pointer-events-auto relative self-center h-[30px] mx-0.5 rounded-[6px] border pl-2 pr-2.5 text-left flex items-center justify-between gap-1.5 overflow-hidden transition-opacity hover:opacity-95 ${
                                          isArchived ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing'
                                        }`}
                                      >
                                        <span className="flex items-center gap-1.5 text-[12px] font-medium truncate leading-none">
                                          <span className="truncate">
                                            {formatCompactGuestName(guest?.fullName)}
                                          </span>
                                          {isSplitBooking && (
                                            <span
                                              title={`Split-Stay: отрезок ${segIndex + 1} из ${booking.segments.length}`}
                                              className="font-mono text-[10px] px-1 py-0.5 rounded border border-dashed border-current/45 opacity-85 shrink-0 leading-none"
                                            >
                                              {segIndex + 1}/{booking.segments.length}⇄
                                            </span>
                                          )}
                                        </span>

                                        <span className="flex items-center gap-1 font-mono text-[11px] font-semibold shrink-0 tabular-nums leading-none">
                                          {fin.debtUsd > 0 && <span>−${fin.debtUsd}</span>}
                                          {hasUnregForeigner && !isArchived && (
                                            <span
                                              aria-label="Требуется регистрация E-mehmon"
                                              className="w-1.5 h-1.5 rounded-full shrink-0"
                                              style={{ backgroundColor: 'var(--status-debt)' }}
                                            />
                                          )}
                                          {!fin.debtUsd && !hasUnregForeigner && isCheckoutToday && (
                                            <span>12:00</span>
                                          )}
                                        </span>

                                        {/* Right-edge resize handle for extending/shortening nights */}
                                        {!isArchived && (
                                          <span
                                            draggable
                                            title="Потяните правый край на нужную дату выезда, чтобы изменить кол-во ночей"
                                            aria-label="Изменить дату выезда перетаскиванием"
                                            onClick={(e) => e.stopPropagation()}
                                            onDragStart={(e) => {
                                              e.stopPropagation();
                                              setHoverInspector(null);
                                              e.dataTransfer.effectAllowed = 'move';
                                              e.dataTransfer.setData('text/plain', `resize:${segment.id}`);
                                              setDraggingSeg({
                                                bookingId: booking.id,
                                                segmentId: segment.id,
                                                mode: 'resize-right',
                                                nights: segment.nights,
                                                origFromDate: segment.fromDate,
                                                origToDate: segment.toDate,
                                                origRoomId: segment.roomId,
                                                origBedId: segment.bedId,
                                              });
                                            }}
                                            onDragEnd={(e) => {
                                              e.stopPropagation();
                                              setDraggingSeg(null);
                                              setDropTarget(null);
                                            }}
                                            className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-current/25 transition-colors"
                                          />
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ====================================================================
       * VIEW 2: TODAY'S CARDS + COMPACT DORM BED MATRICES (MOBILE DEFAULT)
       * ==================================================================== */}
      {gridViewMode === 'cards' && hasVisibleResults && (
        <div className="space-y-6">
          {/* Private Room Groups */}
          {privateCardGroups.map((group) => (
            <section key={group.id} className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-[var(--border-subtle)]">
                <div className="flex items-center gap-2">
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: group.colorHex }}
                  />
                  <h2 className="text-sm font-bold text-[var(--text-primary)]">
                    {group.label} ({group.rows.length})
                  </h2>
                </div>
                <span className="text-xs font-mono tabular-nums text-[var(--text-muted)]">
                  Свободно: {group.rows.filter((r) => r.status === 'available').length} из {group.rows.length}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3.5">
                {group.rows.map((unit) => {
                  const booking = activeBookingMap.get(unit.key);
                  const fin = booking ? calcBookingTotals(booking) : null;
                  const primaryGuest = booking?.guests[0];
                  const hasUnregForeigner = Boolean(
                    booking?.guests.some((g) => g.isForeigner && !g.emehmonRegistered)
                  );

                  const handleCardClick = () => {
                    if (unit.status === 'occupied' && booking) {
                      openBookingFolio(booking.id);
                    } else if (unit.status === 'available') {
                      openCheckInModal({ roomId: unit.roomId, fromDate: todayIso });
                    }
                  };

                  return (
                    <div
                      key={unit.key}
                      className="relative rounded-xl border border-[var(--border-subtle)] hover:border-[var(--border-strong)] bg-[var(--bg-surface)] overflow-hidden transition-colors flex flex-col justify-between shadow-2xs"
                    >
                      {/* 3px Topchan Room Color Left Bar */}
                      <span
                        aria-hidden="true"
                        className="absolute left-0 top-0 bottom-0 w-[3px]"
                        style={{ backgroundColor: unit.colorHex }}
                      />

                      {/* Row 1 & 2: Room Header + Guest/Rate Info */}
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={handleCardClick}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            handleCardClick();
                          }
                        }}
                        className="pl-4 pr-3.5 pt-3.5 pb-3 hover:bg-[var(--bg-hover)]/45 transition-colors flex-1 flex flex-col justify-between gap-2.5"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-sm font-bold text-[var(--text-primary)]">
                                {unit.label}
                              </span>
                              {unit.badge && (
                                <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-secondary)]">
                                  {unit.badge}
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-[var(--text-muted)] mt-0.5">
                              {unit.subLabel}
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            {unit.status === 'available' && (
                              <StatusPill tone="emerald" icon={CheckCircle2}>
                                Свободна
                              </StatusPill>
                            )}
                            {unit.status === 'dirty' && (
                              <StatusPill tone="amber" icon={Clock}>
                                Уборка
                              </StatusPill>
                            )}
                            {unit.status === 'maintenance' && (
                              <StatusPill tone="rose" icon={Wrench}>
                                Ремонт
                              </StatusPill>
                            )}
                            {unit.status === 'occupied' && fin && fin.debtUsd > 0 && (
                              <StatusPill tone="rose" icon={AlertCircle} mono>
                                −{formatUsd(fin.debtUsd)}
                              </StatusPill>
                            )}
                            {unit.status === 'occupied' &&
                              (!fin || fin.debtUsd === 0) &&
                              hasUnregForeigner && (
                                <StatusPill tone="rose" icon={AlertCircle}>
                                  E-mehmon
                                </StatusPill>
                              )}
                            {unit.status === 'occupied' &&
                              (!fin || fin.debtUsd === 0) &&
                              !hasUnregForeigner &&
                              booking?.checkingOutToday && (
                                <StatusPill tone="amber" icon={Clock}>
                                  Выезд 12:00
                                </StatusPill>
                              )}
                            {unit.status === 'occupied' &&
                              (!fin || fin.debtUsd === 0) &&
                              !hasUnregForeigner &&
                              !booking?.checkingOutToday && (
                                <StatusPill tone="emerald">Оплачено</StatusPill>
                              )}
                          </div>
                        </div>

                        {unit.status === 'occupied' && booking && primaryGuest ? (
                          <div className="space-y-1">
                            <div className="text-sm font-semibold text-[var(--text-primary)] truncate">
                              {primaryGuest.fullName}
                              {booking.guests.length > 1 ? ` +${booking.guests.length - 1}` : ''}
                            </div>
                            <div className="flex items-center justify-between gap-2 text-xs text-[var(--text-muted)] font-mono tabular-nums">
                              <span>{primaryGuest.citizenship}</span>
                              <span>
                                до {booking.segments[booking.segments.length - 1]?.toDate.slice(5)}
                              </span>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between text-xs text-[var(--text-muted)] font-mono tabular-nums">
                            <span>От ${unit.category.pricesUsd[1]}/ночь</span>
                            {renderInlineHousekeepingBtn(unit)}
                          </div>
                        )}
                      </div>

                      {/* Row 3: 1-Click Action Bar */}
                      <div className="pl-4 pr-3 py-2 border-t border-[var(--border-subtle)] bg-[var(--bg-elevated)] flex items-center gap-1.5">
                        {unit.status === 'occupied' && booking ? (
                          <>
                            <button
                              type="button"
                              onClick={() => openBookingFolio(booking.id, { openPayment: true })}
                              className="flex-1 h-8 px-2 rounded-lg bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-xs font-semibold text-[var(--text-primary)] inline-flex items-center justify-center gap-1 transition-colors"
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
                              onClick={() => openCheckOutModal(booking.id)}
                              className="flex-1 h-8 px-2 rounded-lg bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-xs font-semibold text-[var(--text-primary)] inline-flex items-center justify-center gap-1 transition-colors"
                            >
                              <DoorOpen
                                className="w-3.5 h-3.5 shrink-0"
                                strokeWidth={1.75}
                                style={{ color: 'var(--tone-amber-fg)' }}
                              />
                              Выезд
                            </button>
                          </>
                        ) : unit.status === 'dirty' || unit.status === 'maintenance' ? (
                          <button
                            type="button"
                            onClick={() => setRoomHousekeepingStatus(unit.roomId, 'available')}
                            className="w-full h-8 px-3 rounded-lg border text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors"
                            style={{
                              backgroundColor: 'var(--tone-emerald-bg)',
                              borderColor: 'var(--tone-emerald-border)',
                              color: 'var(--tone-emerald-fg)',
                            }}
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" strokeWidth={1.75} />
                            Отметить «Чисто»
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => openCheckInModal({ roomId: unit.roomId, fromDate: todayIso })}
                            className="w-full h-8 px-3 rounded-lg border text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors"
                            style={{
                              backgroundColor: 'var(--tone-cobalt-bg)',
                              borderColor: 'var(--tone-cobalt-border)',
                              color: 'var(--tone-cobalt-fg)',
                            }}
                          >
                            <Plus className="w-3.5 h-3.5" strokeWidth={1.75} />
                            Заселить
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}

          {/* Compact Dorm Bed Matrices (Mix-1..10, Six-1..6, Fem-1..4) */}
          {dormCardGroups.map((group) => {
            const cat = group.rows[0]?.category;
            const freeBeds = group.rows.filter((r) => r.status === 'available').length;
            const colsClass =
              group.rows.length >= 10
                ? 'grid-cols-2 sm:grid-cols-5'
                : group.rows.length === 6
                  ? 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-6'
                  : 'grid-cols-2 sm:grid-cols-4';

            return (
              <section key={group.id} className="ops-card overflow-hidden">
                <div className="px-4 py-3 border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)] flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span
                      className="w-3 h-3 rounded-full shrink-0"
                      style={{ backgroundColor: group.colorHex }}
                    />
                    <h2 className="text-sm font-bold text-[var(--text-primary)]">
                      {group.label} ({group.rows.length} коек)
                    </h2>
                    {cat?.femaleOnly && (
                      <span
                        className="text-xs font-semibold px-2 py-0.5 rounded"
                        style={{
                          backgroundColor: 'rgba(147, 51, 234, 0.12)',
                          color: '#9333EA',
                        }}
                      >
                        Женский
                      </span>
                    )}
                  </div>
                  <div className="text-xs font-mono tabular-nums text-[var(--text-secondary)]">
                    Свободно: {freeBeds}/{group.rows.length} · ${cat?.pricesUsd[1] ?? 11}/койка
                  </div>
                </div>

                <div className={`p-3 grid ${colsClass} gap-2.5`}>
                  {group.rows.map((unit) => {
                    const booking = activeBookingMap.get(unit.key);
                    const fin = booking ? calcBookingTotals(booking) : null;
                    const primaryGuest = booking?.guests[0];
                    const hasUnregForeigner = Boolean(
                      booking?.guests.some((g) => g.isForeigner && !g.emehmonRegistered)
                    );

                    const tileTone =
                      unit.status === 'occupied'
                        ? fin && fin.debtUsd > 0 || hasUnregForeigner
                          ? {
                              bg: 'var(--pms-alert-bg)',
                              border: 'var(--pms-alert-border)',
                              fg: 'var(--pms-alert-text)',
                            }
                          : booking?.checkingOutToday
                            ? {
                                bg: 'var(--pms-checkout-bg)',
                                border: 'var(--pms-checkout-border)',
                                fg: 'var(--pms-checkout-text)',
                              }
                            : {
                                bg: 'var(--pms-paid-bg)',
                                border: 'var(--pms-paid-border)',
                                fg: 'var(--pms-paid-text)',
                              }
                        : unit.status === 'dirty'
                          ? {
                              bg: 'var(--tone-amber-bg)',
                              border: 'var(--tone-amber-border)',
                              fg: 'var(--tone-amber-fg)',
                            }
                          : unit.status === 'maintenance'
                            ? {
                                bg: 'var(--tone-rose-bg)',
                                border: 'var(--tone-rose-border)',
                                fg: 'var(--tone-rose-fg)',
                              }
                            : {
                                bg: 'var(--bg-surface)',
                                border: 'var(--border-subtle)',
                                fg: 'var(--text-primary)',
                              };

                    return (
                      <div
                        key={unit.key}
                        className="rounded-xl border p-2.5 flex flex-col justify-between gap-2 transition-colors"
                        style={{
                          backgroundColor: tileTone.bg,
                          borderColor: tileTone.border,
                        }}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span
                            className="text-xs font-bold font-mono tabular-nums"
                            style={{ color: tileTone.fg }}
                          >
                            {unit.label}
                          </span>
                          <span className="text-xs text-[var(--text-muted)]">
                            {unit.bed?.tier === 'Нижняя' ? 'Низ' : 'Верх'}
                          </span>
                        </div>

                        {unit.status === 'occupied' && booking && primaryGuest ? (
                          <button
                            type="button"
                            onClick={() => openBookingFolio(booking.id)}
                            className="text-left space-y-0.5 hover:underline"
                          >
                            <div
                              className="text-xs font-semibold truncate"
                              style={{ color: tileTone.fg }}
                            >
                              {primaryGuest.fullName}
                            </div>
                            <div className="text-xs font-mono tabular-nums text-[var(--text-secondary)]">
                              {hasUnregForeigner
                                ? 'Нет E-mehmon'
                                : fin && fin.debtUsd > 0
                                  ? `Долг $${fin.debtUsd}`
                                  : booking.checkingOutToday
                                    ? 'Выезд 12:00'
                                    : primaryGuest.citizenship}
                            </div>
                          </button>
                        ) : (
                          <div className="flex items-center justify-between gap-1">
                            <button
                              type="button"
                              onClick={() =>
                                unit.status === 'available'
                                  ? openCheckInModal({
                                      roomId: unit.roomId,
                                      bedId: unit.bedId,
                                      fromDate: todayIso,
                                    })
                                  : setRoomHousekeepingStatus(
                                      unit.roomId,
                                      'available',
                                      unit.bedId
                                    )
                              }
                              className="text-xs font-semibold hover:underline"
                              style={{
                                color:
                                  unit.status === 'available'
                                    ? 'var(--tone-cobalt-fg)'
                                    : tileTone.fg,
                              }}
                            >
                              {unit.status === 'available'
                                ? '+ Заселить'
                                : unit.status === 'dirty'
                                  ? 'Уборка → Чисто'
                                  : 'Ремонт → Чисто'}
                            </button>
                            {renderInlineHousekeepingBtn(unit)}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {/* 180ms Smart Hover Inspector Popover */}
      {hoverInspector && (() => {
        const { booking, segment, roomLabel, x, y } = hoverInspector;
        const guest = booking.guests[0];
        const fin = calcBookingTotals(booking);
        const unregForeigners = booking.guests.filter((g) => g.isForeigner && !g.emehmonRegistered);
        return (
          <div
            role="tooltip"
            data-testid="tape-hover-inspector"
            onMouseEnter={keepInspectorOpen}
            onMouseLeave={scheduleHideInspector}
            style={{ left: `${x}px`, top: `${y}px`, boxShadow: 'var(--shadow-popover)' }}
            className="fixed z-40 w-[292px] rounded-xl bg-[var(--bg-surface)] border border-[var(--border-strong)] p-3.5 space-y-2.5 no-print"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-sm font-bold text-[var(--text-primary)] truncate">
                  {guest?.fullName ?? 'Гость'}
                </div>
                <div className="text-xs text-[var(--text-muted)] font-mono tabular-nums">
                  {roomLabel} · {guest?.citizenship ?? '—'} · {booking.bnovoId}
                </div>
              </div>
              <StatusPill tone={fin.debtUsd > 0 ? 'rose' : 'emerald'} mono>
                {fin.debtUsd > 0 ? `−${formatUsd(fin.debtUsd)}` : 'Оплачено'}
              </StatusPill>
            </div>

            <div className="flex items-center justify-between text-xs py-1.5 border-y border-[var(--border-subtle)] font-mono tabular-nums">
              <span className="text-[var(--text-secondary)]">
                {segment.fromDate.slice(5)} → {segment.toDate.slice(5)} ({segment.nights} н.)
              </span>
              <span
                className="font-sans font-semibold"
                style={{
                  color:
                    unregForeigners.length > 0
                      ? 'var(--tone-rose-fg)'
                      : 'var(--tone-emerald-fg)',
                }}
              >
                {unregForeigners.length > 0 ? 'E-mehmon (72ч!)' : 'E-mehmon ОК'}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setHoverInspector(null);
                  openBookingFolio(booking.id);
                }}
                className="h-8 px-2 rounded-lg bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-xs font-semibold text-[var(--text-primary)] inline-flex items-center justify-center gap-1 transition-colors"
              >
                <FileText className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />
                Фолио
              </button>
              <button
                type="button"
                onClick={() => {
                  setHoverInspector(null);
                  openBookingFolio(booking.id, { openPayment: true });
                }}
                className="h-8 px-2 rounded-lg bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-xs font-semibold text-[var(--text-primary)] inline-flex items-center justify-center gap-1 transition-colors"
              >
                <CreditCard className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />
                Оплата
              </button>
              <button
                type="button"
                onClick={() => {
                  setHoverInspector(null);
                  openWelcomeCardModal(booking.id);
                }}
                className="ops-brand-btn h-8 px-2 rounded-lg text-xs font-semibold inline-flex items-center justify-center gap-1"
              >
                Welcome
              </button>
            </div>
          </div>
        );
      })()}
    </div>
  );
};
