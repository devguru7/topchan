import React, { useEffect, useMemo } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import {
  AlertCircle,
  ArrowRight,
  Banknote,
  BedDouble,
  Bot,
  CalendarRange,
  CheckCircle2,
  Chrome,
  Clock,
  Command,
  Moon,
  Plus,
  Search,
  Sparkles,
  Sun,
  WashingMachine,
} from 'lucide-react';
import { OpsProvider, useOps, useTimers } from './context/OpsContext';
import type { TabId } from './types/ops';
import { calcBookingTotals } from './utils/math';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ToastStack } from './components/ToastStack';
import { CommandPalette } from './components/CommandPalette';
import { ChromeSidePanel } from './components/ChromeSidePanel';
import { QrPosterModal } from './components/QrPosterModal';
import { GuestStandaloneView } from './components/GuestStandaloneView';
import { GuestFolioDrawer } from './components/modals/GuestFolioDrawer';
import { CheckInModal } from './components/modals/CheckInModal';
import { CheckOutModal } from './components/modals/CheckOutModal';
import { GridTab } from './components/tabs/GridTab';
import { ShiftTab } from './components/tabs/ShiftTab';
import { CashTab } from './components/tabs/CashTab';
import { ServicesTab } from './components/tabs/ServicesTab';
import { SettingsTab } from './components/tabs/SettingsTab';

/**
 * Isolated ticking Tashkent (UTC+5) clock subscribed solely to TimerContext
 * so 1-second clock ticks never re-render OpsWorkspace or any main tab.
 */
const TashkentClock: React.FC = () => {
  const { clockStr, todayRu } = useTimers();
  return (
    <span className="inline-flex items-center gap-2 text-xs text-[var(--text-secondary)] whitespace-nowrap shrink-0">
      <span className="hidden sm:inline font-medium text-[var(--text-muted)]">Ташкент</span>
      <span
        className="font-mono tabular-nums font-bold px-2 py-0.5 rounded-md border"
        style={{
          color: 'var(--tone-emerald-fg)',
          backgroundColor: 'var(--tone-emerald-bg)',
          borderColor: 'var(--tone-emerald-border)',
        }}
      >
        {clockStr}
      </span>
      <span className="hidden xl:inline text-[var(--text-muted)]">{todayRu}</span>
    </span>
  );
};

const NAV_ITEMS: Array<{
  id: TabId;
  shortcut: string;
  label: string;
  shortLabel: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
}> = [
  { id: 'grid', shortcut: '1', label: 'Шахматка', shortLabel: 'Шахматка', icon: CalendarRange },
  { id: 'shift', shortcut: '2', label: 'Смена и E-mehmon', shortLabel: 'Смена', icon: Clock },
  { id: 'cash', shortcut: '3', label: 'Касса и Сейф', shortLabel: 'Касса', icon: Banknote },
  { id: 'services', shortcut: '4', label: 'Сервисы и Уборка', shortLabel: 'Сервисы', icon: WashingMachine },
  { id: 'settings', shortcut: '5', label: 'Настройки и Бот', shortLabel: 'Настройки', icon: Bot },
];

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  return Boolean(target.closest('[contenteditable="true"]'));
}

