import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { AppUserRole, TabId, ToastItem } from '../types/ops';
import { makeId, type CheckInPreselect } from '../store/types';
import { getTashkentTodayIso } from '../utils/time';

export type UITheme = 'dark' | 'light';
export type GridViewMode = 'tape' | 'cards';
export type GridFilterId = 'all' | 'available' | 'occupied' | 'checkout' | 'debt' | 'dirty';
export type ShiftSubTab = 'autopilot' | 'emehmon';
export type SettingsSubTab = 'telegram' | 'currency' | 'rooms' | 'integrations' | 'audit';
export type ServicesSubTab = 'laundry_hk' | 'breakfast' | 'luggage_transfers' | 'stock_contacts' | 'qr_guide';

const THEME_STORAGE_KEY = 'topchan_ui_theme';

function readInitialTheme(): UITheme {
  if (typeof window === 'undefined') return 'light';
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    // ignore storage access issues
  }
  return 'light';
}

function readInitialGridViewMode(): GridViewMode {
  if (typeof window === 'undefined') return 'tape';
  return window.innerWidth < 1024 ? 'cards' : 'tape';
}

export interface UIContextValue {
  theme: UITheme;
  setTheme: (theme: UITheme) => void;
  toggleTheme: () => void;
  userRole: AppUserRole;
  setUserRole: (role: AppUserRole) => void;
  activeTab: TabId;
  setActiveTab: (tab: TabId) => void;
  gridViewMode: GridViewMode;
  setGridViewMode: (mode: GridViewMode) => void;
  tapeStartDate: string;
  setTapeStartDate: React.Dispatch<React.SetStateAction<string>>;
  tapeCategoryFilter: string;
  setTapeCategoryFilter: (cat: string) => void;
  gridFilter: GridFilterId;
  setGridFilter: (filter: GridFilterId) => void;
  shiftSubTab: ShiftSubTab;
  setShiftSubTab: (sub: ShiftSubTab) => void;
  settingsSubTab: SettingsSubTab;
  setSettingsSubTab: (sub: SettingsSubTab) => void;
  servicesSubTab: ServicesSubTab;
  setServicesSubTab: (sub: ServicesSubTab) => void;
  sidePanelOpen: boolean;
  setSidePanelOpen: React.Dispatch<React.SetStateAction<boolean>>;
  commandPaletteOpen: boolean;
  setCommandPaletteOpen: React.Dispatch<React.SetStateAction<boolean>>;
  selectedBookingId: string | null;
  setSelectedBookingId: (id: string | null) => void;
  folioAutoOpenPayment: boolean;
  openBookingFolio: (bookingId: string, options?: { openPayment?: boolean }) => void;
  clearFolioAutoOpenPayment: () => void;
  checkInPreselect: CheckInPreselect | null;
  openCheckInModal: (preselect?: CheckInPreselect) => void;
  closeCheckInModal: () => void;
  checkOutBookingId: string | null;
  openCheckOutModal: (bookingId: string) => void;
  closeCheckOutModal: () => void;
  qrPosterRoomId: string | null;
  openQrPosterModal: (roomId?: string) => void;
  closeQrPosterModal: () => void;
  nightAuditOpen: boolean;
  setNightAuditOpen: React.Dispatch<React.SetStateAction<boolean>>;
  welcomeCardBookingId: string | null;
  openWelcomeCardModal: (bookingId: string) => void;
  closeWelcomeCardModal: () => void;
  toasts: ToastItem[];
  pushToast: (
    title: string,
    description?: string,
    tone?: ToastItem['tone'],
    action?: { label: string; onClick: () => void }
  ) => void;
  dismissToast: (id: string) => void;
}

const UIContext = createContext<UIContextValue | null>(null);

