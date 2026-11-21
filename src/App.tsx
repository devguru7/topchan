import React from 'react';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import {
  Banknote,
  BedDouble,
  Bot,
  Chrome,
  Clock,
  Command,
  Search,
  WashingMachine,
} from 'lucide-react';
import { OpsProvider, useOps, useTimers } from './context/OpsContext';
import type { TabId } from './types/ops';
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
const TashkentClock: React.FC<{ compact?: boolean }> = ({ compact }) => {
  const { clockStr, todayRu } = useTimers();
  if (compact) {
    return (
      <span className="font-mono tabular-nums text-xs text-[#10B981]">
        UZT {clockStr}
      </span>
    );
  }
  return (
    <div className="mt-2.5 pt-2.5 border-t border-white/[0.06] flex items-center justify-between text-xs">
      <span className="text-slate-400">Ташкент (UZT)</span>
      <span className="font-mono tabular-nums font-semibold text-[#10B981]">
        {clockStr}
      </span>
      <span className="sr-only">{todayRu}</span>
    </div>
  );
};

const NAV_ITEMS: Array<{
  id: TabId;
  label: string;
  shortLabel: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'grid', label: 'Шахматка', shortLabel: 'Шахматка', icon: BedDouble },
  { id: 'shift', label: 'Смена и Автопилот', shortLabel: 'Смена', icon: Clock },
  { id: 'cash', label: 'Касса (6 карманов)', shortLabel: 'Касса', icon: Banknote },
  { id: 'services', label: 'Сервисы и QR', shortLabel: 'Сервисы', icon: WashingMachine },
  { id: 'settings', label: 'Telegram и Настройки', shortLabel: 'Бот', icon: Bot },
];

