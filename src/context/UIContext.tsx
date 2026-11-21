import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { TabId, ToastItem } from '../types/ops';
import { makeId, type CheckInPreselect } from '../store/types';

export interface UIContextValue {
  activeTab: TabId;
  setActiveTab: (tab: TabId) => void;
  sidePanelOpen: boolean;
  setSidePanelOpen: React.Dispatch<React.SetStateAction<boolean>>;
  commandPaletteOpen: boolean;
  setCommandPaletteOpen: React.Dispatch<React.SetStateAction<boolean>>;
  selectedBookingId: string | null;
  setSelectedBookingId: (id: string | null) => void;
  checkInPreselect: CheckInPreselect | null;
  openCheckInModal: (preselect?: CheckInPreselect) => void;
  closeCheckInModal: () => void;
  checkOutBookingId: string | null;
  openCheckOutModal: (bookingId: string) => void;
  closeCheckOutModal: () => void;
  qrPosterRoomId: string | null;
  openQrPosterModal: (roomId?: string) => void;
  closeQrPosterModal: () => void;
  toasts: ToastItem[];
  pushToast: (title: string, description?: string, tone?: ToastItem['tone']) => void;
  dismissToast: (id: string) => void;
}

const UIContext = createContext<UIContextValue | null>(null);

export const UIProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [activeTab, setActiveTab] = useState<TabId>('grid');
  const [sidePanelOpen, setSidePanelOpen] = useState<boolean>(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState<boolean>(false);
  const [selectedBookingId, setSelectedBookingId] = useState<string | null>(null);
  const [checkInPreselect, setCheckInPreselect] = useState<CheckInPreselect | null>(null);
  const [checkOutBookingId, setCheckOutBookingId] = useState<string | null>(null);
  const [qrPosterRoomId, setQrPosterRoomId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const pushToast = useCallback(
    (title: string, description?: string, tone: ToastItem['tone'] = 'emerald') => {
      const id = makeId('toast');
      setToasts((prev) => [{ id, title, description, tone }, ...prev].slice(0, 4));
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 4200);
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

  const value = useMemo<UIContextValue>(
    () => ({
      activeTab,
      setActiveTab,
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
      openCheckOutModal,
      closeCheckOutModal,
      qrPosterRoomId,
      openQrPosterModal,
      closeQrPosterModal,
      toasts,
      pushToast,
      dismissToast,
    }),
    [
      activeTab,
      sidePanelOpen,
      commandPaletteOpen,
      selectedBookingId,
      checkInPreselect,
      openCheckInModal,
      closeCheckInModal,
      checkOutBookingId,
      openCheckOutModal,
      closeCheckOutModal,
      qrPosterRoomId,
      openQrPosterModal,
      closeQrPosterModal,
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