export const UIProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setThemeState] = useState<UITheme>(() => readInitialTheme());
  const [userRole, setUserRole] = useState<AppUserRole>('admin');
  const [activeTab, setActiveTab] = useState<TabId>('grid');
  const [gridViewMode, setGridViewMode] = useState<GridViewMode>(() => readInitialGridViewMode());
  const [tapeStartDate, setTapeStartDate] = useState<string>(() => getTashkentTodayIso());
  const [tapeCategoryFilter, setTapeCategoryFilter] = useState<string>('all');
  const [gridFilter, setGridFilter] = useState<GridFilterId>('all');
  const [shiftSubTab, setShiftSubTab] = useState<ShiftSubTab>('autopilot');
  const [settingsSubTab, setSettingsSubTab] = useState<SettingsSubTab>('telegram');
  const [servicesSubTab, setServicesSubTab] = useState<ServicesSubTab>('laundry_hk');
  const [sidePanelOpen, setSidePanelOpen] = useState<boolean>(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState<boolean>(false);
  const [selectedBookingId, setSelectedBookingIdState] = useState<string | null>(null);
  const [folioAutoOpenPayment, setFolioAutoOpenPayment] = useState<boolean>(false);
  const [checkInPreselect, setCheckInPreselect] = useState<CheckInPreselect | null>(null);
  const [checkOutBookingId, setCheckOutBookingId] = useState<string | null>(null);
  const [qrPosterRoomId, setQrPosterRoomId] = useState<string | null>(null);
  const [nightAuditOpen, setNightAuditOpen] = useState<boolean>(false);
  const [welcomeCardBookingId, setWelcomeCardBookingId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.dataset.theme = theme;
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // ignore storage quota errors
    }
  }, [theme]);

  const setTheme = useCallback((next: UITheme) => {
    setThemeState(next);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  const setSelectedBookingId = useCallback((id: string | null) => {
    setSelectedBookingIdState(id);
    if (!id) setFolioAutoOpenPayment(false);
  }, []);

  const openBookingFolio = useCallback(
    (bookingId: string, options?: { openPayment?: boolean }) => {
      setFolioAutoOpenPayment(Boolean(options?.openPayment));
      setSelectedBookingIdState(bookingId);
    },
    []
  );

  const clearFolioAutoOpenPayment = useCallback(() => {
    setFolioAutoOpenPayment(false);
  }, []);

  const pushToast = useCallback(
    (
      title: string,
      description?: string,
      tone: ToastItem['tone'] = 'emerald',
      action?: { label: string; onClick: () => void }
    ) => {
      const id = makeId('toast');
      setToasts((prev) =>
        [
          {
            id,
            title,
            description,
            tone,
            actionLabel: action?.label,
            onAction: action?.onClick,
          },
          ...prev,
        ].slice(0, 4)
      );
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, action ? 7000 : 4200);
    },
    []
  );

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const openCheckInModal = useCallback((preselect?: CheckInPreselect) => {
    setCheckInPreselect(preselect ?? {});
  }, []);

  const closeCheckInModal = useCallback(() => {
    setCheckInPreselect(null);
  }, []);

  const openCheckOutModal = useCallback((bookingId: string) => {
    setCheckOutBookingId(bookingId);
  }, []);

  const closeCheckOutModal = useCallback(() => {
    setCheckOutBookingId(null);
  }, []);

  const openQrPosterModal = useCallback((roomId?: string) => {
    setQrPosterRoomId(roomId ?? 'ALL');
  }, []);

  const closeQrPosterModal = useCallback(() => {
    setQrPosterRoomId(null);
  }, []);

  const openWelcomeCardModal = useCallback((bookingId: string) => {
    setWelcomeCardBookingId(bookingId);
  }, []);

  const closeWelcomeCardModal = useCallback(() => {
    setWelcomeCardBookingId(null);
  }, []);

  const value = useMemo<UIContextValue>(
    () => ({
      theme,
      setTheme,
      toggleTheme,
      userRole,
      setUserRole,
      activeTab,
      setActiveTab,
      gridViewMode,
      setGridViewMode,
      tapeStartDate,
      setTapeStartDate,
      tapeCategoryFilter,
      setTapeCategoryFilter,
      gridFilter,
      setGridFilter,
      shiftSubTab,
      setShiftSubTab,
      settingsSubTab,
      setSettingsSubTab,
      servicesSubTab,
      setServicesSubTab,
      sidePanelOpen,
      setSidePanelOpen,
      commandPaletteOpen,
      setCommandPaletteOpen,
      selectedBookingId,
      setSelectedBookingId,
      folioAutoOpenPayment,
      openBookingFolio,
      clearFolioAutoOpenPayment,
      checkInPreselect,
      openCheckInModal,
      closeCheckInModal,
      checkOutBookingId,
      openCheckOutModal,
      closeCheckOutModal,
      qrPosterRoomId,
      openQrPosterModal,
      closeQrPosterModal,
      nightAuditOpen,
      setNightAuditOpen,
      welcomeCardBookingId,
      openWelcomeCardModal,
      closeWelcomeCardModal,
      toasts,
      pushToast,
      dismissToast,
    }),
    [
      theme,
      setTheme,
      toggleTheme,
      userRole,
      activeTab,
      gridViewMode,
      tapeStartDate,
      tapeCategoryFilter,
      gridFilter,
      shiftSubTab,
      settingsSubTab,
      servicesSubTab,
      sidePanelOpen,
      commandPaletteOpen,
      selectedBookingId,
      setSelectedBookingId,
      folioAutoOpenPayment,
      openBookingFolio,
      clearFolioAutoOpenPayment,
      checkInPreselect,
      openCheckInModal,
      closeCheckInModal,
      checkOutBookingId,
      openCheckOutModal,
      closeCheckOutModal,
      qrPosterRoomId,
      openQrPosterModal,
      closeQrPosterModal,
      nightAuditOpen,
      welcomeCardBookingId,
      openWelcomeCardModal,
      closeWelcomeCardModal,
      toasts,
      pushToast,
      dismissToast,
    ]
  );

  return <UIContext.Provider value={value}>{children}</UIContext.Provider>;
};

export function useUI(): UIContextValue {
  const ctx = useContext(UIContext);
  if (!ctx) throw new Error('useUI must be used inside UIProvider');
  return ctx;
}