const OpsWorkspace: React.FC = () => {
  const {
    state,
    activeTab,
    setActiveTab,
    sidePanelOpen,
    setSidePanelOpen,
    setCommandPaletteOpen,
  } = useOps();

  const unreadAlertsCount = state.telegramAlerts.filter((a) => !a.resolved).length;
  const activeLaundryCount = state.laundryJobs.filter((j) => j.status === 'running').length;

  return (
    <div className="min-h-screen bg-[#0B0F17] text-[#F1F5F9] flex flex-col lg:flex-row">
      {/* Desktop Left Navigation Rail (>= 1024px) */}
      <aside
        aria-label="Основная навигация"
        className="hidden lg:flex lg:flex-col lg:w-64 lg:shrink-0 bg-[#121826] border-r border-white/[0.08] h-screen sticky top-0"
      >
        <div className="px-5 py-4 border-b border-white/[0.08]">
          <div className="text-lg font-bold tracking-tight text-white">Topchan Ops</div>
          <div className="text-xs text-slate-400 mt-0.5">
            {state.integrations.propertyName}
          </div>
          <TashkentClock />
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
                className={`relative w-full flex items-center justify-between gap-2.5 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-colors whitespace-nowrap ${
                  active ? 'text-white' : 'text-slate-400 hover:text-slate-100 hover:bg-[#1A2234]/60'
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="activeNavPill"
                    transition={{ type: 'spring', stiffness: 300, damping: 28 }}
                    className="absolute inset-0 bg-[#1A2234] border border-white/[0.1] rounded-xl"
                  />
                )}
                <span className="relative z-10 flex items-center gap-2.5 min-w-0">
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </span>
                {counter > 0 && (
                  <span className="relative z-10 font-mono tabular-nums text-xs font-semibold text-[#3B82F6]">
                    {counter}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Live Currency & Quick Controls */}
        <div className="p-4 border-t border-white/[0.08] space-y-3">
          <div className="bg-[#0B0F17] border border-white/[0.08] rounded-xl p-3 space-y-1.5 text-xs">
            <div className="flex items-center justify-between text-slate-400">
              <span>ЦБ РУз ({state.currency.cbuStatus === 'live' ? 'Live' : 'Кэш'})</span>
              <span className="font-mono tabular-nums text-white font-semibold">
                {state.currency.cbuUsd.toLocaleString('ru-RU')}
              </span>
            </div>
            <div className="flex items-center justify-between text-slate-400 font-mono tabular-nums">
              <span>Acc {state.currency.accRate.toLocaleString('ru-RU')}</span>
              <span>Ex {state.currency.exRate.toLocaleString('ru-RU')}</span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setCommandPaletteOpen(true)}
            className="w-full px-3 py-2 rounded-xl bg-[#0B0F17] hover:bg-[#1A2234] border border-white/[0.08] text-xs text-slate-300 flex items-center justify-between transition-colors"
          >
            <span className="inline-flex items-center gap-2">
              <Search className="w-3.5 h-3.5 text-slate-400" />
              Команда / Поиск
            </span>
            <span className="font-mono text-slate-500 inline-flex items-center gap-0.5">
              <Command className="w-3 h-3" />K
            </span>
          </button>

          <button
            type="button"
            onClick={() => setSidePanelOpen((v) => !v)}
            className={`w-full px-3 py-2 rounded-xl border text-xs font-medium flex items-center justify-between transition-colors ${
              sidePanelOpen
                ? 'bg-[#3B82F6]/15 border-[#3B82F6]/40 text-[#3B82F6]'
                : 'bg-[#0B0F17] hover:bg-[#1A2234] border-white/[0.08] text-slate-300'
            }`}
          >
            <span className="inline-flex items-center gap-2">
              <Chrome className="w-3.5 h-3.5" />
              Мост Bnovo / E-mehmon
            </span>
            <span>{sidePanelOpen ? 'Вкл' : 'Выкл'}</span>
          </button>
        </div>
      </aside>

      {/* Mobile Sticky Top Status Bar (< 1024px) */}
      <header className="lg:hidden sticky top-0 z-30 bg-[#121826]/95 backdrop-blur-md border-b border-white/[0.08] px-4 py-2.5 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-white truncate">Topchan Ops</span>
            <TashkentClock compact />
          </div>
          <div className="text-xs font-mono tabular-nums text-slate-400 truncate">
            USD {state.currency.accRate.toLocaleString('ru-RU')} / Ex{' '}
            {state.currency.exRate.toLocaleString('ru-RU')}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            aria-label="Открыть быстрый поиск и команды"
            onClick={() => setCommandPaletteOpen(true)}
            className="px-3 py-1.5 rounded-lg bg-[#1A2234] text-xs font-medium text-slate-200 border border-white/[0.08] inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            <Search className="w-3.5 h-3.5" />
            Поиск
          </button>
        </div>
      </header>

      {/* Main Content Workspace */}
      <main className="flex-1 min-w-0 pb-20 lg:pb-8">
        <div className="max-w-[1220px] mx-auto px-4 sm:px-6 lg:px-8 py-5 sm:py-6">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.16 }}
            >
              {activeTab === 'grid' && <GridTab />}
              {activeTab === 'shift' && <ShiftTab />}
              {activeTab === 'cash' && <CashTab />}
              {activeTab === 'services' && <ServicesTab />}
              {activeTab === 'settings' && <SettingsTab />}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>

      {/* Desktop Right-Side Chrome Side Panel Dock */}
      <AnimatePresence>
        {sidePanelOpen && (
          <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 340, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 28 }}
            className="hidden lg:block shrink-0 h-screen sticky top-0 overflow-hidden"
          >
            <div className="w-[340px] h-full">
              <ChromeSidePanel onClose={() => setSidePanelOpen(false)} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Mobile Modal Drawer for Chrome Side Panel when toggled on small screens */}
      <AnimatePresence>
        {sidePanelOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="lg:hidden fixed inset-0 z-40 bg-black/70 flex justify-end"
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

      {/* Mobile Fixed 5-Tab Bottom Navigation Bar (< 1024px) */}
      <nav
        aria-label="Мобильная навигация"
        className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-[#121826]/95 backdrop-blur-md border-t border-white/[0.08] grid grid-cols-5 px-1 py-1.5"
      >
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveTab(item.id)}
              className={`relative flex flex-col items-center justify-center gap-0.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                active ? 'text-[#3B82F6]' : 'text-slate-400'
              }`}
            >
              <Icon className="w-4 h-4" />
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