const OpsWorkspace: React.FC = () => {
  const {
    state,
    storageKind,
    syncStatusInfo,
    theme,
    toggleTheme,
    activeTab,
    setActiveTab,
    setGridFilter,
    setShiftSubTab,
    setSettingsSubTab,
    setServicesSubTab,
    sidePanelOpen,
    setSidePanelOpen,
    commandPaletteOpen,
    setCommandPaletteOpen,
    selectedBookingId,
    setSelectedBookingId,
    checkInPreselect,
    openCheckInModal,
    closeCheckInModal,
    checkOutBookingId,
    closeCheckOutModal,
    qrPosterRoomId,
    closeQrPosterModal,
  } = useOps();

  // Desktop Keyboard Power Mode: Cmd/Ctrl+K, 1-5 tabs, N quick check-in, Esc close overlays
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandPaletteOpen((open) => !open);
        return;
      }

      if (e.key === 'Escape') {
        if (commandPaletteOpen) {
          setCommandPaletteOpen(false);
        } else if (checkOutBookingId) {
          closeCheckOutModal();
        } else if (checkInPreselect !== null) {
          closeCheckInModal();
        } else if (qrPosterRoomId) {
          closeQrPosterModal();
        } else if (selectedBookingId) {
          setSelectedBookingId(null);
        } else if (sidePanelOpen) {
          setSidePanelOpen(false);
        }
        return;
      }

      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      if (
        commandPaletteOpen ||
        checkInPreselect !== null ||
        checkOutBookingId !== null ||
        qrPosterRoomId !== null
      ) {
        return;
      }

      const key = e.key.toLowerCase();
      if (key === '1') setActiveTab('grid');
      else if (key === '2') setActiveTab('shift');
      else if (key === '3') setActiveTab('cash');
      else if (key === '4') setActiveTab('services');
      else if (key === '5') setActiveTab('settings');
      else if (key === 'n' || key === 'т') {
        e.preventDefault();
        openCheckInModal();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    commandPaletteOpen,
    checkInPreselect,
    checkOutBookingId,
    qrPosterRoomId,
    selectedBookingId,
    sidePanelOpen,
    setCommandPaletteOpen,
    closeCheckOutModal,
    closeCheckInModal,
    closeQrPosterModal,
    setSelectedBookingId,
    setSidePanelOpen,
    setActiveTab,
    openCheckInModal,
  ]);

  const unreadAlertsCount = state.telegramAlerts.filter((a) => !a.resolved).length;
  const activeLaundryCount = state.laundryJobs.filter((j) => j.status === 'running').length;
  const unregisteredForeignersCount = useMemo(
    () =>
      state.bookings
        .filter((b) => b.status === 'active')
        .reduce(
          (sum, b) => sum + b.guests.filter((g) => g.isForeigner && !g.emehmonRegistered).length,
          0
        ),
    [state.bookings]
  );

  // Inventory quick counter for sidebar footer (20 rooms / 20 dorm beds)
  const inventoryStats = useMemo(() => {
    const activeRooms = state.physicalRooms.filter((r) => !r.archived);
    const privateCount = activeRooms.filter((r) => !r.beds).length;
    const dormBedsCount = activeRooms.reduce((s, r) => s + (r.beds?.length ?? 0), 0);
    return { totalRooms: activeRooms.length, privateCount, dormBedsCount };
  }, [state.physicalRooms]);

  // Compute #1 Operational Focus Priority ("Фокус смены")
  const shiftFocus = useMemo(() => {
    const activeBookings = state.bookings.filter((b) => b.status === 'active');

    const checkoutWithDebtCount = activeBookings.filter(
      (b) => b.checkingOutToday && calcBookingTotals(b).debtUsd > 0
    ).length;

    const checkoutDebtTotal = activeBookings
      .filter((b) => b.checkingOutToday)
      .reduce((sum, b) => sum + calcBookingTotals(b).debtUsd, 0);

    if (unregisteredForeignersCount > 0 || checkoutWithDebtCount > 0) {
      const parts: string[] = [];
      if (checkoutWithDebtCount > 0) {
        parts.push(`Выезд сегодня 12:00 с долгом $${checkoutDebtTotal}`);
      }
      if (unregisteredForeignersCount > 0) {
        parts.push(`Нужна рег. E-mehmon: ${unregisteredForeignersCount} иностр.`);
      }
      return {
        tone: 'rose' as const,
        label: 'Фокус смены',
        message: parts.join(' · '),
        ctaLabel: unregisteredForeignersCount > 0 ? 'Открыть реестр E-mehmon' : 'Открыть выезды',
        onAction: () => {
          if (unregisteredForeignersCount > 0) {
            setShiftSubTab('emehmon');
            setActiveTab('shift');
          } else {
            setActiveTab('grid');
            setGridFilter('checkout');
          }
        },
      };
    }

    const dirtyRoomsCount = state.housekeepingTasks.filter((t) => t.status !== 'approved').length;
    const completedLaundryCount = state.laundryJobs.filter((j) => j.status === 'completed').length;

    if (dirtyRoomsCount > 0 || completedLaundryCount > 0) {
      const parts: string[] = [];
      if (dirtyRoomsCount > 0) {
        parts.push(`Комнат на уборке до 14:00: ${dirtyRoomsCount}`);
      }
      if (completedLaundryCount > 0) {
        parts.push(`Готовая стирка ждёт выдачи: ${completedLaundryCount}`);
      }
      return {
        tone: 'amber' as const,
        label: 'Фокус смены',
        message: parts.join(' · '),
        ctaLabel: 'Открыть уборку',
        onAction: () => {
          setServicesSubTab('laundry_hk');
          setActiveTab('services');
        },
      };
    }

    return {
      tone: 'emerald' as const,
      label: 'Фокус смены',
      message: 'Смена под контролем · Все иностранцы в E-mehmon, долгов по выездам нет',
      ctaLabel: null,
      onAction: null,
    };
  }, [
    state.bookings,
    state.housekeepingTasks,
    state.laundryJobs,
    unregisteredForeignersCount,
    setActiveTab,
    setGridFilter,
    setShiftSubTab,
    setServicesSubTab,
  ]);

  // Sync status visual label
  const syncDisplay = useMemo(() => {
    if (syncStatusInfo.status === 'conflict') {
      return { label: 'Конфликт', color: 'var(--tone-rose-fg)', bg: 'var(--tone-rose-bg)' };
    }
    if (syncStatusInfo.status === 'syncing') {
      return { label: 'Синхр...', color: 'var(--tone-amber-fg)', bg: 'var(--tone-amber-bg)' };
    }
    if (storageKind === 'supabase' && syncStatusInfo.status === 'synced') {
      return {
        label: 'Облако',
        color: 'var(--tone-emerald-fg)',
        bg: 'var(--tone-emerald-bg)',
      };
    }
    return {
      label: 'Локально',
      color: 'var(--tone-emerald-fg)',
      bg: 'var(--bg-elevated)',
    };
  }, [storageKind, syncStatusInfo.status]);

  return (
    <div className="min-h-screen bg-[var(--bg-canvas)] text-[var(--text-primary)] flex flex-col lg:flex-row">
      {/* Desktop Deep Hospitality Navy Sidebar (248px, >= 1024px) */}
      <aside
        aria-label="Основная навигация"
        className="hidden lg:flex lg:flex-col lg:w-[248px] lg:shrink-0 h-screen sticky top-0 no-print border-r"
        style={{
          backgroundColor: 'var(--sidebar-bg)',
          borderColor: 'var(--sidebar-border)',
          color: 'var(--sidebar-text)',
        }}
      >
        {/* Property Brand Header */}
        <div
          className="px-4 h-16 border-b flex items-center gap-3"
          style={{ borderColor: 'var(--sidebar-border)' }}
        >
          <div className="w-9 h-9 rounded-xl bg-[#2563EB] flex items-center justify-center text-white shrink-0 shadow-sm">
            <BedDouble className="w-4 h-4" strokeWidth={1.75} />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-bold tracking-tight text-white truncate">
              Topchan Ops
            </div>
            <div className="text-xs truncate" style={{ color: 'var(--sidebar-muted)' }}>
              {inventoryStats.totalRooms} комнат · {inventoryStats.dormBedsCount} коек
            </div>
          </div>
        </div>

        {/* Navigation Items */}
        <nav className="flex-1 p-3 space-y-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            const badgeCount =
              item.id === 'shift' && unregisteredForeignersCount > 0
                ? unregisteredForeignersCount
                : item.id === 'settings' && unreadAlertsCount > 0
                  ? unreadAlertsCount
                  : item.id === 'services' && activeLaundryCount > 0
                    ? activeLaundryCount
                    : 0;
            const isDangerBadge = item.id === 'shift' && unregisteredForeignersCount > 0;

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className="relative w-full flex items-center justify-between gap-2 px-2.5 py-2.5 rounded-xl text-[13px] font-medium transition-colors whitespace-nowrap"
                style={
                  active
                    ? {
                        backgroundColor: 'var(--sidebar-active-bg)',
                        color: 'var(--sidebar-active-text)',
                        boxShadow: 'inset 3px 0 0 var(--sidebar-active-border)',
                      }
                    : {
                        color: 'var(--sidebar-text)',
                      }
                }
                onMouseEnter={(e) => {
                  if (!active) {
                    e.currentTarget.style.backgroundColor = 'var(--sidebar-hover)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!active) {
                    e.currentTarget.style.backgroundColor = 'transparent';
                  }
                }}
              >
                <span className="flex items-center gap-2.5 min-w-0">
                  <Icon className="w-4 h-4 shrink-0" strokeWidth={1.75} />
                  <span className="truncate">{item.label}</span>
                </span>
                <span className="flex items-center gap-1 shrink-0">
                  {badgeCount > 0 ? (
                    <span
                      className={`font-mono tabular-nums text-xs font-bold px-1.5 py-0.5 rounded-md leading-none ${
                        isDangerBadge
                          ? 'bg-[#DC2626] text-white'
                          : 'bg-[#2563EB] text-white'
                      }`}
                    >
                      {badgeCount}
                    </span>
                  ) : (
                    <kbd
                      className="hidden xl:inline-flex items-center justify-center w-5 h-5 rounded text-xs font-mono"
                      style={{
                        backgroundColor: 'rgba(255,255,255,0.07)',
                        color: 'var(--sidebar-muted)',
                      }}
                    >
                      {item.shortcut}
                    </kbd>
                  )}
                </span>
              </button>
            );
          })}
        </nav>

        {/* Sidebar Footer: Shift Admin + 1-Click Night Shift Toggle */}
        <div
          className="p-3.5 border-t space-y-3"
          style={{ borderColor: 'var(--sidebar-border)' }}
        >
          <div className="px-1 space-y-1 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span style={{ color: 'var(--sidebar-muted)' }}>Дежурный</span>
              <span className="font-semibold text-white truncate max-w-[135px]">
                {state.adminName}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span style={{ color: 'var(--sidebar-muted)' }}>Быстрый заезд</span>
              <kbd
                className="px-1.5 py-0.5 rounded font-mono text-xs text-white"
                style={{ backgroundColor: 'rgba(255,255,255,0.1)' }}
              >
                N
              </kbd>
            </div>
          </div>

          <button
            type="button"
            onClick={toggleTheme}
            data-testid="sidebar-theme-toggle"
            aria-label={
              theme === 'dark' ? 'Переключить на дневной режим' : 'Включить ночную смену (тёмный режим)'
            }
            className="w-full h-10 px-3 rounded-xl flex items-center justify-between gap-2 text-xs font-semibold transition-colors border"
            style={{
              backgroundColor: 'var(--sidebar-surface)',
              borderColor: 'var(--sidebar-border)',
              color: '#FFFFFF',
            }}
          >
            <span className="inline-flex items-center gap-2 truncate">
              {theme === 'dark' ? (
                <Sun className="w-4 h-4 text-[#FBBF24] shrink-0" strokeWidth={1.75} />
              ) : (
                <Moon className="w-4 h-4 text-[#93C5FD] shrink-0" strokeWidth={1.75} />
              )}
              <span className="truncate">
                {theme === 'dark' ? 'Дневной режим' : 'Ночная смена'}
              </span>
            </span>
            <span
              className="text-xs font-mono px-1.5 py-0.5 rounded"
              style={{
                backgroundColor: theme === 'dark' ? 'rgba(251,191,36,0.18)' : 'rgba(59,130,246,0.22)',
                color: theme === 'dark' ? '#FDE68A' : '#BFDBFE',
              }}
            >
              {theme === 'dark' ? 'Ночь' : 'День'}
            </span>
          </button>
        </div>
      </aside>

      {/* Main Column: Clean PMS Header + Focus Strip + Workspace */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Single-Row PMS Top Bar (Uniform h-10 controls, Single Primary CTA) */}
        <header className="sticky top-0 z-30 h-16 bg-[var(--bg-surface)]/95 backdrop-blur-md border-b border-[var(--border-subtle)] px-4 sm:px-6 flex items-center justify-between gap-3 no-print">
          {/* Left: Brand (on mobile) + Live Tashkent Clock + CBU Rate */}
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <span className="lg:hidden text-sm font-bold tracking-tight text-[var(--text-primary)] whitespace-nowrap shrink-0">
              Topchan Ops
            </span>
            <TashkentClock />
            <button
              type="button"
              onClick={() => {
                setSettingsSubTab('currency');
                setActiveTab('settings');
              }}
              title="Курс ЦБ РУз и настройки расчётных курсов"
              className="hidden md:inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-xs font-mono tabular-nums text-[var(--text-secondary)] transition-colors whitespace-nowrap"
            >
              <span className="text-[var(--text-muted)] font-sans">ЦБ USD</span>
              <span className="font-bold text-[var(--text-primary)]">
                {state.currency.cbuUsd.toLocaleString('ru-RU')}
              </span>
            </button>
          </div>

          {/* Right: Search/Command (Cmd+K), Sync Status, Mobile Night Toggle, Bridge, ONE Primary CTA */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setCommandPaletteOpen(true)}
              aria-label="Открыть быстрый поиск и команды"
              className="inline-flex items-center gap-2 h-10 px-3 rounded-lg bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors whitespace-nowrap"
            >
              <Search className="w-4 h-4 text-[var(--text-muted)]" strokeWidth={1.75} />
              <span className="hidden md:inline">Поиск и команда</span>
              <span className="hidden sm:inline-flex items-center gap-0.5 font-mono text-xs text-[var(--text-muted)]">
                <Command className="w-3 h-3" strokeWidth={1.75} />K
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                setSettingsSubTab('integrations');
                setActiveTab('settings');
              }}
              title={`Хранилище: ${syncDisplay.label} · Версия #${state.revision ?? 1}`}
              className="hidden xl:inline-flex items-center gap-1.5 h-10 px-3 rounded-lg border border-[var(--border-subtle)] text-xs font-medium whitespace-nowrap transition-colors hover:border-[var(--border-strong)]"
              style={{ backgroundColor: syncDisplay.bg, color: syncDisplay.color }}
            >
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: syncDisplay.color }}
                aria-hidden="true"
              />
              <span>{syncDisplay.label}</span>
            </button>

            {/* Mobile/Tablet Night Shift Toggle (desktop toggle lives in sidebar) */}
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={
                theme === 'dark' ? 'Включить дневной режим' : 'Включить ночную смену'
              }
              className="lg:hidden inline-flex items-center justify-center w-10 h-10 rounded-lg bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-[var(--text-secondary)] transition-colors shrink-0"
            >
              {theme === 'dark' ? (
                <Sun className="w-4 h-4" strokeWidth={1.75} />
              ) : (
                <Moon className="w-4 h-4" strokeWidth={1.75} />
              )}
            </button>

            {/* Bnovo / E-mehmon Side Panel Bridge Toggle */}
            <button
              type="button"
              onClick={() => setSidePanelOpen((v) => !v)}
              aria-label="Открыть или скрыть мост Bnovo и E-mehmon"
              className="hidden lg:inline-flex items-center gap-1.5 h-10 px-3 rounded-lg border text-xs font-semibold transition-colors whitespace-nowrap"
              style={
                sidePanelOpen
                  ? {
                      backgroundColor: 'var(--tone-cobalt-bg)',
                      borderColor: 'var(--tone-cobalt-border)',
                      color: 'var(--tone-cobalt-fg)',
                    }
                  : {
                      backgroundColor: 'var(--bg-elevated)',
                      borderColor: 'var(--border-subtle)',
                      color: 'var(--text-secondary)',
                    }
              }
            >
              <Chrome className="w-4 h-4" strokeWidth={1.75} />
              <span>Мост</span>
            </button>

            {/* Single Primary Workspace CTA */}
            <button
              type="button"
              onClick={() => openCheckInModal()}
              className="inline-flex items-center gap-1.5 h-10 px-3.5 sm:px-4 rounded-lg bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-xs sm:text-sm font-semibold transition-colors shadow-sm whitespace-nowrap shrink-0"
            >
              <Plus className="w-4 h-4 shrink-0" strokeWidth={2} />
              <span className="hidden sm:inline">Новое заселение</span>
              <span className="sm:hidden">Заезд</span>
            </button>
          </div>
        </header>

        {/* Slim 1-Line Contextual "Фокус смены" Alert Strip */}
        <div
          className="border-b px-4 sm:px-6 py-2 no-print"
          style={{
            backgroundColor:
              shiftFocus.tone === 'rose'
                ? 'var(--tone-rose-bg)'
                : shiftFocus.tone === 'amber'
                  ? 'var(--tone-amber-bg)'
                  : 'var(--tone-emerald-bg)',
            borderColor:
              shiftFocus.tone === 'rose'
                ? 'var(--tone-rose-border)'
                : shiftFocus.tone === 'amber'
                  ? 'var(--tone-amber-border)'
                  : 'var(--tone-emerald-border)',
          }}
        >
          <div className="max-w-[1440px] mx-auto flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2 min-w-0">
              {shiftFocus.tone === 'rose' ? (
                <AlertCircle
                  className="w-4 h-4 shrink-0"
                  strokeWidth={1.75}
                  style={{ color: 'var(--tone-rose-fg)' }}
                />
              ) : shiftFocus.tone === 'amber' ? (
                <Sparkles
                  className="w-4 h-4 shrink-0"
                  strokeWidth={1.75}
                  style={{ color: 'var(--tone-amber-fg)' }}
                />
              ) : (
                <CheckCircle2
                  className="w-4 h-4 shrink-0"
                  strokeWidth={1.75}
                  style={{ color: 'var(--tone-emerald-fg)' }}
                />
              )}
              <span
                className="font-bold shrink-0"
                style={{
                  color:
                    shiftFocus.tone === 'rose'
                      ? 'var(--tone-rose-fg)'
                      : shiftFocus.tone === 'amber'
                        ? 'var(--tone-amber-fg)'
                        : 'var(--tone-emerald-fg)',
                }}
              >
                {shiftFocus.label}:
              </span>
              <span className="text-[var(--text-primary)] font-medium truncate">
                {shiftFocus.message}
              </span>
            </div>

            {shiftFocus.ctaLabel && shiftFocus.onAction && (
              <button
                type="button"
                onClick={shiftFocus.onAction}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg font-semibold bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] border border-[var(--border-strong)] text-[var(--text-primary)] transition-colors whitespace-nowrap shrink-0"
              >
                <span>{shiftFocus.ctaLabel}</span>
                <ArrowRight className="w-3.5 h-3.5" strokeWidth={1.75} />
              </button>
            )}
          </div>
        </div>

        {/* Main Content Viewport */}
        <main className="flex-1 min-w-0 pb-24 lg:pb-8">
          <div className="max-w-[1440px] mx-auto px-4 sm:px-6 py-4 sm:py-5">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.14 }}
            >
              {activeTab === 'grid' && <GridTab />}
              {activeTab === 'shift' && <ShiftTab />}
              {activeTab === 'cash' && <CashTab />}
              {activeTab === 'services' && <ServicesTab />}
              {activeTab === 'settings' && <SettingsTab />}
            </motion.div>
          </div>
        </main>
      </div>

      {/* Desktop Right-Side Chrome Side Panel Dock */}
      <AnimatePresence>
        {sidePanelOpen && (
          <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 344, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 28 }}
            className="hidden lg:block shrink-0 h-screen sticky top-0 overflow-hidden no-print"
          >
            <div className="w-[344px] h-full">
              <ChromeSidePanel onClose={() => setSidePanelOpen(false)} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Mobile Modal Drawer for Chrome Side Panel */}
      <AnimatePresence>
        {sidePanelOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="lg:hidden fixed inset-0 z-40 flex justify-end no-print"
            style={{ backgroundColor: 'var(--backdrop-scrim)' }}
            onClick={() => setSidePanelOpen(false)}
          >
            <div
              className="w-[88vw] max-w-sm h-full"
              onClick={(e) => e.stopPropagation()}
            >
              <ChromeSidePanel onClose={() => setSidePanelOpen(false)} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Mobile Fixed 5-Tab Bottom Navigation Bar (< 1024px) with >= 44px tap targets */}
      <nav
        aria-label="Мобильная навигация"
        className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-[var(--bg-surface)]/95 backdrop-blur-md border-t border-[var(--border-subtle)] grid grid-cols-5 px-1 pt-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))] no-print"
      >
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveTab(item.id)}
              className={`relative flex flex-col items-center justify-center gap-0.5 min-h-[48px] rounded-xl text-xs font-medium transition-colors ${
                active ? 'text-[#2563EB] font-semibold' : 'text-[var(--text-muted)]'
              }`}
            >
              <Icon className="w-4 h-4" strokeWidth={1.75} />
              <span className="truncate max-w-full px-0.5">{item.shortLabel}</span>
            </button>
          );
        })}
      </nav>

      {/* Global Interactive Overlays */}
      <GuestFolioDrawer />
      <CheckInModal />
      <CheckOutModal />
      <QrPosterModal />
      <CommandPalette />
      <ToastStack />
    </div>
  );
};

export default function App() {
  const params =
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search)
      : new URLSearchParams();
  const isGuestMode = params.get('mode') === 'guest';
  const roomParam = params.get('room');

  return (
    <ErrorBoundary>
      <MotionConfig reducedMotion="user">
        <OpsProvider>
          {isGuestMode ? <GuestStandaloneView roomParam={roomParam} /> : <OpsWorkspace />}
        </OpsProvider>
      </MotionConfig>
    </ErrorBoundary>
  );
}
