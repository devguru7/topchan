import React, { useEffect, useMemo } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import {
  AlertCircle,
  ArrowRight,
  Banknote,
  BedDouble,
  Bot,
  CheckCircle2,
  Chrome,
  Clock,
  Command,
  Moon,
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
    <span className="inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)] whitespace-nowrap shrink-0">
      <span className="hidden sm:inline">Ташкент (UZT)</span>
      <span
        className="font-mono tabular-nums font-semibold"
        style={{ color: 'var(--tone-emerald-fg)' }}
      >
        {clockStr}
      </span>
      <span className="sr-only">{todayRu}</span>
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
  { id: 'grid', shortcut: '1', label: 'Шахматка', shortLabel: 'Шахматка', icon: BedDouble },
  { id: 'shift', shortcut: '2', label: 'Смена и Автопилот', shortLabel: 'Смена', icon: Clock },
  { id: 'cash', shortcut: '3', label: 'Касса', shortLabel: 'Касса', icon: Banknote },
  { id: 'services', shortcut: '4', label: 'Сервисы и QR', shortLabel: 'Сервисы', icon: WashingMachine },
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

      // Ignore single-key shortcuts while typing or while any modal/palette is open
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

  // Compute #1 Operational Focus Priority ("Фокус смены")
  const shiftFocus = useMemo(() => {
    const activeBookings = state.bookings.filter((b) => b.status === 'active');

    const unregisteredForeignersCount = activeBookings.reduce(
      (sum, b) => sum + b.guests.filter((g) => g.isForeigner && !g.emehmonRegistered).length,
      0
    );

    const checkoutWithDebtCount = activeBookings.filter(
      (b) => b.checkingOutToday && calcBookingTotals(b).debtUsd > 0
    ).length;

    const checkoutDebtTotal = activeBookings
      .filter((b) => b.checkingOutToday)
      .reduce((sum, b) => sum + calcBookingTotals(b).debtUsd, 0);

    if (unregisteredForeignersCount > 0 || checkoutWithDebtCount > 0) {
      const parts: string[] = [];
      if (checkoutWithDebtCount > 0) {
        parts.push(`Выезд 12:00 с долгом $${checkoutDebtTotal}`);
      }
      if (unregisteredForeignersCount > 0) {
        parts.push(`Не оформлен E-mehmon: ${unregisteredForeignersCount} иностр.`);
      }
      return {
        tone: 'rose' as const,
        label: 'Срочный приоритет',
        message: parts.join(' · '),
        ctaLabel: 'Открыть выезды',
        onAction: () => {
          setActiveTab('grid');
          setGridFilter(checkoutWithDebtCount > 0 ? 'checkout' : 'occupied');
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
        label: 'Требует внимания',
        message: parts.join(' · '),
        ctaLabel: 'Проверить сейчас',
        onAction: () => {
          setServicesSubTab('laundry_hk');
          setActiveTab('services');
        },
      };
    }

    return {
      tone: 'emerald' as const,
      label: 'Фокус смены',
      message: 'Смена под контролем · Долгов и срочных задач нет',
      ctaLabel: null,
      onAction: null,
    };
  }, [
    state.bookings,
    state.housekeepingTasks,
    state.laundryJobs,
    setActiveTab,
    setGridFilter,
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
        label: 'Синхронизировано',
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
      {/* Desktop Left Navigation Rail (>= 1024px) */}
      <aside
        aria-label="Основная навигация"
        className="hidden lg:flex lg:flex-col lg:w-60 lg:shrink-0 bg-[var(--bg-surface)] border-r border-[var(--border-subtle)] h-screen sticky top-0 no-print"
      >
        <div className="px-5 h-16 border-b border-[var(--border-subtle)] flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-base font-bold tracking-tight text-[var(--text-primary)] truncate">
              Topchan Ops
            </div>
            <div className="text-xs text-[var(--text-muted)] truncate">
              {state.integrations.propertyName}
            </div>
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            const counter =
              item.id === 'settings' && unreadAlertsCount > 0
                ? unreadAlertsCount
                : item.id === 'services' && activeLaundryCount > 0
                  ? activeLaundryCount
                  : 0;

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`relative w-full flex items-center justify-between gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'text-[var(--text-primary)]'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="desktopNavRailPill"
                    transition={{ type: 'spring', stiffness: 300, damping: 28 }}
                    className="absolute inset-0 bg-[var(--bg-elevated)] border border-[var(--border-strong)] rounded-xl"
                  />
                )}
                <span className="relative z-10 flex items-center gap-2.5 min-w-0">
                  <Icon className="w-4 h-4 shrink-0" strokeWidth={1.75} />
                  <span className="truncate">{item.label}</span>
                </span>
                <span className="relative z-10 flex items-center gap-1.5 shrink-0">
                  {counter > 0 && (
                    <span
                      className="font-mono tabular-nums text-xs font-bold px-1.5 py-0.5 rounded-full leading-none"
                      style={{
                        backgroundColor: 'var(--tone-cobalt-bg)',
                        color: 'var(--tone-cobalt-fg)',
                      }}
                    >
                      {counter}
                    </span>
                  )}
                  <kbd className="hidden xl:inline-flex items-center justify-center w-5 h-5 rounded-md text-xs font-mono text-[var(--text-muted)] bg-[var(--bg-canvas)] border border-[var(--border-subtle)]">
                    {item.shortcut}
                  </kbd>
                </span>
              </button>
            );
          })}
        </nav>

        {/* Quiet shift & keyboard cheatsheet footer */}
        <div className="p-4 border-t border-[var(--border-subtle)] space-y-2.5 text-xs">
          <div className="flex items-center justify-between text-[var(--text-muted)]">
            <span>Смена</span>
            <span className="font-medium text-[var(--text-secondary)] truncate max-w-[140px]">
              {state.adminName}
            </span>
          </div>
          <div className="flex items-center justify-between text-[var(--text-muted)]">
            <span>Быстрый заезд</span>
            <kbd className="px-1.5 py-0.5 rounded-md font-mono text-xs bg-[var(--bg-canvas)] border border-[var(--border-subtle)] text-[var(--text-secondary)]">
              N
            </kbd>
          </div>
        </div>
      </aside>

      {/* Main Column: Calm Top Header + Focus Strip + Workspace */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Single-Row Calm Header */}
        <header className="sticky top-0 z-30 h-16 bg-[var(--bg-surface)]/95 backdrop-blur-md border-b border-[var(--border-subtle)] px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-3 no-print">
          {/* Left: Brand (on mobile) + Live Tashkent Clock */}
          <div className="flex items-center gap-3 min-w-0">
            <span className="lg:hidden text-base font-bold tracking-tight text-[var(--text-primary)] whitespace-nowrap shrink-0">
              Topchan Ops
            </span>
            <TashkentClock />
          </div>

          {/* Right: Live CBU USD Pill, Cmd+K, Sync Status, Theme Toggle, Chrome Bridge */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                setSettingsSubTab('currency');
                setActiveTab('settings');
              }}
              title="Настроить курсы валют (Acc / Ex) и БРВ"
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-xs font-mono tabular-nums text-[var(--text-secondary)] transition-colors whitespace-nowrap"
            >
              <span className="text-[var(--text-muted)] font-sans">ЦБ USD</span>
              <span className="font-semibold text-[var(--text-primary)]">
                {state.currency.cbuUsd.toLocaleString('ru-RU')}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setCommandPaletteOpen(true)}
              aria-label="Открыть быстрый поиск и команды"
              className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors whitespace-nowrap min-h-[38px]"
            >
              <Search className="w-3.5 h-3.5 text-[var(--text-muted)]" strokeWidth={1.75} />
              <span className="hidden md:inline">Поиск и команды</span>
              <span className="hidden sm:inline-flex items-center gap-0.5 font-mono text-xs text-[var(--text-muted)]">
                <Command className="w-3 h-3" strokeWidth={1.75} />K
              </span>
            </button>

            {/* Real Storage / Sync Status Indicator */}
            <button
              type="button"
              onClick={() => {
                setSettingsSubTab('integrations');
                setActiveTab('settings');
              }}
              title={`Режим хранения: ${syncDisplay.label} · Версия синка #${state.revision}`}
              className="hidden md:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border border-[var(--border-subtle)] text-xs font-medium whitespace-nowrap transition-colors hover:border-[var(--border-strong)]"
              style={{ backgroundColor: syncDisplay.bg, color: syncDisplay.color }}
            >
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: syncDisplay.color }}
                aria-hidden="true"
              />
              <span>{syncDisplay.label}</span>
            </button>

            {/* Obsidian Dark / Crisp Daylight Theme Toggle */}
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={
                theme === 'dark' ? 'Включить дневную тему' : 'Включить ночную тему'
              }
              title={theme === 'dark' ? 'Дневная тема (Daylight)' : 'Ночная тема (Obsidian)'}
              className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors shrink-0"
            >
              {theme === 'dark' ? (
                <Sun className="w-4 h-4" strokeWidth={1.75} />
              ) : (
                <Moon className="w-4 h-4" strokeWidth={1.75} />
              )}
            </button>

            {/* Chrome Side Panel Bridge Toggle (Desktop) */}
            <button
              type="button"
              onClick={() => setSidePanelOpen((v) => !v)}
              aria-label="Открыть или скрыть мост Bnovo и E-mehmon"
              className="hidden lg:inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-semibold transition-colors whitespace-nowrap min-h-[38px]"
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
              <Chrome className="w-3.5 h-3.5" strokeWidth={1.75} />
              <span>Мост</span>
            </button>
          </div>
        </header>

        {/* Contextual "Фокус смены" Priority Strip */}
        <div
          className="border-b px-4 sm:px-6 lg:px-8 py-2.5 no-print"
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
          <div className="max-w-[1220px] mx-auto flex flex-wrap items-center justify-between gap-2 text-xs">
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
                className="font-semibold shrink-0"
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
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl font-semibold bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] border border-[var(--border-strong)] text-[var(--text-primary)] transition-colors whitespace-nowrap shrink-0"
              >
                <span>{shiftFocus.ctaLabel}</span>
                <ArrowRight className="w-3.5 h-3.5" strokeWidth={1.75} />
              </button>
            )}
          </div>
        </div>

        {/* Main Content Viewport */}
        <main className="flex-1 min-w-0 pb-24 lg:pb-10">
          <div className="max-w-[1220px] mx-auto px-4 sm:px-6 lg:px-8 py-5 sm:py-6">
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

      {/* Mobile Fixed 5-Tab Bottom Navigation Bar (< 1024px) with >= 44px tap targets & safe-area */}
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
                active ? 'text-[#3B82F6] font-semibold' : 'text-[var(--text-muted)]'
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
