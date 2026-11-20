import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type {
  AppState,
  BookingGroup,
  CashPocketId,
  CurrencyCode,
  CurrencySettings,
  IntegrationSettings,
  LedgerEntry,
  ParsedCommand,
  PhysicalRoom,
  StayGuest,
  TabId,
  ToastItem,
} from '../types/ops';
import {
  createSeedState,
  FALLBACK_CBU_EUR,
  FALLBACK_CBU_USD,
  SCHEMA_VERSION,
  STORAGE_KEY,
} from '../data/seed';
import {
  calcBookingTotals,
  calcDefaultAccRate,
  calcDefaultExRate,
  formatUsd,
  formatUzs,
  round2,
} from '../utils/math';

function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function todayIso(): string {
  return '2026-11-20';
}

function addDaysIso(baseIso: string, days: number): string {
  const d = new Date(`${baseIso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function nowTimeHm(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

function loadInitialState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createSeedState();
    const parsed = JSON.parse(raw) as AppState;
    if (
      !parsed ||
      parsed.schemaVersion !== SCHEMA_VERSION ||
      !Array.isArray(parsed.physicalRooms) ||
      !Array.isArray(parsed.pockets)
    ) {
      return createSeedState();
    }
    return parsed;
  } catch {
    return createSeedState();
  }
}

export interface CheckInPayload {
  roomId: string;
  bedId?: string;
  nights: number;
  nightlyRateUsd: number;
  guests: Array<Omit<StayGuest, 'id'>>;
  source: BookingGroup['source'];
  notes?: string;
  initialPayment?: {
    amountUsdEquivalent: number;
    originalCurrency: CurrencyCode;
    originalAmount: number;
    pocketId: CashPocketId;
  };
  changeUzsOut?: number;
}

export interface CheckOutPayload {
  bookingId: string;
  debtOverrideReason?: string;
  createLuggage?: {
    bagsCount: number;
    flightTime: string;
    notes: string;
  };
}

interface OpsContextValue {
  state: AppState;
  activeTab: TabId;
  setActiveTab: (tab: TabId) => void;
  sidePanelOpen: boolean;
  setSidePanelOpen: React.Dispatch<React.SetStateAction<boolean>>;
  commandPaletteOpen: boolean;
  setCommandPaletteOpen: React.Dispatch<React.SetStateAction<boolean>>;
  selectedBookingId: string | null;
  setSelectedBookingId: (id: string | null) => void;
  checkInPreselect: { roomId?: string; bedId?: string } | null;
  openCheckInModal: (preselect?: { roomId?: string; bedId?: string }) => void;
  closeCheckInModal: () => void;
  checkOutBookingId: string | null;
  openCheckOutModal: (bookingId: string) => void;
  closeCheckOutModal: () => void;
  toasts: ToastItem[];
  pushToast: (title: string, description?: string, tone?: ToastItem['tone']) => void;
  dismissToast: (id: string) => void;

  // Core domain actions
  checkIn: (payload: CheckInPayload) => void;
  checkOut: (payload: CheckOutPayload) => void;
  addLedgerCharge: (
    bookingId: string,
    category: LedgerEntry['category'],
    label: string,
    amountUsd: number,
    options?: { startLaundryMode?: 'fast' | 'medium' }
  ) => void;
  addPayment: (params: {
    bookingId: string;
    pocketId: CashPocketId;
    currency: CurrencyCode;
    originalAmount: number;
    usdEquivalent: number;
    changeUzsOut?: number;
    receiptVerified?: boolean;
  }) => void;
  extendOrMoveStay: (params: {
    bookingId: string;
    mode: 'extend' | 'move';
    extraNights: number;
    newRoomId?: string;
    newBedId?: string;
    nightlyRateUsd: number;
  }) => void;
  commitParsedCommand: (cmd: ParsedCommand) => void;
  toggleChecklistItem: (id: string) => void;
  startLaundryJob: (params: {
    bookingId?: string;
    guestName: string;
    roomLabel: string;
    mode: 'fast' | 'medium';
    chargeToFolio: boolean;
  }) => void;
  speedUpLaundry: (jobId: string, minusMinutes?: number) => void;
  maidMarkCleaned: (taskId: string) => void;
  adminApproveHousekeeping: (taskId: string) => void;
  addLuggageItem: (params: {
    guestName: string;
    bagsCount: number;
    flightTime: string;
    notes: string;
  }) => void;
  releaseLuggageItem: (id: string) => void;
  addTransferJob: (params: {
    guestName: string;
    roomLabel: string;
    direction: 'to_airport' | 'from_airport';
    pickupTime: string;
    flightNumber: string;
    priceUsd: number;
    driverName: string;
  }) => void;
  cycleTransferStatus: (id: string) => void;
  adjustStock: (id: string, delta: number) => void;
  addPettyCashExpense: (category: string, amountUzs: number, note: string) => void;
  recordCashCalculatorTransaction: (params: {
    pocketId: CashPocketId;
    currency: CurrencyCode;
    receivedAmount: number;
    changeUzs: number;
    changeUsd: number;
    label: string;
  }) => void;
  createSafeCollection: (amountUzs: number, amountUsd: number, amountEur: number) => void;
  confirmSafeCollection: (id: string) => void;
  submitGuestQrRequest: (params: {
    bookingId: string;
    serviceType: 'extend' | 'laundry_fast' | 'laundry_medium' | 'transfer' | 'late_breakfast';
    lang: string;
  }) => void;
  executeTelegramAction: (alertId: string, actionId: string) => void;
  addPhysicalRoom: (categoryId: string, customCode?: string) => void;
  archivePhysicalRoom: (roomId: string) => void;
  updateCategoryPrice: (categoryId: string, occupancy: number, priceUsd: number) => void;
  updateCurrencySettings: (patch: Partial<CurrencySettings>) => void;
  updateIntegrationSettings: (patch: Partial<IntegrationSettings>) => void;
  importBnovoDemoBooking: () => void;
  markGuestEmehmonRegistered: (bookingId: string, guestId: string) => void;
  resetDemoData: () => void;
}

const OpsContext = createContext<OpsContextValue | null>(null);

export const OpsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<AppState>(() => loadInitialState());
  const [activeTab, setActiveTab] = useState<TabId>('grid');
  const [sidePanelOpen, setSidePanelOpen] = useState<boolean>(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState<boolean>(false);
  const [selectedBookingId, setSelectedBookingId] = useState<string | null>(null);
  const [checkInPreselect, setCheckInPreselect] = useState<{ roomId?: string; bedId?: string } | null>(null);
  const [checkOutBookingId, setCheckOutBookingId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const pushToast = useCallback(
    (title: string, description?: string, tone: ToastItem['tone'] = 'emerald') => {
      const id = uid('toast');
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

  // Persist to localStorage on every state mutation
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Ignore quota errors in constrained environments
    }
  }, [state]);

  // Fetch live CBU rates on mount with graceful fallback
  useEffect(() => {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 4000);
    fetch('https://cbu.uz/ru/arkhiv-kursov-valyut/json/', { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('HTTP error'))))
      .then((rows: Array<{ Ccy: string; Rate: string; Date?: string }>) => {
        if (!Array.isArray(rows)) return;
        const usdRow = rows.find((r) => r.Ccy === 'USD');
        const eurRow = rows.find((r) => r.Ccy === 'EUR');
        const cbuUsd = usdRow ? parseFloat(usdRow.Rate) : FALLBACK_CBU_USD;
        const cbuEur = eurRow ? parseFloat(eurRow.Rate) : FALLBACK_CBU_EUR;
        if (Number.isFinite(cbuUsd) && cbuUsd > 5000) {
          setState((prev) => ({
            ...prev,
            currency: {
              ...prev.currency,
              cbuUsd,
              cbuEur: Number.isFinite(cbuEur) ? cbuEur : prev.currency.cbuEur,
              cbuStatus: 'live',
              cbuUpdatedAt: usdRow?.Date || prev.currency.cbuUpdatedAt,
              accRate: prev.currency.accManualOverride
                ? prev.currency.accRate
                : calcDefaultAccRate(cbuUsd),
              exRate: prev.currency.exManualOverride
                ? prev.currency.exRate
                : calcDefaultExRate(cbuUsd),
            },
          }));
        }
      })
      .catch(() => {
        // Silent graceful fallback to cached rates
      })
      .finally(() => {
        window.clearTimeout(timeoutId);
      });
    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, []);

  // Live 1-second timer for washing machines
  useEffect(() => {
    const hasRunning = state.laundryJobs.some((j) => j.status === 'running');
    if (!hasRunning) return;
    const interval = window.setInterval(() => {
      let completedJobs: Array<{ guestName: string; roomLabel: string }> = [];
      setState((prev) => {
        let changed = false;
        const nextLaundry = prev.laundryJobs.map((job) => {
          if (job.status !== 'running') return job;
          changed = true;
          const nextRemaining = Math.max(0, job.remainingSeconds - 1);
          if (nextRemaining === 0) {
            completedJobs.push({ guestName: job.guestName, roomLabel: job.roomLabel });
            return { ...job, remainingSeconds: 0, status: 'completed' as const };
          }
          return { ...job, remainingSeconds: nextRemaining };
        });
        if (!changed) return prev;
        const newAlerts = completedJobs.map((cj) => ({
          id: uid('tg'),
          propertyId: prev.propertyId,
          timestamp: nowTimeHm(),
          source: 'Laundry' as const,
          severity: 'success' as const,
          title: `Стирка завершена · ${cj.roomLabel}`,
          body: `Машинка закончила цикл для ${cj.guestName}. Можно выгрузить бельё и написать гостю.`,
          resolved: false,
          actions: [{ id: uid('act'), label: 'Бельё выдано', kind: 'dismiss' as const }],
        }));
        return {
          ...prev,
          laundryJobs: nextLaundry,
          telegramAlerts: newAlerts.length > 0 ? [...newAlerts, ...prev.telegramAlerts] : prev.telegramAlerts,
        };
      });
      if (completedJobs.length > 0) {
        for (const cj of completedJobs) {
          pushToast('Стирка завершена!', `${cj.roomLabel} · ${cj.guestName} — уведомление в Telegram`, 'emerald');
        }
      }
    }, 1000);
    return () => window.clearInterval(interval);
  }, [state.laundryJobs, pushToast]);

  const openCheckInModal = useCallback((preselect?: { roomId?: string; bedId?: string }) => {
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

  const checkIn = useCallback(
    (payload: CheckInPayload) => {
      const bookingId = uid('bkg');
      const nowIso = new Date().toISOString();
      const fromDate = todayIso();
      const toDate = addDaysIso(fromDate, payload.nights);

      setState((prev) => {
        const room = prev.physicalRooms.find((r) => r.id === payload.roomId);
        if (!room) return prev;
        const bed = room.beds?.find((b) => b.id === payload.bedId);
        const roomLabel = bed ? `${room.code} · Койка ${bed.label}` : room.code;
        const stayUsd = round2(payload.nights * payload.nightlyRateUsd);

        const ledgerEntries: LedgerEntry[] = [
          {
            id: uid('led'),
            timestamp: nowIso,
            type: 'charge',
            category: 'accommodation',
            label: `Проживание ${roomLabel} (${payload.nights} н. × $${payload.nightlyRateUsd})`,
            amountUsd: stayUsd,
            actor: prev.adminName,
          },
        ];

        const nextPockets = prev.pockets.map((p) => ({ ...p }));
        const nextTransactions = [...prev.transactions];

        if (payload.initialPayment && payload.initialPayment.originalAmount > 0) {
          const pay = payload.initialPayment;
          ledgerEntries.push({
            id: uid('led'),
            timestamp: nowIso,
            type: 'payment',
            category: 'payment',
            label: `Оплата при заезде (${pay.originalCurrency})`,
            amountUsd: round2(pay.amountUsdEquivalent),
            originalCurrency: pay.originalCurrency,
            originalAmount: pay.originalAmount,
            pocketId: pay.pocketId,
            actor: prev.adminName,
          });
          const pocket = nextPockets.find((p) => p.id === pay.pocketId);
          if (pocket) {
            pocket.balance = round2(pocket.balance + pay.originalAmount);
          }
          nextTransactions.unshift({
            id: uid('tx'),
            propertyId: prev.propertyId,
            timestamp: nowIso,
            pocketId: pay.pocketId,
            direction: 'in',
            currency: pay.originalCurrency,
            amount: pay.originalAmount,
            label: `${roomLabel} · ${payload.guests[0]?.fullName ?? 'Гость'}`,
            bookingId,
            receiptVerified: pay.pocketId === 'transfer',
            actor: prev.adminName,
          });
        }

        if (payload.changeUzsOut && payload.changeUzsOut > 0) {
          const uzsPocket = nextPockets.find((p) => p.id === 'cash_uzs');
          if (uzsPocket) {
            uzsPocket.balance = Math.round(uzsPocket.balance - payload.changeUzsOut);
          }
          nextTransactions.unshift({
            id: uid('tx'),
            propertyId: prev.propertyId,
            timestamp: nowIso,
            pocketId: 'cash_uzs',
            direction: 'out',
            currency: 'UZS',
            amount: payload.changeUzsOut,
            label: `Сдача сумами · ${roomLabel}`,
            bookingId,
            actor: prev.adminName,
          });
        }

        const newBooking: BookingGroup = {
          id: bookingId,
          propertyId: prev.propertyId,
          bnovoId: `BN-${Math.floor(49000 + Math.random() * 9000)}`,
          status: 'active',
          checkOutTime: '12:00',
          checkingOutToday: false,
          source: payload.source,
          notes: payload.notes,
          createdAt: nowIso,
          segments: [
            {
              id: uid('seg'),
              roomId: payload.roomId,
              bedId: payload.bedId,
              fromDate,
              toDate,
              nights: payload.nights,
              nightlyRateUsd: payload.nightlyRateUsd,
            },
          ],
          guests: payload.guests.map((g) => ({ ...g, id: uid('g') })),
          ledgerEntries,
        };

        const nextRooms = prev.physicalRooms.map((r) => {
          if (r.id !== payload.roomId) return r;
          if (r.beds && payload.bedId) {
            return {
              ...r,
              beds: r.beds.map((b) =>
                b.id === payload.bedId ? { ...b, status: 'occupied' as const } : b
              ),
            };
          }
          return { ...r, status: 'occupied' as const };
        });

        const nextProfiles = [...prev.guestProfiles];
        for (const guest of payload.guests) {
          if (!guest.passportNo) continue;
          const existingIdx = nextProfiles.findIndex((p) => p.passportNo === guest.passportNo);
          if (existingIdx >= 0) {
            nextProfiles[existingIdx] = {
              ...nextProfiles[existingIdx],
              visitsCount: nextProfiles[existingIdx].visitsCount + 1,
              lastVisitDate: fromDate,
            };
          } else {
            nextProfiles.unshift({
              id: uid('prof'),
              propertyId: prev.propertyId,
              fullName: guest.fullName,
              passportNo: guest.passportNo,
              citizenship: guest.citizenship,
              visitsCount: 1,
              tag: 'regular',
              notes: `Заезд в ${roomLabel}`,
              lastVisitDate: fromDate,
            });
          }
        }

        return {
          ...prev,
          physicalRooms: nextRooms,
          bookings: [newBooking, ...prev.bookings],
          guestProfiles: nextProfiles,
          pockets: nextPockets,
          transactions: nextTransactions,
          auditLog: [
            {
              id: uid('aud'),
              propertyId: prev.propertyId,
              timestamp: nowIso,
              actor: prev.adminName,
              action: 'Заселение (Check-in)',
              diff: `${roomLabel} · ${payload.guests[0]?.fullName ?? 'Гость'} (${payload.nights} н.)`,
              reason: `Источник: ${payload.source}`,
            },
            ...prev.auditLog,
          ],
        };
      });

      setCheckInPreselect(null);
      pushToast('Заселение оформлено', `${payload.guests[0]?.fullName ?? 'Гость'} успешно заселён`, 'emerald');
    },
    [pushToast]
  );

  const addLedgerCharge = useCallback(
    (
      bookingId: string,
      category: LedgerEntry['category'],
      label: string,
      amountUsd: number,
      options?: { startLaundryMode?: 'fast' | 'medium' }
    ) => {
      const nowIso = new Date().toISOString();
      setState((prev) => {
        const bkg = prev.bookings.find((b) => b.id === bookingId);
        if (!bkg) return prev;
        const lastSeg = bkg.segments[bkg.segments.length - 1];
        const room = prev.physicalRooms.find((r) => r.id === lastSeg?.roomId);
        const bed = room?.beds?.find((b) => b.id === lastSeg?.bedId);
        const roomLabel = room ? (bed ? `${room.code} ${bed.label}` : room.code) : 'Номер';

        const nextBookings = prev.bookings.map((b) =>
          b.id === bookingId
            ? {
                ...b,
                ledgerEntries: [
                  ...b.ledgerEntries,
                  {
                    id: uid('led'),
                    timestamp: nowIso,
                    type: 'charge' as const,
                    category,
                    label,
                    amountUsd: round2(amountUsd),
                    actor: prev.adminName,
                  },
                ],
              }
            : b
        );

        let nextLaundry = prev.laundryJobs;
        if (options?.startLaundryMode) {
          const secs = options.startLaundryMode === 'fast' ? 22 * 60 : 55 * 60;
          nextLaundry = [
            {
              id: uid('lnd'),
              propertyId: prev.propertyId,
              bookingId,
              guestName: bkg.guests[0]?.fullName ?? 'Гость',
              roomLabel,
              mode: options.startLaundryMode,
              priceUsd: amountUsd,
              totalSeconds: secs,
              remainingSeconds: secs,
              status: 'running',
              startedAt: nowIso,
            },
            ...prev.laundryJobs,
          ];
        }

        return {
          ...prev,
          bookings: nextBookings,
          laundryJobs: nextLaundry,
          auditLog: [
            {
              id: uid('aud'),
              propertyId: prev.propertyId,
              timestamp: nowIso,
              actor: prev.adminName,
              action: 'Доп. начисление',
              diff: `+${formatUsd(amountUsd)} (${label}) · ${roomLabel}`,
              reason: 'Добавлено из карточки гостя',
            },
            ...prev.auditLog,
          ],
        };
      });
      pushToast(
        'Начисление добавлено',
        options?.startLaundryMode
          ? `${label} (${formatUsd(amountUsd)}) + запущен таймер стирки`
          : `${label} (${formatUsd(amountUsd)})`,
        'cobalt'
      );
    },
    [pushToast]
  );

  const addPayment = useCallback(
    (params: {
      bookingId: string;
      pocketId: CashPocketId;
      currency: CurrencyCode;
      originalAmount: number;
      usdEquivalent: number;
      changeUzsOut?: number;
      receiptVerified?: boolean;
    }) => {
      const nowIso = new Date().toISOString();
      setState((prev) => {
        const bkg = prev.bookings.find((b) => b.id === params.bookingId);
        if (!bkg) return prev;
        const lastSeg = bkg.segments[bkg.segments.length - 1];
        const room = prev.physicalRooms.find((r) => r.id === lastSeg?.roomId);
        const roomLabel = room?.code ?? 'Номер';
        const pocketName = prev.pockets.find((p) => p.id === params.pocketId)?.name ?? params.pocketId;

        const nextBookings = prev.bookings.map((b) =>
          b.id === params.bookingId
            ? {
                ...b,
                ledgerEntries: [
                  ...b.ledgerEntries,
                  {
                    id: uid('led'),
                    timestamp: nowIso,
                    type: 'payment' as const,
                    category: 'payment' as const,
                    label: `Оплата: ${pocketName}`,
                    amountUsd: round2(params.usdEquivalent),
                    originalCurrency: params.currency,
                    originalAmount: params.originalAmount,
                    pocketId: params.pocketId,
                    actor: prev.adminName,
                  },
                ],
              }
            : b
        );

        const nextPockets = prev.pockets.map((p) => {
          if (p.id === params.pocketId) {
            return { ...p, balance: round2(p.balance + params.originalAmount) };
          }
          if (params.changeUzsOut && params.changeUzsOut > 0 && p.id === 'cash_uzs') {
            return { ...p, balance: Math.round(p.balance - params.changeUzsOut) };
          }
          return p;
        });

        const nextTransactions = [
          {
            id: uid('tx'),
            propertyId: prev.propertyId,
            timestamp: nowIso,
            pocketId: params.pocketId,
            direction: 'in' as const,
            currency: params.currency,
            amount: params.originalAmount,
            label: `${roomLabel} · ${bkg.guests[0]?.fullName ?? 'Гость'}`,
            bookingId: params.bookingId,
            receiptVerified: params.receiptVerified ?? params.pocketId === 'transfer',
            actor: prev.adminName,
          },
          ...prev.transactions,
        ];

        if (params.changeUzsOut && params.changeUzsOut > 0) {
          nextTransactions.unshift({
            id: uid('tx'),
            propertyId: prev.propertyId,
            timestamp: nowIso,
            pocketId: 'cash_uzs',
            direction: 'out',
            currency: 'UZS',
            amount: params.changeUzsOut,
            label: `Сдача сумами · ${roomLabel}`,
            bookingId: params.bookingId,
            actor: prev.adminName,
          });
        }

        return {
          ...prev,
          bookings: nextBookings,
          pockets: nextPockets,
          transactions: nextTransactions,
          auditLog: [
            {
              id: uid('aud'),
              propertyId: prev.propertyId,
              timestamp: nowIso,
              actor: prev.adminName,
              action: 'Оплата в фолио',
              diff: `+${formatUsd(params.usdEquivalent)} (${pocketName}) · ${roomLabel}`,
              reason: 'Оплата принята и проведена в кассу',
            },
            ...prev.auditLog,
          ],
        };
      });
      pushToast('Оплата проведена', `Зачислено ${formatUsd(params.usdEquivalent)} в кассу`, 'emerald');
    },
    [pushToast]
  );

  const extendOrMoveStay = useCallback(
    (params: {
      bookingId: string;
      mode: 'extend' | 'move';
      extraNights: number;
      newRoomId?: string;
      newBedId?: string;
      nightlyRateUsd: number;
    }) => {
      const nowIso = new Date().toISOString();
      setState((prev) => {
        const bkg = prev.bookings.find((b) => b.id === params.bookingId);
        if (!bkg) return prev;
        const lastSeg = bkg.segments[bkg.segments.length - 1];
        if (!lastSeg) return prev;

        const targetRoomId = params.mode === 'move' && params.newRoomId ? params.newRoomId : lastSeg.roomId;
        const targetBedId = params.mode === 'move' ? params.newBedId : lastSeg.bedId;
        const targetRoom = prev.physicalRooms.find((r) => r.id === targetRoomId);
        const targetBed = targetRoom?.beds?.find((b) => b.id === targetBedId);
        const targetLabel = targetRoom
          ? targetBed
            ? `${targetRoom.code} ${targetBed.label}`
            : targetRoom.code
          : 'Номер';

        const fromDate = params.mode === 'move' ? todayIso() : lastSeg.toDate;
        const toDate = addDaysIso(fromDate, Math.max(1, params.extraNights));
        const chargeUsd = round2(Math.max(1, params.extraNights) * params.nightlyRateUsd);

        let nextRooms = prev.physicalRooms;
        let nextHk = prev.housekeepingTasks;

        if (params.mode === 'move' && (targetRoomId !== lastSeg.roomId || targetBedId !== lastSeg.bedId)) {
          const oldRoom = prev.physicalRooms.find((r) => r.id === lastSeg.roomId);
          nextRooms = prev.physicalRooms.map((r) => {
            if (r.id === lastSeg.roomId) {
              if (r.beds && lastSeg.bedId) {
                return {
                  ...r,
                  beds: r.beds.map((b) =>
                    b.id === lastSeg.bedId ? { ...b, status: 'dirty' as const } : b
                  ),
                };
              }
              return { ...r, status: 'dirty' as const };
            }
            if (r.id === targetRoomId) {
              if (r.beds && targetBedId) {
                return {
                  ...r,
                  beds: r.beds.map((b) =>
                    b.id === targetBedId ? { ...b, status: 'occupied' as const } : b
                  ),
                };
              }
              return { ...r, status: 'occupied' as const };
            }
            return r;
          });
          if (oldRoom) {
            nextHk = [
              {
                id: uid('hk'),
                propertyId: prev.propertyId,
                roomId: oldRoom.id,
                bedId: lastSeg.bedId,
                roomLabel: lastSeg.bedId
                  ? `${oldRoom.code} ${oldRoom.beds?.find((b) => b.id === lastSeg.bedId)?.label ?? ''}`
                  : oldRoom.code,
                status: 'dirty',
                createdAt: nowIso,
                notes: 'Переселение гостя — требуется уборка',
              },
              ...prev.housekeepingTasks,
            ];
          }
        }

        const nextBookings = prev.bookings.map((b) =>
          b.id === params.bookingId
            ? {
                ...b,
                checkingOutToday: false,
                segments: [
                  ...b.segments,
                  {
                    id: uid('seg'),
                    roomId: targetRoomId,
                    bedId: targetBedId,
                    fromDate,
                    toDate,
                    nights: Math.max(1, params.extraNights),
                    nightlyRateUsd: params.nightlyRateUsd,
                  },
                ],
                ledgerEntries: [
                  ...b.ledgerEntries,
                  {
                    id: uid('led'),
                    timestamp: nowIso,
                    type: 'charge' as const,
                    category: 'accommodation' as const,
                    label:
                      params.mode === 'move'
                        ? `Переселение в ${targetLabel} (${params.extraNights} н. × $${params.nightlyRateUsd})`
                        : `Продление ${targetLabel} (+${params.extraNights} н. × $${params.nightlyRateUsd})`,
                    amountUsd: chargeUsd,
                    actor: prev.adminName,
                  },
                ],
              }
            : b
        );

        return {
          ...prev,
          physicalRooms: nextRooms,
          housekeepingTasks: nextHk,
          bookings: nextBookings,
          auditLog: [
            {
              id: uid('aud'),
              propertyId: prev.propertyId,
              timestamp: nowIso,
              actor: prev.adminName,
              action: params.mode === 'move' ? 'Переселение' : 'Продление',
              diff: `${targetLabel} (+${params.extraNights} н., +${formatUsd(chargeUsd)})`,
              reason: 'Изменение сегмента проживания',
            },
            ...prev.auditLog,
          ],
        };
      });

      pushToast(
        params.mode === 'move' ? 'Гость переселён' : 'Проживание продлено',
        `Добавлено +${params.extraNights} н., сегмент и счёт обновлены`,
        'cobalt'
      );
    },
    [pushToast]
  );

  const checkOut = useCallback(
    (payload: CheckOutPayload) => {
      const nowIso = new Date().toISOString();
      let summaryLabel = '';

      setState((prev) => {
        const bkg = prev.bookings.find((b) => b.id === payload.bookingId);
        if (!bkg) return prev;
        const lastSeg = bkg.segments[bkg.segments.length - 1];
        const room = prev.physicalRooms.find((r) => r.id === lastSeg?.roomId);
        const bed = room?.beds?.find((b) => b.id === lastSeg?.bedId);
        const roomLabel = room ? (bed ? `${room.code} ${bed.label}` : room.code) : 'Номер';
        const primaryGuest = bkg.guests[0]?.fullName ?? 'Гость';
        summaryLabel = `${roomLabel} · ${primaryGuest}`;
        const financials = calcBookingTotals(bkg);

        const nextRooms = prev.physicalRooms.map((r) => {
          if (r.id !== lastSeg?.roomId) return r;
          if (r.beds && lastSeg?.bedId) {
            return {
              ...r,
              beds: r.beds.map((b) =>
                b.id === lastSeg.bedId ? { ...b, status: 'dirty' as const } : b
              ),
            };
          }
          return { ...r, status: 'dirty' as const };
        });

        const nextBookings = prev.bookings.map((b) =>
          b.id === payload.bookingId
            ? {
                ...b,
                status: 'checked_out' as const,
                checkingOutToday: false,
                guests: b.guests.map((g) => ({
                  ...g,
                  emehmonCheckedOut: true,
                  registrationSlipPrinted: true,
                  keyIssued: false,
                })),
              }
            : b
        );

        const nextHk = [
          {
            id: uid('hk'),
            propertyId: prev.propertyId,
            roomId: lastSeg?.roomId ?? '',
            bedId: lastSeg?.bedId,
            roomLabel,
            status: 'dirty' as const,
            createdAt: nowIso,
            notes: `Выселение: ${primaryGuest}. Требуется уборка и смена белья.`,
          },
          ...prev.housekeepingTasks,
        ];

        let nextLuggage = prev.luggageItems;
        if (payload.createLuggage) {
          const nextNum = 14 + prev.luggageItems.length;
          const tagCode = `#B${nextNum}`;
          nextLuggage = [
            {
              id: uid('lug'),
              propertyId: prev.propertyId,
              tagCode,
              guestName: primaryGuest,
              bagsCount: payload.createLuggage.bagsCount,
              flightTime: payload.createLuggage.flightTime || '22:00',
              notes: payload.createLuggage.notes || `Оставлен при выезде из ${roomLabel}`,
              status: 'stored' as const,
              createdAt: nowIso,
            },
            ...prev.luggageItems,
          ];
        }

        const reviewAlert = {
          id: uid('tg'),
          propertyId: prev.propertyId,
          timestamp: nowTimeHm(),
          source: 'Review Booster' as const,
          severity: 'success' as const,
          title: `Review Booster: ${primaryGuest} выселен`,
          body: `Гость успешно выехал из ${roomLabel}. Отправьте ссылку на отзыв в Google Maps / Booking, пока впечатления свежие.`,
          draftReply: `Спасибо, что выбрали Topchan Hostel в Ташкенте, ${primaryGuest}! Будем очень рады вашему отзыву на Google Maps: https://g.page/r/topchan-hostel-review. Счастливого пути!`,
          resolved: false,
          actions: [
            { id: uid('act'), label: 'Скопировать приглашение', kind: 'copy_draft' as const },
            { id: uid('act'), label: 'Отправлено', kind: 'dismiss' as const },
          ],
        };

        return {
          ...prev,
          physicalRooms: nextRooms,
          bookings: nextBookings,
          housekeepingTasks: nextHk,
          luggageItems: nextLuggage,
          telegramAlerts: [reviewAlert, ...prev.telegramAlerts],
          auditLog: [
            {
              id: uid('aud'),
              propertyId: prev.propertyId,
              timestamp: nowIso,
              actor: prev.adminName,
              action: financials.debtUsd > 0 ? 'Выселение с долгом (Override)' : 'Выселение (Check-out)',
              diff: `${roomLabel} → Уборка · Долг: ${formatUsd(financials.debtUsd)}`,
              reason:
                payload.debtOverrideReason ||
                'Стандартный check-out (ключ сдан, Bnovo/E-mehmon закрыты)',
            },
            ...prev.auditLog,
          ],
        };
      });

      setCheckOutBookingId(null);
      setSelectedBookingId(null);
      pushToast(
        'Выселение завершено',
        `${summaryLabel} → задача уборки создана, Review Booster в очереди`,
        'emerald'
      );
    },
    [pushToast]
  );

  const commitParsedCommand = useCallback(
    (cmd: ParsedCommand) => {
      if (!cmd.roomId) {
        pushToast('Комната не найдена', 'Уточните номер комнаты в команде', 'rose');
        return;
      }
      const nowIso = new Date().toISOString();
      const bookingId = uid('bkg');
      const fromDate = todayIso();
      const toDate = addDaysIso(fromDate, cmd.nights);

      setState((prev) => {
        const room = prev.physicalRooms.find((r) => r.id === cmd.roomId);
        if (!room) return prev;
        const stayUsd = round2(cmd.nights * cmd.nightlyRateUsd);

        const ledgerEntries: LedgerEntry[] = [
          {
            id: uid('led'),
            timestamp: nowIso,
            type: 'charge',
            category: 'accommodation',
            label: `Проживание ${cmd.roomLabel} (${cmd.nights} н. × $${cmd.nightlyRateUsd})`,
            amountUsd: stayUsd,
            actor: prev.adminName,
          },
        ];

        let nextLaundry = [...prev.laundryJobs];

        for (const extra of cmd.extras) {
          ledgerEntries.push({
            id: uid('led'),
            timestamp: nowIso,
            type: 'charge',
            category: extra.type,
            label: extra.label,
            amountUsd: extra.priceUsd,
            actor: prev.adminName,
          });
          if (extra.type === 'laundry_fast' || extra.type === 'laundry_medium') {
            const secs = extra.type === 'laundry_fast' ? 22 * 60 : 55 * 60;
            nextLaundry.unshift({
              id: uid('lnd'),
              propertyId: prev.propertyId,
              bookingId,
              guestName: cmd.guestName,
              roomLabel: cmd.roomLabel,
              mode: extra.type === 'laundry_fast' ? 'fast' : 'medium',
              priceUsd: extra.priceUsd,
              totalSeconds: secs,
              remainingSeconds: secs,
              status: 'running',
              startedAt: nowIso,
            });
          }
        }

        const nextPockets = prev.pockets.map((p) => ({ ...p }));
        const nextTransactions = [...prev.transactions];

        if (cmd.paidAmount > 0) {
          const pocketId: CashPocketId =
            cmd.paidCurrency === 'USD'
              ? 'cash_usd'
              : cmd.paidCurrency === 'EUR'
                ? 'cash_eur'
                : 'cash_uzs';
          const settledUsd = Math.min(cmd.totalUsd, cmd.paidCurrency === 'USD' ? cmd.paidAmount : cmd.totalUsd);
          ledgerEntries.push({
            id: uid('led'),
            timestamp: nowIso,
            type: 'payment',
            category: 'payment',
            label: `Оплата (${cmd.paidCurrency} · Автопилот)`,
            amountUsd: round2(settledUsd),
            originalCurrency: cmd.paidCurrency,
            originalAmount: cmd.paidAmount,
            pocketId,
            actor: prev.adminName,
          });
          const pIn = nextPockets.find((p) => p.id === pocketId);
          if (pIn) pIn.balance = round2(pIn.balance + cmd.paidAmount);
          nextTransactions.unshift({
            id: uid('tx'),
            propertyId: prev.propertyId,
            timestamp: nowIso,
            pocketId,
            direction: 'in',
            currency: cmd.paidCurrency,
            amount: cmd.paidAmount,
            label: `${cmd.roomLabel} · ${cmd.guestName} (автопилот)`,
            bookingId,
            actor: prev.adminName,
          });
        }

        if (cmd.changeUzs > 0) {
          const pUzs = nextPockets.find((p) => p.id === 'cash_uzs');
          if (pUzs) pUzs.balance = Math.round(pUzs.balance - cmd.changeUzs);
          nextTransactions.unshift({
            id: uid('tx'),
            propertyId: prev.propertyId,
            timestamp: nowIso,
            pocketId: 'cash_uzs',
            direction: 'out',
            currency: 'UZS',
            amount: cmd.changeUzs,
            label: `Сдача сумами (курс ${prev.currency.exRate}) · ${cmd.roomLabel}`,
            bookingId,
            actor: prev.adminName,
          });
        } else if (cmd.changeUsd > 0) {
          const pUsd = nextPockets.find((p) => p.id === 'cash_usd');
          if (pUsd) pUsd.balance = round2(pUsd.balance - cmd.changeUsd);
          nextTransactions.unshift({
            id: uid('tx'),
            propertyId: prev.propertyId,
            timestamp: nowIso,
            pocketId: 'cash_usd',
            direction: 'out',
            currency: 'USD',
            amount: cmd.changeUsd,
            label: `Сдача долларами · ${cmd.roomLabel}`,
            bookingId,
            actor: prev.adminName,
          });
        }

        const newBooking: BookingGroup = {
          id: bookingId,
          propertyId: prev.propertyId,
          bnovoId: `BN-${Math.floor(50000 + Math.random() * 9000)}`,
          status: 'active',
          checkOutTime: '12:00',
          checkingOutToday: false,
          source: 'Walk-in',
          notes: `Создано через Автопилот: "${cmd.raw}"`,
          createdAt: nowIso,
          segments: [
            {
              id: uid('seg'),
              roomId: cmd.roomId!,
              bedId: cmd.bedId,
              fromDate,
              toDate,
              nights: cmd.nights,
              nightlyRateUsd: cmd.nightlyRateUsd,
            },
          ],
          guests: [
            {
              id: uid('g'),
              fullName: cmd.guestName,
              citizenship: 'KOR',
              age: 28,
              passportNo: `W${Math.floor(1000000 + Math.random() * 8999999)}`,
              dob: '1998-05-10',
              sex: 'M',
              isForeigner: true,
              emehmonRegistered: false,
              emehmonCheckedOut: false,
              registrationSlipPrinted: false,
              keyIssued: true,
            },
          ],
          ledgerEntries,
        };

        const nextRooms = prev.physicalRooms.map((r) => {
          if (r.id !== cmd.roomId) return r;
          if (r.beds && cmd.bedId) {
            return {
              ...r,
              beds: r.beds.map((b) =>
                b.id === cmd.bedId ? { ...b, status: 'occupied' as const } : b
              ),
            };
          }
          return { ...r, status: 'occupied' as const };
        });

        return {
          ...prev,
          physicalRooms: nextRooms,
          bookings: [newBooking, ...prev.bookings],
          pockets: nextPockets,
          transactions: nextTransactions,
          laundryJobs: nextLaundry,
          auditLog: [
            {
              id: uid('aud'),
              propertyId: prev.propertyId,
              timestamp: nowIso,
              actor: prev.adminName,
              action: 'Автопилот (Zero-Typing)',
              diff: `${cmd.roomLabel} · ${cmd.guestName} · ${formatUsd(cmd.totalUsd)}`,
              reason: cmd.raw,
            },
            ...prev.auditLog,
          ],
        };
      });

      const extrasNote = cmd.extras.length > 0 ? ` + ${cmd.extras.map((e) => e.label).join(', ')}` : '';
      const changeNote =
        cmd.changeUzs > 0
          ? ` · Сдача: ${formatUzs(cmd.changeUzs)}`
          : cmd.changeUsd > 0
            ? ` · Сдача: ${formatUsd(cmd.changeUsd)}`
            : '';
      pushToast(
        'Команда проведена в 1 клик',
        `${cmd.roomLabel} · ${cmd.guestName}${extrasNote}${changeNote}`,
        'emerald'
      );
    },
    [pushToast]
  );

  const toggleChecklistItem = useCallback(
    (id: string) => {
      let toggledTitle = '';
      let nextDone = false;
      setState((prev) => ({
        ...prev,
        shiftChecklist: prev.shiftChecklist.map((item) => {
          if (item.id !== id) return item;
          toggledTitle = item.title;
          nextDone = !item.done;
          return {
            ...item,
            done: nextDone,
            doneAt: nextDone ? nowTimeHm() : undefined,
          };
        }),
      }));
      if (toggledTitle) {
        pushToast(nextDone ? 'Пункт смены выполнен' : 'Пункт возвращён в работу', toggledTitle, nextDone ? 'emerald' : 'amber');
      }
    },
    [pushToast]
  );

  const startLaundryJob = useCallback(
    (params: {
      bookingId?: string;
      guestName: string;
      roomLabel: string;
      mode: 'fast' | 'medium';
      chargeToFolio: boolean;
    }) => {
      const priceUsd = params.mode === 'fast' ? 2 : 3;
      const secs = params.mode === 'fast' ? 22 * 60 : 55 * 60;
      const nowIso = new Date().toISOString();
      const label = params.mode === 'fast' ? 'Быстрая стирка (22 мин)' : 'Средняя стирка (55 мин)';

      setState((prev) => {
        const nextBookings =
          params.chargeToFolio && params.bookingId
            ? prev.bookings.map((b) =>
                b.id === params.bookingId
                  ? {
                      ...b,
                      ledgerEntries: [
                        ...b.ledgerEntries,
                        {
                          id: uid('led'),
                          timestamp: nowIso,
                          type: 'charge' as const,
                          category:
                            params.mode === 'fast'
                              ? ('laundry_fast' as const)
                              : ('laundry_medium' as const),
                          label,
                          amountUsd: priceUsd,
                          actor: prev.adminName,
                        },
                      ],
                    }
                  : b
              )
            : prev.bookings;

        return {
          ...prev,
          bookings: nextBookings,
          laundryJobs: [
            {
              id: uid('lnd'),
              propertyId: prev.propertyId,
              bookingId: params.bookingId,
              guestName: params.guestName,
              roomLabel: params.roomLabel,
              mode: params.mode,
              priceUsd,
              totalSeconds: secs,
              remainingSeconds: secs,
              status: 'running',
              startedAt: nowIso,
            },
            ...prev.laundryJobs,
          ],
        };
      });

      pushToast(
        'Таймер стирки запущен',
        `${params.roomLabel} · ${label}${params.chargeToFolio && params.bookingId ? ' + добавлено в чек' : ''}`,
        'cobalt'
      );
    },
    [pushToast]
  );

  const speedUpLaundry = useCallback(
    (jobId: string, minusMinutes = 10) => {
      let finishedInfo: { guestName: string; roomLabel: string } | null = null;
      setState((prev) => {
        const nextJobs = prev.laundryJobs.map((j) => {
          if (j.id !== jobId || j.status !== 'running') return j;
          const nextRemaining = Math.max(0, j.remainingSeconds - minusMinutes * 60);
          if (nextRemaining === 0) {
            finishedInfo = { guestName: j.guestName, roomLabel: j.roomLabel };
            return { ...j, remainingSeconds: 0, status: 'completed' as const };
          }
          return { ...j, remainingSeconds: nextRemaining };
        });

        const nextAlerts = finishedInfo
          ? [
              {
                id: uid('tg'),
                propertyId: prev.propertyId,
                timestamp: nowTimeHm(),
                source: 'Laundry' as const,
                severity: 'success' as const,
                title: `Стирка завершена · ${(finishedInfo as { roomLabel: string }).roomLabel}`,
                body: `Цикл для ${(finishedInfo as { guestName: string }).guestName} завершён. Сообщите гостю, что бельё готово.`,
                resolved: false,
                actions: [{ id: uid('act'), label: 'Бельё выдано', kind: 'dismiss' as const }],
              },
              ...prev.telegramAlerts,
            ]
          : prev.telegramAlerts;

        return {
          ...prev,
          laundryJobs: nextJobs,
          telegramAlerts: nextAlerts,
        };
      });
      if (finishedInfo) {
        pushToast(
          'Стирка завершена!',
          `${(finishedInfo as { roomLabel: string }).roomLabel} — уведомление отправлено в Telegram`,
          'emerald'
        );
      } else {
        pushToast('Таймер ускорен', `Снято ${minusMinutes} мин (тестовый режим)`, 'cobalt');
      }
    },
    [pushToast]
  );

  const maidMarkCleaned = useCallback(
    (taskId: string) => {
      setState((prev) => ({
        ...prev,
        housekeepingTasks: prev.housekeepingTasks.map((t) =>
          t.id === taskId
            ? {
                ...t,
                status: 'maid_done' as const,
                maidCompletedAt: nowTimeHm(),
                photoAttached: true,
              }
            : t
        ),
      }));
      pushToast('Горничная: убрано + фото', 'Комната ожидает приёмку администратора', 'amber');
    },
    [pushToast]
  );

  const adminApproveHousekeeping = useCallback(
    (taskId: string) => {
      let label = '';
      setState((prev) => {
        const task = prev.housekeepingTasks.find((t) => t.id === taskId);
        if (!task) return prev;
        label = task.roomLabel;

        const nextRooms = prev.physicalRooms.map((r) => {
          if (r.id !== task.roomId) return r;
          if (r.beds && task.bedId) {
            return {
              ...r,
              beds: r.beds.map((b) =>
                b.id === task.bedId ? { ...b, status: 'available' as const } : b
              ),
            };
          }
          return { ...r, status: 'available' as const };
        });

        return {
          ...prev,
          physicalRooms: nextRooms,
          housekeepingTasks: prev.housekeepingTasks.map((t) =>
            t.id === taskId ? { ...t, status: 'approved' as const } : t
          ),
        };
      });
      if (label) {
        pushToast('Уборка принята', `${label} снова «Свободна» на Шахматке`, 'emerald');
      }
    },
    [pushToast]
  );

  const addLuggageItem = useCallback(
    (params: { guestName: string; bagsCount: number; flightTime: string; notes: string }) => {
      let createdTag = '';
      setState((prev) => {
        const nextNum = 14 + prev.luggageItems.length;
        createdTag = `#B${nextNum}`;
        return {
          ...prev,
          luggageItems: [
            {
              id: uid('lug'),
              propertyId: prev.propertyId,
              tagCode: createdTag,
              guestName: params.guestName,
              bagsCount: Math.max(1, params.bagsCount),
              flightTime: params.flightTime || '22:00',
              notes: params.notes,
              status: 'stored',
              createdAt: new Date().toISOString(),
            },
            ...prev.luggageItems,
          ],
        };
      });
      pushToast('Бирка багажа выдана', `${createdTag} · ${params.guestName}`, 'emerald');
    },
    [pushToast]
  );

  const releaseLuggageItem = useCallback(
    (id: string) => {
      setState((prev) => ({
        ...prev,
        luggageItems: prev.luggageItems.map((l) =>
          l.id === id ? { ...l, status: 'released' as const } : l
        ),
      }));
      pushToast('Багаж выдан гостю', 'Бирка закрыта', 'emerald');
    },
    [pushToast]
  );

  const addTransferJob = useCallback(
    (params: {
      guestName: string;
      roomLabel: string;
      direction: 'to_airport' | 'from_airport';
      pickupTime: string;
      flightNumber: string;
      priceUsd: number;
      driverName: string;
    }) => {
      setState((prev) => ({
        ...prev,
        transfers: [
          {
            id: uid('tr'),
            propertyId: prev.propertyId,
            ...params,
            status: 'assigned',
          },
          ...prev.transfers,
        ],
      }));
      pushToast('Трансфер оформлен', `${params.guestName} · ${params.pickupTime}`, 'cobalt');
    },
    [pushToast]
  );

  const cycleTransferStatus = useCallback(
    (id: string) => {
      const labels: Record<string, string> = {
        assigned: 'В пути',
        en_route: 'Забрал гостя',
        picked_up: 'Назначен',
      };
      let nextLabel = '';
      setState((prev) => ({
        ...prev,
        transfers: prev.transfers.map((t) => {
          if (t.id !== id) return t;
          const nextStatus =
            t.status === 'assigned'
              ? 'en_route'
              : t.status === 'en_route'
                ? 'picked_up'
                : 'assigned';
          nextLabel = labels[t.status];
          return { ...t, status: nextStatus };
        }),
      }));
      if (nextLabel) {
        pushToast('Статус трансфера обновлён', `Водитель: ${nextLabel}`, 'cobalt');
      }
    },
    [pushToast]
  );

  const adjustStock = useCallback(
    (id: string, delta: number) => {
      let itemName = '';
      let nextQty = 0;
      let isLow = false;
      setState((prev) => ({
        ...prev,
        stockItems: prev.stockItems.map((s) => {
          if (s.id !== id) return s;
          itemName = s.name;
          nextQty = Math.max(0, s.quantity + delta);
          isLow = nextQty <= s.minThreshold;
          return { ...s, quantity: nextQty };
        }),
      }));
      if (itemName) {
        pushToast(
          isLow ? `Низкий остаток: ${itemName}` : `Склад обновлён`,
          `${itemName}: ${nextQty}`,
          isLow ? 'amber' : 'emerald'
        );
      }
    },
    [pushToast]
  );

  const addPettyCashExpense = useCallback(
    (category: string, amountUzs: number, note: string) => {
      if (amountUzs <= 0) return;
      const nowIso = new Date().toISOString();
      setState((prev) => ({
        ...prev,
        pockets: prev.pockets.map((p) =>
          p.id === 'cash_uzs' ? { ...p, balance: Math.round(p.balance - amountUzs) } : p
        ),
        transactions: [
          {
            id: uid('tx'),
            propertyId: prev.propertyId,
            timestamp: nowIso,
            pocketId: 'cash_uzs',
            direction: 'out',
            currency: 'UZS',
            amount: amountUzs,
            label: `Хозрасход: ${category}${note ? ` (${note})` : ''}`,
            actor: prev.adminName,
          },
          ...prev.transactions,
        ],
        auditLog: [
          {
            id: uid('aud'),
            propertyId: prev.propertyId,
            timestamp: nowIso,
            actor: prev.adminName,
            action: 'Хозрасход',
            diff: `-${formatUzs(amountUzs)} (Нал UZS)`,
            reason: `${category}${note ? ` — ${note}` : ''}`,
          },
          ...prev.auditLog,
        ],
      }));
      pushToast('Хозрасход проведён', `-${formatUzs(amountUzs)} (${category})`, 'amber');
    },
    [pushToast]
  );

  const recordCashCalculatorTransaction = useCallback(
    (params: {
      pocketId: CashPocketId;
      currency: CurrencyCode;
      receivedAmount: number;
      changeUzs: number;
      changeUsd: number;
      label: string;
    }) => {
      const nowIso = new Date().toISOString();
      setState((prev) => {
        const nextPockets = prev.pockets.map((p) => {
          let bal = p.balance;
          if (p.id === params.pocketId) {
            bal = round2(bal + params.receivedAmount);
          }
          if (params.changeUzs > 0 && p.id === 'cash_uzs') {
            bal = Math.round(bal - params.changeUzs);
          }
          if (params.changeUsd > 0 && p.id === 'cash_usd') {
            bal = round2(bal - params.changeUsd);
          }
          return { ...p, balance: bal };
        });

        const nextTx = [
          {
            id: uid('tx'),
            propertyId: prev.propertyId,
            timestamp: nowIso,
            pocketId: params.pocketId,
            direction: 'in' as const,
            currency: params.currency,
            amount: params.receivedAmount,
            label: params.label,
            actor: prev.adminName,
          },
          ...prev.transactions,
        ];

        if (params.changeUzs > 0) {
          nextTx.unshift({
            id: uid('tx'),
            propertyId: prev.propertyId,
            timestamp: nowIso,
            pocketId: 'cash_uzs',
            direction: 'out',
            currency: 'UZS',
            amount: params.changeUzs,
            label: `Сдача сумами · ${params.label}`,
            actor: prev.adminName,
          });
        } else if (params.changeUsd > 0) {
          nextTx.unshift({
            id: uid('tx'),
            propertyId: prev.propertyId,
            timestamp: nowIso,
            pocketId: 'cash_usd',
            direction: 'out',
            currency: 'USD',
            amount: params.changeUsd,
            label: `Сдача долларами · ${params.label}`,
            actor: prev.adminName,
          });
        }

        return {
          ...prev,
          pockets: nextPockets,
          transactions: nextTx,
        };
      });
      pushToast('Операция проведена в кассу', params.label, 'emerald');
    },
    [pushToast]
  );

  const createSafeCollection = useCallback(
    (amountUzs: number, amountUsd: number, amountEur: number) => {
      if (amountUzs <= 0 && amountUsd <= 0 && amountEur <= 0) return;
      const nowIso = new Date().toISOString();
      setState((prev) => ({
        ...prev,
        pockets: prev.pockets.map((p) => {
          if (p.id === 'cash_uzs' && amountUzs > 0) return { ...p, balance: Math.max(0, Math.round(p.balance - amountUzs)) };
          if (p.id === 'cash_usd' && amountUsd > 0) return { ...p, balance: Math.max(0, round2(p.balance - amountUsd)) };
          if (p.id === 'cash_eur' && amountEur > 0) return { ...p, balance: Math.max(0, round2(p.balance - amountEur)) };
          if (p.id === 'safe' && amountUsd > 0) return { ...p, balance: round2(p.balance + amountUsd) };
          return p;
        }),
        safeCollections: [
          {
            id: uid('col'),
            propertyId: prev.propertyId,
            timestamp: nowIso,
            amountUzs,
            amountUsd,
            amountEur,
            status: 'pending',
            createdBy: prev.adminName,
          },
          ...prev.safeCollections,
        ],
        auditLog: [
          {
            id: uid('aud'),
            propertyId: prev.propertyId,
            timestamp: nowIso,
            actor: prev.adminName,
            action: 'Инкассация владельцу',
            diff: `${formatUzs(amountUzs)} · ${formatUsd(amountUsd)} · €${amountEur}`,
            reason: 'Передано в сейф, ожидает подтверждения владельца',
          },
          ...prev.auditLog,
        ],
      }));
      pushToast('Инкассация создана', 'Статус: «Ожидает подтверждения владельца»', 'amber');
    },
    [pushToast]
  );

  const confirmSafeCollection = useCallback(
    (id: string) => {
      const nowIso = new Date().toISOString();
      setState((prev) => ({
        ...prev,
        safeCollections: prev.safeCollections.map((c) =>
          c.id === id ? { ...c, status: 'confirmed' as const, confirmedAt: nowIso } : c
        ),
        auditLog: [
          {
            id: uid('aud'),
            propertyId: prev.propertyId,
            timestamp: nowIso,
            actor: 'Владелец хостела',
            action: 'Подтверждение инкассации',
            diff: `Инкассация ${id} подтверждена`,
            reason: 'Средства получены',
          },
          ...prev.auditLog,
        ],
      }));
      pushToast('Инкассация подтверждена', 'Владелец подтвердил получение средств', 'emerald');
    },
    [pushToast]
  );

  const submitGuestQrRequest = useCallback(
    (params: {
      bookingId: string;
      serviceType: 'extend' | 'laundry_fast' | 'laundry_medium' | 'transfer' | 'late_breakfast';
      lang: string;
    }) => {
      const serviceMap = {
        extend: { title: 'Продлить ночь напрямую (+1 ночь)', priceUsd: 18, category: 'accommodation' },
        laundry_fast: { title: 'Быстрая стирка (22 мин)', priceUsd: 2, category: 'laundry_fast' },
        laundry_medium: { title: 'Средняя стирка (55 мин)', priceUsd: 3, category: 'laundry_medium' },
        transfer: { title: 'Трансфер в аэропорт Ташкент (3 км)', priceUsd: 5, category: 'transfer' },
        late_breakfast: { title: 'Поздний завтрак', priceUsd: 2, category: 'late_breakfast' },
      } as const;

      const meta = serviceMap[params.serviceType];

      setState((prev) => {
        const bkg = prev.bookings.find((b) => b.id === params.bookingId && b.status === 'active') ??
          prev.bookings.find((b) => b.status === 'active');
        if (!bkg) return prev;
        const lastSeg = bkg.segments[bkg.segments.length - 1];
        const room = prev.physicalRooms.find((r) => r.id === lastSeg?.roomId);
        const roomLabel = room?.code ?? 'Номер';
        const guestName = bkg.guests[0]?.fullName ?? 'Гость';
        const priceUsd =
          params.serviceType === 'extend' ? lastSeg?.nightlyRateUsd ?? 18 : meta.priceUsd;

        const alert = {
          id: uid('tg'),
          propertyId: prev.propertyId,
          timestamp: nowTimeHm(),
          source: 'QR Concierge' as const,
          severity: 'info' as const,
          title: `Заявка с QR (${params.lang.toUpperCase()}): ${meta.title}`,
          body: `${roomLabel} · ${guestName} запросил услугу на ${formatUsd(priceUsd)} через QR-консьерж.`,
          resolved: false,
          actions: [
            {
              id: uid('act'),
              label: `Одобрить + в чек (${formatUsd(priceUsd)})`,
              kind: 'approve_qr_charge' as const,
              payload: {
                bookingId: bkg.id,
                category: meta.category,
                label: meta.title,
                amountUsd: priceUsd,
                serviceType: params.serviceType,
              },
            },
            { id: uid('act'), label: 'Отклонить', kind: 'dismiss' as const },
          ],
        };

        return {
          ...prev,
          telegramAlerts: [alert, ...prev.telegramAlerts],
        };
      });

      pushToast(
        'Заявка с QR отправлена!',
        `${meta.title} появилась в ленте Telegram-бота (вкладка 5)`,
        'cobalt'
      );
    },
    [pushToast]
  );

  const executeTelegramAction = useCallback(
    (alertId: string, actionId: string) => {
      const alert = state.telegramAlerts.find((a) => a.id === alertId);
      const action = alert?.actions.find((ac) => ac.id === actionId);
      if (!alert || !action) return;

      if (action.kind === 'dismiss') {
        setState((prev) => ({
          ...prev,
          telegramAlerts: prev.telegramAlerts.map((a) =>
            a.id === alertId ? { ...a, resolved: true } : a
          ),
        }));
        pushToast('Уведомление закрыто', alert.title, 'emerald');
        return;
      }

      if (action.kind === 'copy_draft') {
        if (alert.draftReply && navigator.clipboard) {
          navigator.clipboard.writeText(alert.draftReply).catch(() => {});
        }
        pushToast('Черновик скопирован', 'Текст готов для вставки в почту или мессенджер', 'cobalt');
        return;
      }

      if (action.kind === 'open_checkout' && action.payload?.bookingId) {
        const bId = String(action.payload.bookingId);
        const exists = state.bookings.find((b) => b.id === bId && b.status === 'active');
        if (!exists) {
          setState((prev) => ({
            ...prev,
            telegramAlerts: prev.telegramAlerts.map((a) =>
              a.id === alertId ? { ...a, resolved: true } : a
            ),
          }));
          pushToast('Гость уже выселен', 'Уведомление отмечено решённым', 'emerald');
          return;
        }
        setActiveTab('grid');
        setCheckOutBookingId(bId);
        return;
      }

      if (action.kind === 'open_room') {
        setActiveTab('services');
        pushToast('Переход к приёмке уборки', 'Проверьте список задач горничных', 'cobalt');
        return;
      }

      if (action.kind === 'approve_qr_charge' && action.payload) {
        const bookingId = String(action.payload.bookingId);
        const category = String(action.payload.category) as LedgerEntry['category'];
        const label = String(action.payload.label);
        const amountUsd = Number(action.payload.amountUsd);
        const serviceType = String(action.payload.serviceType);

        if (serviceType === 'extend') {
          extendOrMoveStay({
            bookingId,
            mode: 'extend',
            extraNights: 1,
            nightlyRateUsd: amountUsd,
          });
        } else {
          addLedgerCharge(bookingId, category, label, amountUsd, {
            startLaundryMode:
              serviceType === 'laundry_fast'
                ? 'fast'
                : serviceType === 'laundry_medium'
                  ? 'medium'
                  : undefined,
          });
        }

        setState((prev) => ({
          ...prev,
          telegramAlerts: prev.telegramAlerts.map((a) =>
            a.id === alertId ? { ...a, resolved: true } : a
          ),
        }));
      }
    },
    [state.telegramAlerts, state.bookings, pushToast, addLedgerCharge, extendOrMoveStay]
  );

  const addPhysicalRoom = useCallback(
    (categoryId: string, customCode?: string) => {
      let createdCode = '';
      setState((prev) => {
        const cat = prev.roomCategories.find((c) => c.id === categoryId);
        if (!cat) return prev;
        const existingInCat = prev.physicalRooms.filter((r) => r.categoryId === categoryId);
        const nextNumber =
          existingInCat.reduce((max, r) => Math.max(max, r.number), 0) + 1;
        createdCode = customCode?.trim() || `${cat.name} #${nextNumber}`;
        const newRoom: PhysicalRoom = {
          id: uid('room'),
          propertyId: prev.propertyId,
          categoryId,
          code: createdCode,
          number: nextNumber,
          status: 'available',
          beds: cat.isDorm
            ? [1, 2, 3, 4, 5, 6].map((n) => ({
                id: uid(`bed-${n}`),
                label: `#${n}`,
                tier: n % 2 === 1 ? 'Нижняя' : 'Верхняя',
                status: 'available',
              }))
            : undefined,
        };
        return {
          ...prev,
          physicalRooms: [...prev.physicalRooms, newRoom],
          auditLog: [
            {
              id: uid('aud'),
              propertyId: prev.propertyId,
              timestamp: new Date().toISOString(),
              actor: prev.adminName,
              action: 'Инвентарь комнат',
              diff: `Добавлена комната ${createdCode}`,
              reason: 'Динамическое расширение номерного фонда',
            },
            ...prev.auditLog,
          ],
        };
      });
      if (createdCode) {
        pushToast('Комната добавлена', `${createdCode} уже доступна на Шахматке и при заезде`, 'emerald');
      }
    },
    [pushToast]
  );

  const archivePhysicalRoom = useCallback(
    (roomId: string) => {
      let roomCode = '';
      setState((prev) => {
        const target = prev.physicalRooms.find((r) => r.id === roomId);
        if (!target) return prev;
        roomCode = target.code;
        return {
          ...prev,
          physicalRooms: prev.physicalRooms.map((r) =>
            r.id === roomId ? { ...r, archived: !r.archived } : r
          ),
        };
      });
      if (roomCode) {
        pushToast('Статус комнаты изменён', `${roomCode} обновлена в каталоге`, 'amber');
      }
    },
    [pushToast]
  );

  const updateCategoryPrice = useCallback(
    (categoryId: string, occupancy: number, priceUsd: number) => {
      if (!Number.isFinite(priceUsd) || priceUsd <= 0) return;
      const nowIso = new Date().toISOString();
      setState((prev) => {
        const cat = prev.roomCategories.find((c) => c.id === categoryId);
        if (!cat) return prev;
        const oldVal = cat.pricesUsd[occupancy];
        return {
          ...prev,
          roomCategories: prev.roomCategories.map((c) =>
            c.id === categoryId
              ? { ...c, pricesUsd: { ...c.pricesUsd, [occupancy]: round2(priceUsd) } }
              : c
          ),
          auditLog: [
            {
              id: uid('aud'),
              propertyId: prev.propertyId,
              timestamp: nowIso,
              actor: prev.adminName,
              action: 'Редактор тарифов',
              diff: `${cat.name} (${occupancy} чел.): $${oldVal ?? '-'} → $${priceUsd}`,
              reason: 'Обновление прайса в настройках',
            },
            ...prev.auditLog,
          ],
        };
      });
      pushToast('Тариф обновлён', `Новая ставка $${priceUsd}/ночь сохранена`, 'emerald');
    },
    [pushToast]
  );

  const updateCurrencySettings = useCallback(
    (patch: Partial<CurrencySettings>) => {
      setState((prev) => ({
        ...prev,
        currency: { ...prev.currency, ...patch },
      }));
      pushToast('Курсы и БРВ обновлены', 'Перерасчёт применён ко всем модулям', 'emerald');
    },
    [pushToast]
  );

  const updateIntegrationSettings = useCallback(
    (patch: Partial<IntegrationSettings>) => {
      setState((prev) => ({
        ...prev,
        integrations: { ...prev.integrations, ...patch },
      }));
      pushToast('Настройки сохранены', 'Параметры интеграций обновлены', 'emerald');
    },
    [pushToast]
  );

  const importBnovoDemoBooking = useCallback(() => {
    const freeRoom = state.physicalRooms.find(
      (r) => !r.archived && !r.beds && r.status === 'available'
    );
    if (!freeRoom) {
      pushToast('Нет свободных приватных комнат', 'Освободите комнату или выберите койку в дорме', 'amber');
      return;
    }
    const cat = state.roomCategories.find((c) => c.id === freeRoom.categoryId);
    const rate = cat?.pricesUsd[1] ?? 24;
    checkIn({
      roomId: freeRoom.id,
      nights: 2,
      nightlyRateUsd: rate,
      source: 'Bnovo',
      notes: 'Импортировано из Chrome Side Panel (Bnovo Bridge)',
      guests: [
        {
          fullName: 'Lucas Meyer',
          citizenship: 'CHE',
          age: 29,
          passportNo: 'X7482910',
          dob: '1997-04-19',
          sex: 'M',
          isForeigner: true,
          emehmonRegistered: false,
          emehmonCheckedOut: false,
          registrationSlipPrinted: false,
          keyIssued: true,
        },
      ],
    });
  }, [state.physicalRooms, state.roomCategories, checkIn, pushToast]);

  const markGuestEmehmonRegistered = useCallback(
    (bookingId: string, guestId: string) => {
      setState((prev) => ({
        ...prev,
        bookings: prev.bookings.map((b) =>
          b.id === bookingId
            ? {
                ...b,
                guests: b.guests.map((g) =>
                  g.id === guestId ? { ...g, emehmonRegistered: true } : g
                ),
              }
            : b
        ),
      }));
      pushToast('E-mehmon заполнен', 'Статус регистрации обновлён на «Зарегистрирован»', 'emerald');
    },
    [pushToast]
  );

  const resetDemoData = useCallback(() => {
    const fresh = createSeedState();
    setState(fresh);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(fresh));
    } catch {
      // ignore
    }
    setSelectedBookingId(null);
    setCheckOutBookingId(null);
    setCheckInPreselect(null);
    pushToast('Демо-данные сброшены', 'Восстановлено исходное состояние смены Topchan Hostel', 'cobalt');
  }, [pushToast]);

  const value = useMemo<OpsContextValue>(
    () => ({
      state,
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
      toasts,
      pushToast,
      dismissToast,
      checkIn,
      checkOut,
      addLedgerCharge,
      addPayment,
      extendOrMoveStay,
      commitParsedCommand,
      toggleChecklistItem,
      startLaundryJob,
      speedUpLaundry,
      maidMarkCleaned,
      adminApproveHousekeeping,
      addLuggageItem,
      releaseLuggageItem,
      addTransferJob,
      cycleTransferStatus,
      adjustStock,
      addPettyCashExpense,
      recordCashCalculatorTransaction,
      createSafeCollection,
      confirmSafeCollection,
      submitGuestQrRequest,
      executeTelegramAction,
      addPhysicalRoom,
      archivePhysicalRoom,
      updateCategoryPrice,
      updateCurrencySettings,
      updateIntegrationSettings,
      importBnovoDemoBooking,
      markGuestEmehmonRegistered,
      resetDemoData,
    }),
    [
      state,
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
      toasts,
      pushToast,
      dismissToast,
      checkIn,
      checkOut,
      addLedgerCharge,
      addPayment,
      extendOrMoveStay,
      commitParsedCommand,
      toggleChecklistItem,
      startLaundryJob,
      speedUpLaundry,
      maidMarkCleaned,
      adminApproveHousekeeping,
      addLuggageItem,
      releaseLuggageItem,
      addTransferJob,
      cycleTransferStatus,
      adjustStock,
      addPettyCashExpense,
      recordCashCalculatorTransaction,
      createSafeCollection,
      confirmSafeCollection,
      submitGuestQrRequest,
      executeTelegramAction,
      addPhysicalRoom,
      archivePhysicalRoom,
      updateCategoryPrice,
      updateCurrencySettings,
      updateIntegrationSettings,
      importBnovoDemoBooking,
      markGuestEmehmonRegistered,
      resetDemoData,
    ]
  );

  return <OpsContext.Provider value={value}>{children}</OpsContext.Provider>;
};

export function useOps(): OpsContextValue {
  const ctx = useContext(OpsContext);
  if (!ctx) throw new Error('useOps must be used inside OpsProvider');
  return ctx;
}
