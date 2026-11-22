import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import type {
  AppState,
  CurrencySettings,
  IntegrationSettings,
  LedgerEntry,
  MailInquiry,
  ParsedCommand,
} from '../types/ops';
import { FALLBACK_CBU_EUR, FALLBACK_CBU_USD } from '../data/seed';
import { formatUsd, formatUzs } from '../utils/math';
import { addDaysIso, getTashkentTodayIso } from '../utils/time';
import { findRoomConflicts } from '../utils/availability';
import {
  getStorageAdapter,
  type StorageAdapterKind,
  type SyncStatusInfo,
} from '../services/storageAdapter';
import {
  getNormalizedSupabaseSync,
  type OfflineSyncStatus,
} from '../services/supabaseNormalizedAdapter';
import { opsReducer } from '../store/opsReducer';
import {
  validateCheckOutGuards,
  validateFemaleOnlyRoom,
  validateGuestPayment,
  validateMoveOrResizeSegment,
  validateSplitStay,
} from '../store/handlers/bookingHandlers';
import {
  validateCashCalc,
  validatePettyCash,
  validateSafeCollection,
} from '../store/handlers/cashHandlers';
import type {
  AddLostFoundPayload,
  AddLuggagePayload,
  AddPaymentPayload,
  AddTransferPayload,
  CheckInPayload,
  CheckOutPayload,
  CompleteNightAuditPayload,
  ExtendOrMovePayload,
  IssueRefundPayload,
  MoveOrResizeSegmentPayload,
  RecordCashCalcPayload,
  SplitStayPayload,
  StartLaundryPayload,
  SubmitGuestQrPayload,
  UpdateBookingKitchenMetaPayload,
  UpsertGuestProfilePayload,
} from '../store/types';
import { useUI } from './UIContext';

export interface OpsDataContextValue {
  state: AppState;
  storageKind: StorageAdapterKind;
  syncStatusInfo: SyncStatusInfo;
  offlineSyncStatus: OfflineSyncStatus;
  flushOfflineQueue: () => Promise<void>;
  checkIn: (payload: CheckInPayload) => boolean;
  checkOut: (payload: CheckOutPayload) => boolean;
  addLedgerCharge: (
    bookingId: string,
    category: LedgerEntry['category'],
    label: string,
    amountUsd: number,
    options?: { startLaundryMode?: 'fast' | 'medium' }
  ) => void;
  addPayment: (params: AddPaymentPayload) => boolean;
  issueRefund: (params: IssueRefundPayload) => boolean;
  extendOrMoveStay: (params: ExtendOrMovePayload) => boolean;
  moveOrResizeSegment: (params: MoveOrResizeSegmentPayload) => boolean;
  splitStayBooking: (params: SplitStayPayload) => boolean;
  completeNightAudit: (params: CompleteNightAuditPayload) => void;
  commitParsedCommand: (cmd: ParsedCommand) => boolean;
  toggleChecklistItem: (id: string) => void;
  startLaundryJob: (params: StartLaundryPayload) => void;
  completeLaundryJob: (jobId: string) => void;
  speedUpLaundry: (jobId: string, minusMinutes?: number) => void;
  startHousekeepingTask: (taskId: string, maidName?: string) => void;
  finishHousekeepingTask: (taskId: string, maidName?: string) => void;
  maidMarkCleaned: (taskId: string) => void;
  adminApproveHousekeeping: (taskId: string) => void;
  setRoomHousekeepingStatus: (
    roomId: string,
    status: 'available' | 'dirty' | 'maintenance',
    bedId?: string
  ) => void;
  addLuggageItem: (params: AddLuggagePayload) => void;
  releaseLuggageItem: (id: string) => void;
  addLostFoundItem: (params: AddLostFoundPayload) => void;
  resolveLostFoundItem: (id: string) => void;
  addTransferJob: (params: AddTransferPayload) => void;
  cycleTransferStatus: (id: string) => void;
  adjustStock: (id: string, delta: number) => void;
  addPettyCashExpense: (category: string, amountUzs: number, note: string) => boolean;
  recordCashCalculatorTransaction: (params: RecordCashCalcPayload) => boolean;
  createSafeCollection: (amountUzs: number, amountUsd: number, amountEur: number) => boolean;
  confirmSafeCollection: (id: string) => boolean;
  submitGuestQrRequest: (params: SubmitGuestQrPayload) => void;
  updateTelegramAlertDraft: (alertId: string, draftReply: string) => void;
  executeTelegramAction: (alertId: string, actionId: string) => void;
  upsertGuestProfile: (params: UpsertGuestProfilePayload) => void;
  addMailInquiry: (params: Omit<MailInquiry, 'id' | 'propertyId' | 'handled'>) => void;
  dismissMailInquiry: (id: string) => void;
  syncMailInbox: () => Promise<void>;
  addPhysicalRoom: (categoryId: string, customCode?: string) => void;
  archivePhysicalRoom: (roomId: string) => void;
  updateCategoryPrice: (categoryId: string, occupancy: number, priceUsd: number) => void;
  updateCurrencySettings: (patch: Partial<CurrencySettings>) => void;
  updateIntegrationSettings: (patch: Partial<IntegrationSettings>) => void;
  importBnovoDemoBooking: () => void;
  markGuestEmehmonRegistered: (bookingId: string, guestId: string) => void;
  serveLateBreakfastOrder: (orderId: string) => void;
  toggleKitchenChecklistItem: (id: string) => void;
  updateBookingKitchenMeta: (payload: UpdateBookingKitchenMetaPayload) => void;
  resetDemoData: () => void;
}

const OpsDataContext = createContext<OpsDataContextValue | null>(null);

export const OpsDataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const adapter = useMemo(() => getStorageAdapter(), []);
  const normalizedSync = useMemo(() => getNormalizedSupabaseSync(), []);
  const [state, dispatch] = useReducer(opsReducer, undefined, () => adapter.loadState());
  const [syncStatusInfo, setSyncStatusInfo] = useState<SyncStatusInfo>(() =>
    adapter.getSyncStatus()
  );
  const [offlineSyncStatus, setOfflineSyncStatus] = useState<OfflineSyncStatus>(() =>
    normalizedSync.getStatus()
  );
  const stateRef = useRef(state);
  stateRef.current = state;

  const {
    pushToast,
    setActiveTab,
    setSelectedBookingId,
    closeCheckInModal,
    openCheckOutModal,
    closeCheckOutModal,
    openWelcomeCardModal,
  } = useUI();

  // Persist on every domain state change + enqueue normalized sync if Supabase configured
  useEffect(() => {
    adapter.saveState(state);
    if (normalizedSync.isConfigured) {
      normalizedSync.enqueueNormalizedSync(state);
    }
  }, [adapter, normalizedSync, state]);

  // Subscribe to offline queue & realtime updates
  useEffect(() => {
    const unsubOffline = normalizedSync.subscribeStatus((status) => {
      setOfflineSyncStatus(status);
    });
    const unsubRealtime = normalizedSync.startRealtimeChannel(stateRef.current.propertyId, () => {
      if (adapter.kind === 'supabase') {
        void adapter.loadStateAsync().then((remote) => {
          if (remote) dispatch({ type: 'HYDRATE_STATE', payload: remote });
        });
      }
    });
    return () => {
      unsubOffline();
      unsubRealtime();
    };
  }, [adapter, normalizedSync]);

  // Cross-tab & remote sync (e.g. Guest Standalone QR tab -> Admin Telegram feed)
  useEffect(() => {
    if (!adapter.subscribe) return;
    return adapter.subscribe((remoteState) => {
      dispatch({ type: 'HYDRATE_STATE', payload: remoteState });
    });
  }, [adapter]);

  // Sync status & optimistic-concurrency conflict alerts
  useEffect(() => {
    const unsubStatus = adapter.subscribeSyncStatus?.((info) => {
      setSyncStatusInfo(info);
    });
    const unsubConflict = adapter.subscribeConflict?.((latestRemote) => {
      dispatch({ type: 'HYDRATE_STATE', payload: latestRemote });
      pushToast(
        'Конфликт синхронизации',
        'Другое устройство обновило смену — загружена актуальная версия. Проверьте последнее действие.',
        'amber'
      );
    });
    return () => {
      unsubStatus?.();
      unsubConflict?.();
    };
  }, [adapter, pushToast]);

  // Hydrate from remote Supabase snapshot if configured
  useEffect(() => {
    if (adapter.kind !== 'supabase') return;
    let active = true;
    adapter.loadStateAsync().then((remote) => {
      if (active && remote) {
        dispatch({ type: 'HYDRATE_STATE', payload: remote });
      }
    });
    return () => {
      active = false;
    };
  }, [adapter]);

  // Fetch live CBU rates via our backend proxy (/api/rates/cbu) with direct fallback
  useEffect(() => {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 4500);

    async function loadCbuRates() {
      try {
        const proxyRes = await fetch('/api/rates/cbu', { signal: controller.signal });
        if (proxyRes.ok) {
          const data = (await proxyRes.json()) as {
            usd?: number;
            eur?: number;
            date?: string;
            source?: string;
          };
          if (data.usd && data.usd > 5000) {
            dispatch({
              type: 'APPLY_LIVE_CBU_RATES',
              payload: {
                cbuUsd: data.usd,
                cbuEur: data.eur ?? FALLBACK_CBU_EUR,
                updatedAt: data.date,
              },
            });
            return;
          }
        }
      } catch {
        // Fall through to direct cbu.uz fetch
      }

      try {
        const directRes = await fetch('https://cbu.uz/ru/arkhiv-kursov-valyut/json/', {
          signal: controller.signal,
        });
        if (!directRes.ok) return;
        const rows = (await directRes.json()) as Array<{ Ccy: string; Rate: string; Date?: string }>;
        if (!Array.isArray(rows)) return;
        const usdRow = rows.find((r) => r.Ccy === 'USD');
        const eurRow = rows.find((r) => r.Ccy === 'EUR');
        const cbuUsd = usdRow ? parseFloat(usdRow.Rate) : FALLBACK_CBU_USD;
        const cbuEur = eurRow ? parseFloat(eurRow.Rate) : FALLBACK_CBU_EUR;
        if (Number.isFinite(cbuUsd) && cbuUsd > 5000) {
          dispatch({
            type: 'APPLY_LIVE_CBU_RATES',
            payload: { cbuUsd, cbuEur, updatedAt: usdRow?.Date },
          });
        }
      } catch {
        // Graceful fallback to cached rates
      }
    }

    loadCbuRates().finally(() => window.clearTimeout(timeoutId));

    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, []);

  const flushOfflineQueue = useCallback(async () => {
    const flushed = await normalizedSync.flushQueue();
    if (flushed > 0) {
      pushToast('Очередь синхронизирована', `Отправлено пакетов в базу: ${flushed}`, 'emerald');
    }
  }, [normalizedSync, pushToast]);

  const checkIn = useCallback(
    (payload: CheckInPayload): boolean => {
      const femaleErr = validateFemaleOnlyRoom(stateRef.current, payload.roomId, payload.guests);
      if (femaleErr) {
        pushToast('Женский дорм (Fem Dorm)', femaleErr, 'rose');
        return false;
      }

      const fromDate = payload.fromDate || getTashkentTodayIso();
      const toDate = addDaysIso(fromDate, Math.max(1, payload.nights));
      const conflicts = findRoomConflicts(
        stateRef.current.bookings,
        payload.roomId,
        payload.bedId,
        fromDate,
        toDate
      );
      if (conflicts.length > 0) {
        pushToast(
          'Овербукинг заблокирован',
          `Конфликт дат с ${conflicts[0].guestName} (${conflicts[0].fromDate} — ${conflicts[0].toDate})`,
          'rose'
        );
        return false;
      }

      if (payload.initialPayment && payload.initialPayment.originalAmount > 0) {
        const payErr = validateGuestPayment(
          stateRef.current,
          payload.initialPayment.pocketId,
          payload.initialPayment.originalCurrency,
          payload.initialPayment.originalAmount,
          payload.changeUzsOut ?? 0
        );
        if (payErr) {
          pushToast('Ошибка оплаты при заезде', payErr, 'rose');
          return false;
        }
      }

      const prevIds = new Set(stateRef.current.bookings.map((b) => b.id));
      dispatch({ type: 'CHECK_IN', payload });
      closeCheckInModal();
      pushToast(
        'Заселение оформлено',
        `${payload.guests[0]?.fullName ?? 'Гость'} успешно заселён`,
        'emerald',
        {
          label: 'Welcome-карта',
          onClick: () => {
            const newest = stateRef.current.bookings.find((b) => !prevIds.has(b.id));
            if (newest) openWelcomeCardModal(newest.id);
          },
        }
      );
      return true;
    },
    [closeCheckInModal, openWelcomeCardModal, pushToast]
  );

  const addLedgerCharge = useCallback(
    (
      bookingId: string,
      category: LedgerEntry['category'],
      label: string,
      amountUsd: number,
      options?: { startLaundryMode?: 'fast' | 'medium' }
    ) => {
      dispatch({
        type: 'ADD_LEDGER_CHARGE',
        payload: { bookingId, category, label, amountUsd, options },
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
    (params: AddPaymentPayload): boolean => {
      const err = validateGuestPayment(
        stateRef.current,
        params.pocketId,
        params.currency,
        params.originalAmount,
        params.changeUzsOut ?? 0
      );
      if (err) {
        pushToast('Оплата отклонена', err, 'rose');
        return false;
      }
      dispatch({ type: 'ADD_PAYMENT', payload: params });
      pushToast('Оплата проведена', `Зачислено ${formatUsd(params.usdEquivalent)} в кассу`, 'emerald');
      return true;
    },
    [pushToast]
  );

  const issueRefund = useCallback(
    (params: IssueRefundPayload): boolean => {
      const pocket = stateRef.current.pockets.find((p) => p.id === params.pocketId);
      if (!pocket || pocket.currency !== params.currency) {
        pushToast('Ошибка возврата', 'Выбранный карман не соответствует валюте возврата', 'rose');
        return false;
      }
      if (params.amountOriginal <= 0 || params.amountUsd <= 0) {
        pushToast('Ошибка возврата', 'Сумма возврата должна быть больше нуля', 'rose');
        return false;
      }
      if (pocket.balance < params.amountOriginal) {
        pushToast(
          'Недостаточно средств в кассе',
          `В кармане ${pocket.name} недостаточно средств для выдачи возврата`,
          'rose'
        );
        return false;
      }
      dispatch({ type: 'ISSUE_REFUND', payload: params });
      pushToast(
        'Возврат переплаты выдан',
        params.currency === 'UZS'
          ? `Выдано ${formatUzs(params.amountOriginal)} (${formatUsd(params.amountUsd)})`
          : `Выдано ${formatUsd(params.amountOriginal)}`,
        'emerald'
      );
      return true;
    },
    [pushToast]
  );

  const extendOrMoveStay = useCallback(
    (params: ExtendOrMovePayload): boolean => {
      const bkg = stateRef.current.bookings.find((b) => b.id === params.bookingId);
      const lastSeg = bkg?.segments[bkg.segments.length - 1];
      if (!bkg || !lastSeg) return false;

      const targetRoomId = params.mode === 'move' && params.newRoomId ? params.newRoomId : lastSeg.roomId;
      const targetBedId = params.mode === 'move' ? params.newBedId : lastSeg.bedId;
      const fromDate = params.mode === 'move' ? getTashkentTodayIso() : lastSeg.toDate;
      const toDate = addDaysIso(fromDate, Math.max(1, params.extraNights));
      const conflicts = findRoomConflicts(
        stateRef.current.bookings,
        targetRoomId,
        targetBedId,
        fromDate,
        toDate,
        params.bookingId
      );
      if (conflicts.length > 0) {
        pushToast(
          'Конфликт дат на Шахматке',
          `Выбранный номер занят гостем ${conflicts[0].guestName} (${conflicts[0].fromDate} — ${conflicts[0].toDate})`,
          'rose'
        );
        return false;
      }

      dispatch({ type: 'EXTEND_OR_MOVE_STAY', payload: params });
      pushToast(
        params.mode === 'move' ? 'Гость переселён' : 'Проживание продлено',
        `Добавлено +${params.extraNights} н., сегмент и счёт обновлены`,
        'cobalt'
      );
      return true;
    },
    [pushToast]
  );

  const moveOrResizeSegment = useCallback(
    (params: MoveOrResizeSegmentPayload): boolean => {
      const err = validateMoveOrResizeSegment(stateRef.current, params);
      if (err) {
        pushToast('Перенос заблокирован', err, 'rose');
        return false;
      }
      const prevBookings = stateRef.current.bookings;
      const prevPhysicalRooms = stateRef.current.physicalRooms;
      const bkg = prevBookings.find((b) => b.id === params.bookingId);
      const guestName = bkg?.guests[0]?.fullName ?? 'Бронь';
      const room = stateRef.current.physicalRooms.find((r) => r.id === params.targetRoomId);
      const bed = params.targetBedId ? room?.beds?.find((b) => b.id === params.targetBedId) : undefined;
      const targetLabel = room ? (bed ? `${room.code} ${bed.label}` : room.code) : params.targetRoomId;

      dispatch({ type: 'MOVE_OR_RESIZE_SEGMENT', payload: params });
      pushToast(
        'Бронь обновлена на шахматке',
        `${guestName} → ${targetLabel} (${params.newFromDate} — ${params.newToDate})`,
        'emerald',
        {
          label: 'Отменить',
          onClick: () => {
            dispatch({
              type: 'RESTORE_BOOKINGS_AND_ROOMS',
              payload: {
                bookings: prevBookings,
                physicalRooms: prevPhysicalRooms,
                label: `Отмена переноса ${guestName}`,
              },
            });
            pushToast('Перенос отменён', `${guestName} возвращён на прежние даты`, 'cobalt');
          },
        }
      );
      return true;
    },
    [pushToast]
  );

  const splitStayBooking = useCallback(
    (params: SplitStayPayload): boolean => {
      const err = validateSplitStay(stateRef.current, params);
      if (err) {
        pushToast('Переселение (Split-Stay) отклонено', err, 'rose');
        return false;
      }
      const prevBookings = stateRef.current.bookings;
      const prevPhysicalRooms = stateRef.current.physicalRooms;
      const bkg = prevBookings.find((b) => b.id === params.bookingId);
      const guestName = bkg?.guests[0]?.fullName ?? 'Гость';
      const room = stateRef.current.physicalRooms.find((r) => r.id === params.targetRoomId);
      const bed = params.targetBedId ? room?.beds?.find((b) => b.id === params.targetBedId) : undefined;
      const targetLabel = room ? (bed ? `${room.code} ${bed.label}` : room.code) : params.targetRoomId;

      dispatch({ type: 'SPLIT_STAY_BOOKING', payload: params });
      pushToast(
        'Split-Stay оформлен',
        `${guestName}: с ${params.splitDate} → ${targetLabel} (единый баланс сохранён)`,
        'emerald',
        {
          label: 'Отменить',
          onClick: () => {
            dispatch({
              type: 'RESTORE_BOOKINGS_AND_ROOMS',
              payload: {
                bookings: prevBookings,
                physicalRooms: prevPhysicalRooms,
                label: `Отмена Split-Stay ${guestName}`,
              },
            });
            pushToast('Split-Stay отменён', `${guestName} возвращён в исходный номер`, 'cobalt');
          },
        }
      );
      return true;
    },
    [pushToast]
  );

  const completeNightAudit = useCallback(
    (params: CompleteNightAuditPayload) => {
      const currentOpDate = stateRef.current.operationalDate ?? getTashkentTodayIso();
      dispatch({ type: 'COMPLETE_NIGHT_AUDIT', payload: params });
      pushToast(
        'Ночной аудит завершён',
        `Операционный день ${currentOpDate} закрыт и архивирован. Незаездов отменено: ${params.noShowBookingIds.length}`,
        'emerald'
      );
    },
    [pushToast]
  );

  const checkOut = useCallback(
    (payload: CheckOutPayload): boolean => {
      const guardErr = validateCheckOutGuards(stateRef.current, payload);
      if (guardErr) {
        pushToast('Выселение заблокировано', guardErr, 'rose');
        return false;
      }
      const bkg = stateRef.current.bookings.find((b) => b.id === payload.bookingId);
      const lastSeg = bkg?.segments[bkg.segments.length - 1];
      const room = stateRef.current.physicalRooms.find((r) => r.id === lastSeg?.roomId);
      const bed = room?.beds?.find((b) => b.id === lastSeg?.bedId);
      const roomLabel = room ? (bed ? `${room.code} ${bed.label}` : room.code) : 'Номер';
      const primaryGuest = bkg?.guests[0]?.fullName ?? 'Гость';

      dispatch({ type: 'CHECK_OUT', payload });
      closeCheckOutModal();
      setSelectedBookingId(null);
      pushToast(
        'Выселение завершено',
        `${roomLabel} · ${primaryGuest} → задача уборки создана, Review Booster в очереди`,
        'emerald'
      );
      return true;
    },
    [closeCheckOutModal, setSelectedBookingId, pushToast]
  );

  const commitParsedCommand = useCallback(
    (cmd: ParsedCommand): boolean => {
      if (!cmd.roomId) {
        pushToast('Комната не найдена', 'Уточните номер комнаты в команде', 'rose');
        return false;
      }
      const fromDate = getTashkentTodayIso();
      const toDate = addDaysIso(fromDate, Math.max(1, cmd.nights));
      const conflicts = findRoomConflicts(
        stateRef.current.bookings,
        cmd.roomId,
        cmd.bedId,
        fromDate,
        toDate
      );
      if (conflicts.length > 0) {
        pushToast(
          'Овербукинг заблокирован',
          `${cmd.roomLabel} занята (${conflicts[0].guestName}). Выберите свободную комнату.`,
          'rose'
        );
        return false;
      }

      dispatch({ type: 'COMMIT_PARSED_COMMAND', payload: cmd });
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
      return true;
    },
    [pushToast]
  );

  const toggleChecklistItem = useCallback(
    (id: string) => {
      const current = stateRef.current.shiftChecklist.find((i) => i.id === id);
      dispatch({ type: 'TOGGLE_CHECKLIST', payload: { id } });
      if (current) {
        const nextDone = !current.done;
        pushToast(
          nextDone ? 'Пункт смены выполнен' : 'Пункт возвращён в работу',
          current.title,
          nextDone ? 'emerald' : 'amber'
        );
      }
    },
    [pushToast]
  );

  const startLaundryJob = useCallback(
    (params: StartLaundryPayload) => {
      const label = params.mode === 'fast' ? 'Быстрая стирка (22 мин)' : 'Средняя стирка (55 мин)';
      dispatch({ type: 'START_LAUNDRY', payload: params });
      pushToast(
        'Таймер стирки запущен',
        `${params.roomLabel} · ${label}${params.chargeToFolio && params.bookingId ? ' + добавлено в чек' : ''}`,
        'cobalt'
      );
    },
    [pushToast]
  );

  const completeLaundryJob = useCallback(
    (jobId: string) => {
      const job = stateRef.current.laundryJobs.find((j) => j.id === jobId);
      if (!job || job.status === 'completed') return;
      dispatch({ type: 'COMPLETE_LAUNDRY_JOB', payload: { jobId } });
      pushToast('Стирка завершена!', `${job.roomLabel} · ${job.guestName} — уведомление в Telegram`, 'emerald');
    },
    [pushToast]
  );

  const speedUpLaundry = useCallback(
    (jobId: string, minusMinutes = 10) => {
      const job = stateRef.current.laundryJobs.find((j) => j.id === jobId);
      if (!job || job.status !== 'running') return;
      const willFinish = job.remainingSeconds - minusMinutes * 60 <= 0;
      dispatch({ type: 'SPEED_UP_LAUNDRY', payload: { jobId, minusMinutes } });
      if (willFinish) {
        pushToast('Стирка завершена!', `${job.roomLabel} — уведомление отправлено в Telegram`, 'emerald');
      } else {
        pushToast('Таймер ускорен', `Снято ${minusMinutes} мин (тестовый режим)`, 'cobalt');
      }
    },
    [pushToast]
  );

  const startHousekeepingTask = useCallback(
    (taskId: string, maidName?: string) => {
      const task = stateRef.current.housekeepingTasks.find((t) => t.id === taskId);
      dispatch({ type: 'START_HOUSEKEEPING_TASK', payload: { taskId } });
      if (task) {
        pushToast('Уборка начата', `${task.roomLabel}${maidName ? ` · ${maidName}` : ''} · таймер запущен`, 'cobalt');
      }
    },
    [pushToast]
  );

  const finishHousekeepingTask = useCallback(
    (taskId: string, maidName?: string) => {
      const task = stateRef.current.housekeepingTasks.find((t) => t.id === taskId);
      dispatch({ type: 'FINISH_HOUSEKEEPING_TASK', payload: { taskId } });
      if (task) {
        pushToast('Чисто и готово', `${task.roomLabel}${maidName ? ` (${maidName})` : ''} свободна на Шахматке`, 'emerald');
      }
    },
    [pushToast]
  );

  const maidMarkCleaned = useCallback(
    (taskId: string) => {
      dispatch({ type: 'MAID_MARK_CLEANED', payload: { taskId } });
      pushToast('Горничная: убрано + фото', 'Комната ожидает приёмку администратора', 'amber');
    },
    [pushToast]
  );

  const adminApproveHousekeeping = useCallback(
    (taskId: string) => {
      const task = stateRef.current.housekeepingTasks.find((t) => t.id === taskId);
      dispatch({ type: 'ADMIN_APPROVE_HOUSEKEEPING', payload: { taskId } });
      if (task) {
        pushToast('Уборка принята', `${task.roomLabel} снова «Свободна» на Шахматке`, 'emerald');
      }
    },
    [pushToast]
  );

  const setRoomHousekeepingStatus = useCallback(
    (roomId: string, status: 'available' | 'dirty' | 'maintenance', bedId?: string) => {
      const room = stateRef.current.physicalRooms.find((r) => r.id === roomId);
      if (!room) return;
      const bed = bedId ? room.beds?.find((b) => b.id === bedId) : undefined;
      const currentStatus = bed ? bed.status : room.status;
      if (currentStatus === 'occupied') {
        pushToast('Номер занят гостем', 'Сначала оформите выезд или переселение гостя', 'amber');
        return;
      }
      dispatch({
        type: 'SET_ROOM_HOUSEKEEPING_STATUS',
        payload: { roomId, bedId, status },
      });
      const label = bed ? `${room.code} (${bed.label})` : room.code;
      const statusText =
        status === 'available'
          ? 'Чисто · готов к заселению'
          : status === 'dirty'
            ? 'Уборка · добавлена задача горничной'
            : 'Ремонт · снят с продажи';
      pushToast(
        `${label}: статус обновлён`,
        statusText,
        status === 'available' ? 'emerald' : status === 'dirty' ? 'amber' : 'rose'
      );
    },
    [pushToast]
  );

  const addLuggageItem = useCallback(
    (params: AddLuggagePayload) => {
      const tagCode = `#B${14 + stateRef.current.luggageItems.length}`;
      dispatch({ type: 'ADD_LUGGAGE', payload: params });
      pushToast('Бирка багажа выдана', `${tagCode} · ${params.guestName}`, 'emerald');
    },
    [pushToast]
  );

  const releaseLuggageItem = useCallback(
    (id: string) => {
      dispatch({ type: 'RELEASE_LUGGAGE', payload: { id } });
      pushToast('Багаж выдан гостю', 'Бирка закрыта', 'emerald');
    },
    [pushToast]
  );

  const addLostFoundItem = useCallback(
    (params: AddLostFoundPayload) => {
      dispatch({ type: 'ADD_LOST_FOUND', payload: params });
      pushToast('Запись в Бюро находок', `${params.itemName} · ${params.foundLocation}`, 'cobalt');
    },
    [pushToast]
  );

  const resolveLostFoundItem = useCallback(
    (id: string) => {
      dispatch({ type: 'RESOLVE_LOST_FOUND', payload: { id } });
      pushToast('Вещь возвращена владельцу', 'Запись закрыта в Бюро находок', 'emerald');
    },
    [pushToast]
  );

  const addTransferJob = useCallback(
    (params: AddTransferPayload) => {
      dispatch({ type: 'ADD_TRANSFER', payload: params });
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
      const target = stateRef.current.transfers.find((t) => t.id === id);
      dispatch({ type: 'CYCLE_TRANSFER_STATUS', payload: { id } });
      if (target) {
        pushToast('Статус трансфера обновлён', `Водитель: ${labels[target.status]}`, 'cobalt');
      }
    },
    [pushToast]
  );

  const adjustStock = useCallback(
    (id: string, delta: number) => {
      const target = stateRef.current.stockItems.find((s) => s.id === id);
      dispatch({ type: 'ADJUST_STOCK', payload: { id, delta } });
      if (target) {
        const nextQty = Math.max(0, target.quantity + delta);
        const isLow = nextQty <= target.minThreshold;
        pushToast(
          isLow ? `Низкий остаток: ${target.name}` : 'Склад обновлён',
          `${target.name}: ${nextQty}`,
          isLow ? 'amber' : 'emerald'
        );
      }
    },
    [pushToast]
  );

  const addPettyCashExpense = useCallback(
    (category: string, amountUzs: number, note: string): boolean => {
      const err = validatePettyCash(stateRef.current, amountUzs);
      if (err) {
        pushToast('Хозрасход отклонён', err, 'rose');
        return false;
      }
      dispatch({ type: 'ADD_PETTY_CASH', payload: { category, amountUzs, note } });
      pushToast('Хозрасход проведён', `-${formatUzs(amountUzs)} (${category})`, 'amber');
      return true;
    },
    [pushToast]
  );

  const recordCashCalculatorTransaction = useCallback(
    (params: RecordCashCalcPayload): boolean => {
      const err = validateCashCalc(stateRef.current, params);
      if (err) {
        pushToast('Операция кассы отклонена', err, 'rose');
        return false;
      }
      dispatch({ type: 'RECORD_CASH_CALC', payload: params });
      pushToast('Операция проведена в кассу', params.label, 'emerald');
      return true;
    },
    [pushToast]
  );

  const createSafeCollection = useCallback(
    (amountUzs: number, amountUsd: number, amountEur: number): boolean => {
      const err = validateSafeCollection(stateRef.current, { amountUzs, amountUsd, amountEur });
      if (err) {
        pushToast('Инкассация отклонена', err, 'rose');
        return false;
      }
      dispatch({ type: 'CREATE_SAFE_COLLECTION', payload: { amountUzs, amountUsd, amountEur } });
      pushToast('Инкассация создана', 'Статус: «Ожидает подтверждения владельца»', 'amber');
      return true;
    },
    [pushToast]
  );

  const confirmSafeCollection = useCallback(
    (id: string): boolean => {
      const col = stateRef.current.safeCollections.find((c) => c.id === id);
      if (!col || col.status !== 'pending') {
        pushToast('Уже подтверждено', 'Эта инкассация уже была закрыта ранее', 'amber');
        return false;
      }
      dispatch({ type: 'CONFIRM_SAFE_COLLECTION', payload: { id } });
      pushToast('Инкассация подтверждена', 'Владелец подтвердил получение средств из сейфа', 'emerald');
      return true;
    },
    [pushToast]
  );

  const submitGuestQrRequest = useCallback(
    (params: SubmitGuestQrPayload) => {
      const titleMap: Record<SubmitGuestQrPayload['serviceType'], string> = {
        extend: 'Продлить ночь напрямую (+1 ночь)',
        laundry_fast: 'Быстрая стирка (22 мин)',
        laundry_medium: 'Средняя стирка (55 мин)',
        transfer: 'Трансфер в аэропорт Ташкент (3 км)',
        late_breakfast: 'Поздний завтрак',
      };
      dispatch({ type: 'SUBMIT_GUEST_QR_REQUEST', payload: params });
      pushToast(
        'Заявка с QR отправлена!',
        `${titleMap[params.serviceType]} появилась в ленте Telegram-бота (вкладка 5)`,
        'cobalt'
      );
    },
    [pushToast]
  );

  const updateTelegramAlertDraft = useCallback(
    (alertId: string, draftReply: string) => {
      dispatch({ type: 'UPDATE_TELEGRAM_ALERT_DRAFT', payload: { alertId, draftReply } });
    },
    []
  );

  const executeTelegramAction = useCallback(
    (alertId: string, actionId: string) => {
      const alert = stateRef.current.telegramAlerts.find((a) => a.id === alertId);
      const action = alert?.actions.find((ac) => ac.id === actionId);
      if (!alert || !action) return;

      if (action.kind === 'dismiss') {
        dispatch({ type: 'RESOLVE_TELEGRAM_ALERT', payload: { alertId } });
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
        const exists = stateRef.current.bookings.find((b) => b.id === bId && b.status === 'active');
        if (!exists) {
          dispatch({ type: 'RESOLVE_TELEGRAM_ALERT', payload: { alertId } });
          pushToast('Гость уже выселен', 'Уведомление отмечено решённым', 'emerald');
          return;
        }
        setActiveTab('grid');
        openCheckOutModal(bId);
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

        dispatch({ type: 'RESOLVE_TELEGRAM_ALERT', payload: { alertId } });
      }
    },
    [pushToast, setActiveTab, openCheckOutModal, addLedgerCharge, extendOrMoveStay]
  );

  const upsertGuestProfile = useCallback(
    (params: UpsertGuestProfilePayload) => {
      dispatch({ type: 'UPSERT_GUEST_PROFILE', payload: params });
      pushToast('Профиль гостя обновлён', `${params.fullName} · статус ${params.tag.toUpperCase()}`, 'emerald');
    },
    [pushToast]
  );

  const addMailInquiry = useCallback(
    (params: Omit<MailInquiry, 'id' | 'propertyId' | 'handled'>) => {
      dispatch({ type: 'ADD_MAIL_INQUIRY', payload: params });
      pushToast('Входящее письмо добавлено', `${params.from}: ${params.subject}`, 'cobalt');
    },
    [pushToast]
  );

  const dismissMailInquiry = useCallback(
    (id: string) => {
      dispatch({ type: 'DISMISS_MAIL_INQUIRY', payload: { id } });
      pushToast('Письмо отмечено обработанным', 'Убрано из очереди входящих', 'emerald');
    },
    [pushToast]
  );

  const syncMailInbox = useCallback(async () => {
    try {
      const res = await fetch('/api/mail/inbox');
      if (!res.ok) {
        pushToast('Почтовый модуль в режиме демо', 'Настройте YANDEX_IMAP_* на сервере для живой синхронизации', 'amber');
        return;
      }
      const data = (await res.json()) as {
        configured?: boolean;
        items?: Array<{
          folder: 'INBOX' | 'Spam';
          from: string;
          subject: string;
          receivedAt: string;
          snippet: string;
          category: 'booking' | 'transfer' | 'inquiry';
          draftReplyRu: string;
          draftReplyEn: string;
        }>;
      };
      if (!data.configured) {
        pushToast('Яндекс Почта не подключена', 'Добавьте YANDEX_IMAP_USER и YANDEX_IMAP_PASS в переменные окружения', 'amber');
        return;
      }
      const existingSubjects = new Set((stateRef.current.mailInbox ?? []).map((m) => `${m.from}|${m.subject}`));
      let added = 0;
      for (const item of data.items ?? []) {
        const key = `${item.from}|${item.subject}`;
        if (!existingSubjects.has(key)) {
          dispatch({ type: 'ADD_MAIL_INQUIRY', payload: item });
          added += 1;
        }
      }
      pushToast(
        'Яндекс Почта проверена',
        added > 0 ? `Новых обращений (INBOX/Spam): ${added}` : 'Новых непрочитанных заявок нет',
        'emerald'
      );
    } catch {
      pushToast('Почтовый шлюз недоступен', 'Работаем с локальной лентой писем', 'amber');
    }
  }, [pushToast]);

  const addPhysicalRoom = useCallback(
    (categoryId: string, customCode?: string) => {
      const cat = stateRef.current.roomCategories.find((c) => c.id === categoryId);
      if (!cat) return;
      const existing = stateRef.current.physicalRooms.filter((r) => r.categoryId === categoryId);
      const nextNum = existing.reduce((max, r) => Math.max(max, r.number), 0) + 1;
      const createdCode = customCode?.trim() || `${cat.name} #${nextNum}`;
      dispatch({ type: 'ADD_PHYSICAL_ROOM', payload: { categoryId, customCode } });
      pushToast('Комната добавлена', `${createdCode} уже доступна на Шахматке и при заезде`, 'emerald');
    },
    [pushToast]
  );

  const archivePhysicalRoom = useCallback(
    (roomId: string) => {
      const target = stateRef.current.physicalRooms.find((r) => r.id === roomId);
      dispatch({ type: 'ARCHIVE_PHYSICAL_ROOM', payload: { roomId } });
      if (target) {
        pushToast('Статус комнаты изменён', `${target.code} обновлена в каталоге`, 'amber');
      }
    },
    [pushToast]
  );

  const updateCategoryPrice = useCallback(
    (categoryId: string, occupancy: number, priceUsd: number) => {
      if (!Number.isFinite(priceUsd) || priceUsd <= 0) return;
      dispatch({ type: 'UPDATE_CATEGORY_PRICE', payload: { categoryId, occupancy, priceUsd } });
      pushToast('Тариф обновлён', `Новая ставка $${priceUsd}/ночь сохранена`, 'emerald');
    },
    [pushToast]
  );

  const updateCurrencySettings = useCallback(
    (patch: Partial<CurrencySettings>) => {
      dispatch({ type: 'UPDATE_CURRENCY', payload: patch });
      pushToast('Курсы и БРВ обновлены', 'Перерасчёт применён ко всем модулям', 'emerald');
    },
    [pushToast]
  );

  const updateIntegrationSettings = useCallback(
    (patch: Partial<IntegrationSettings>) => {
      dispatch({ type: 'UPDATE_INTEGRATIONS', payload: patch });
      pushToast('Настройки сохранены', 'Параметры интеграций обновлены', 'emerald');
    },
    [pushToast]
  );

  const importBnovoDemoBooking = useCallback(() => {
    const today = getTashkentTodayIso();
    const toDate = addDaysIso(today, 2);
    const freeRoom = stateRef.current.physicalRooms.find(
      (r) =>
        !r.archived &&
        !r.beds &&
        r.status === 'available' &&
        findRoomConflicts(stateRef.current.bookings, r.id, undefined, today, toDate).length === 0
    );
    if (!freeRoom) {
      pushToast('Нет свободных приватных комнат', 'Освободите комнату или выберите койку в дорме', 'amber');
      return;
    }
    const cat = stateRef.current.roomCategories.find((c) => c.id === freeRoom.categoryId);
    const rate = cat?.pricesUsd[1] ?? 24;
    checkIn({
      roomId: freeRoom.id,
      fromDate: today,
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
  }, [checkIn, pushToast]);

  const markGuestEmehmonRegistered = useCallback(
    (bookingId: string, guestId: string) => {
      dispatch({ type: 'MARK_EMEHMON_REGISTERED', payload: { bookingId, guestId } });
      pushToast('E-mehmon заполнен', 'Статус регистрации обновлён на «Зарегистрирован»', 'emerald');
    },
    [pushToast]
  );

  const serveLateBreakfastOrder = useCallback(
    (orderId: string) => {
      const target = (stateRef.current.lateBreakfastOrders ?? []).find((o) => o.id === orderId);
      dispatch({ type: 'SERVE_LATE_BREAKFAST', payload: { orderId } });
      if (target) {
        pushToast(
          'Поздний завтрак подан',
          `${target.roomLabel} · ${target.portions} порц. отмечено выполненным`,
          'emerald'
        );
      }
    },
    [pushToast]
  );

  const toggleKitchenChecklistItem = useCallback((id: string) => {
    dispatch({ type: 'TOGGLE_KITCHEN_CHECKLIST', payload: { id } });
  }, []);

  const updateBookingKitchenMeta = useCallback(
    (payload: UpdateBookingKitchenMetaPayload) => {
      dispatch({ type: 'UPDATE_BOOKING_KITCHEN_META', payload });
      pushToast('Данные для кухни обновлены', 'Время заезда и диетические пометки сохранены', 'emerald');
    },
    [pushToast]
  );

  const resetDemoData = useCallback(() => {
    dispatch({ type: 'RESET_DEMO_DATA' });
    setSelectedBookingId(null);
    closeCheckOutModal();
    closeCheckInModal();
    pushToast('Демо-данные сброшены', 'Восстановлено исходное состояние смены Topchan Hostel', 'cobalt');
  }, [setSelectedBookingId, closeCheckOutModal, closeCheckInModal, pushToast]);

  const value = useMemo<OpsDataContextValue>(
    () => ({
      state,
      storageKind: adapter.kind,
      syncStatusInfo,
      offlineSyncStatus,
      flushOfflineQueue,
      checkIn,
      checkOut,
      addLedgerCharge,
      addPayment,
      issueRefund,
      extendOrMoveStay,
      moveOrResizeSegment,
      splitStayBooking,
      completeNightAudit,
      commitParsedCommand,
      toggleChecklistItem,
      startLaundryJob,
      completeLaundryJob,
      speedUpLaundry,
      startHousekeepingTask,
      finishHousekeepingTask,
      maidMarkCleaned,
      adminApproveHousekeeping,
      setRoomHousekeepingStatus,
      addLuggageItem,
      releaseLuggageItem,
      addLostFoundItem,
      resolveLostFoundItem,
      addTransferJob,
      cycleTransferStatus,
      adjustStock,
      addPettyCashExpense,
      recordCashCalculatorTransaction,
      createSafeCollection,
      confirmSafeCollection,
      submitGuestQrRequest,
      updateTelegramAlertDraft,
      executeTelegramAction,
      upsertGuestProfile,
      addMailInquiry,
      dismissMailInquiry,
      syncMailInbox,
      addPhysicalRoom,
      archivePhysicalRoom,
      updateCategoryPrice,
      updateCurrencySettings,
      updateIntegrationSettings,
      importBnovoDemoBooking,
      markGuestEmehmonRegistered,
      serveLateBreakfastOrder,
      toggleKitchenChecklistItem,
      updateBookingKitchenMeta,
      resetDemoData,
    }),
    [
      state,
      adapter.kind,
      syncStatusInfo,
      offlineSyncStatus,
      flushOfflineQueue,
      checkIn,
      checkOut,
      addLedgerCharge,
      addPayment,
      issueRefund,
      extendOrMoveStay,
      moveOrResizeSegment,
      splitStayBooking,
      completeNightAudit,
      commitParsedCommand,
      toggleChecklistItem,
      startLaundryJob,
      completeLaundryJob,
      speedUpLaundry,
      startHousekeepingTask,
      finishHousekeepingTask,
      maidMarkCleaned,
      adminApproveHousekeeping,
      setRoomHousekeepingStatus,
      addLuggageItem,
      releaseLuggageItem,
      addLostFoundItem,
      resolveLostFoundItem,
      addTransferJob,
      cycleTransferStatus,
      adjustStock,
      addPettyCashExpense,
      recordCashCalculatorTransaction,
      createSafeCollection,
      confirmSafeCollection,
      submitGuestQrRequest,
      updateTelegramAlertDraft,
      executeTelegramAction,
      upsertGuestProfile,
      addMailInquiry,
      dismissMailInquiry,
      syncMailInbox,
      addPhysicalRoom,
      archivePhysicalRoom,
      updateCategoryPrice,
      updateCurrencySettings,
      updateIntegrationSettings,
      importBnovoDemoBooking,
      markGuestEmehmonRegistered,
      serveLateBreakfastOrder,
      toggleKitchenChecklistItem,
      updateBookingKitchenMeta,
      resetDemoData,
    ]
  );

  return <OpsDataContext.Provider value={value}>{children}</OpsDataContext.Provider>;
};

export function useOpsData(): OpsDataContextValue {
  const ctx = useContext(OpsDataContext);
  if (!ctx) throw new Error('useOpsData must be used inside OpsDataProvider');
  return ctx;
}
