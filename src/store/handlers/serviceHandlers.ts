import type { AppState, MailInquiry } from '../../types/ops';
import { formatUsd } from '../../utils/math';
import { formatTashkentHm, getTashkentTodayIso } from '../../utils/time';
import {
  makeId,
  type AddLostFoundPayload,
  type AddLuggagePayload,
  type AddTransferPayload,
  type StartLaundryPayload,
  type SubmitGuestQrPayload,
  type UpsertGuestProfilePayload,
} from '../types';

export function handleToggleChecklist(
  state: AppState,
  payload: { id: string },
  timeHm = formatTashkentHm()
): AppState {
  return {
    ...state,
    shiftChecklist: state.shiftChecklist.map((item) => {
      if (item.id !== payload.id) return item;
      const nextDone = !item.done;
      return {
        ...item,
        done: nextDone,
        doneAt: nextDone ? timeHm : undefined,
      };
    }),
  };
}

export function handleStartLaundry(
  state: AppState,
  params: StartLaundryPayload,
  nowIso = new Date().toISOString()
): AppState {
  const priceUsd = params.mode === 'fast' ? 2 : 3;
  const secs = params.mode === 'fast' ? 22 * 60 : 55 * 60;
  const label = params.mode === 'fast' ? 'Быстрая стирка (22 мин)' : 'Средняя стирка (55 мин)';

  const nextBookings =
    params.chargeToFolio && params.bookingId
      ? state.bookings.map((b) =>
          b.id === params.bookingId
            ? {
                ...b,
                ledgerEntries: [
                  ...b.ledgerEntries,
                  {
                    id: makeId('led'),
                    timestamp: nowIso,
                    type: 'charge' as const,
                    category:
                      params.mode === 'fast'
                        ? ('laundry_fast' as const)
                        : ('laundry_medium' as const),
                    label,
                    amountUsd: priceUsd,
                    actor: state.adminName,
                  },
                ],
              }
            : b
        )
      : state.bookings;

  return {
    ...state,
    bookings: nextBookings,
    laundryJobs: [
      {
        id: makeId('lnd'),
        propertyId: state.propertyId,
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
      ...state.laundryJobs,
    ],
  };
}

export function handleCompleteLaundryJob(
  state: AppState,
  payload: { jobId: string },
  timeHm = formatTashkentHm()
): AppState {
  const job = state.laundryJobs.find((j) => j.id === payload.jobId);
  if (!job || job.status === 'completed') return state;

  const nextJobs = state.laundryJobs.map((j) =>
    j.id === payload.jobId ? { ...j, remainingSeconds: 0, status: 'completed' as const } : j
  );

  const alert = {
    id: makeId('tg'),
    propertyId: state.propertyId,
    timestamp: timeHm,
    source: 'Laundry' as const,
    severity: 'success' as const,
    title: `Стирка завершена · ${job.roomLabel}`,
    body: `Машинка закончила цикл для ${job.guestName}. Можно выгрузить бельё и написать гостю.`,
    resolved: false,
    actions: [{ id: makeId('act'), label: 'Бельё выдано', kind: 'dismiss' as const }],
  };

  return {
    ...state,
    laundryJobs: nextJobs,
    telegramAlerts: [alert, ...state.telegramAlerts],
  };
}

export function handleSpeedUpLaundry(
  state: AppState,
  payload: { jobId: string; minusMinutes?: number },
  timeHm = formatTashkentHm()
): AppState {
  const minusMinutes = payload.minusMinutes ?? 10;
  let finishedInfo: { guestName: string; roomLabel: string } | null = null;

  const nextJobs = state.laundryJobs.map((j) => {
    if (j.id !== payload.jobId || j.status !== 'running') return j;
    // Also shift startedAt backwards so wall-clock TimerContext reflects the speed-up
    const shiftedStart = new Date(
      new Date(j.startedAt).getTime() - minusMinutes * 60 * 1000
    ).toISOString();
    const nextRemaining = Math.max(0, j.remainingSeconds - minusMinutes * 60);
    if (nextRemaining === 0) {
      finishedInfo = { guestName: j.guestName, roomLabel: j.roomLabel };
      return { ...j, remainingSeconds: 0, status: 'completed' as const, startedAt: shiftedStart };
    }
    return { ...j, remainingSeconds: nextRemaining, startedAt: shiftedStart };
  });

  const nextAlerts = finishedInfo
    ? [
        {
          id: makeId('tg'),
          propertyId: state.propertyId,
          timestamp: timeHm,
          source: 'Laundry' as const,
          severity: 'success' as const,
          title: `Стирка завершена · ${(finishedInfo as { roomLabel: string }).roomLabel}`,
          body: `Цикл для ${(finishedInfo as { guestName: string }).guestName} завершён. Сообщите гостю, что бельё готово.`,
          resolved: false,
          actions: [{ id: makeId('act'), label: 'Бельё выдано', kind: 'dismiss' as const }],
        },
        ...state.telegramAlerts,
      ]
    : state.telegramAlerts;

  return {
    ...state,
    laundryJobs: nextJobs,
    telegramAlerts: nextAlerts,
  };
}

export function handleMaidMarkCleaned(
  state: AppState,
  payload: { taskId: string },
  timeHm = formatTashkentHm()
): AppState {
  return {
    ...state,
    housekeepingTasks: state.housekeepingTasks.map((t) =>
      t.id === payload.taskId
        ? {
            ...t,
            status: 'maid_done' as const,
            maidCompletedAt: timeHm,
            photoAttached: true,
          }
        : t
    ),
  };
}

export function handleAdminApproveHousekeeping(
  state: AppState,
  payload: { taskId: string }
): AppState {
  const task = state.housekeepingTasks.find((t) => t.id === payload.taskId);
  if (!task) return state;

  const nextRooms = state.physicalRooms.map((r) => {
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
    ...state,
    physicalRooms: nextRooms,
    housekeepingTasks: state.housekeepingTasks.map((t) =>
      t.id === payload.taskId ? { ...t, status: 'approved' as const } : t
    ),
  };
}

export function handleSetRoomHousekeepingStatus(
  state: AppState,
  payload: { roomId: string; bedId?: string; status: 'available' | 'dirty' | 'maintenance' },
  nowIso = new Date().toISOString()
): AppState {
  const room = state.physicalRooms.find((r) => r.id === payload.roomId);
  if (!room) return state;

  if (payload.bedId && room.beds) {
    const bed = room.beds.find((b) => b.id === payload.bedId);
    if (!bed || bed.status === 'occupied' || bed.status === payload.status) return state;
  } else {
    if (room.status === 'occupied' || room.status === payload.status) return state;
  }

  const bedObj = payload.bedId ? room.beds?.find((b) => b.id === payload.bedId) : undefined;
  const roomLabel = bedObj ? `${room.code} ${bedObj.label}` : room.code;

  const nextRooms = state.physicalRooms.map((r) => {
    if (r.id !== payload.roomId) return r;
    if (payload.bedId && r.beds) {
      return {
        ...r,
        beds: r.beds.map((b) =>
          b.id === payload.bedId ? { ...b, status: payload.status } : b
        ),
      };
    }
    return { ...r, status: payload.status };
  });

  let nextTasks = state.housekeepingTasks;
  if (payload.status === 'available') {
    nextTasks = state.housekeepingTasks.map((t) =>
      t.roomId === payload.roomId && (t.bedId ?? undefined) === (payload.bedId ?? undefined) && t.status !== 'approved'
        ? { ...t, status: 'approved' as const }
        : t
    );
  } else if (payload.status === 'dirty') {
    const hasOpen = state.housekeepingTasks.some(
      (t) =>
        t.roomId === payload.roomId &&
        (t.bedId ?? undefined) === (payload.bedId ?? undefined) &&
        t.status !== 'approved'
    );
    if (!hasOpen) {
      nextTasks = [
        {
          id: makeId('hk'),
          propertyId: state.propertyId,
          roomId: payload.roomId,
          bedId: payload.bedId,
          roomLabel,
          status: 'dirty' as const,
          createdAt: nowIso,
          notes: 'Отмечено на Шахматке — требуется уборка',
        },
        ...state.housekeepingTasks,
      ];
    }
  }

  return {
    ...state,
    physicalRooms: nextRooms,
    housekeepingTasks: nextTasks,
  };
}

export function handleAddLuggage(
  state: AppState,
  params: AddLuggagePayload,
  nowIso = new Date().toISOString()
): AppState {
  const nextNum = 14 + state.luggageItems.length;
  const tagCode = `#B${nextNum}`;
  return {
    ...state,
    luggageItems: [
      {
        id: makeId('lug'),
        propertyId: state.propertyId,
        tagCode,
        guestName: params.guestName,
        bagsCount: Math.max(1, params.bagsCount),
        flightTime: params.flightTime || '22:00',
        notes: params.notes,
        status: 'stored',
        createdAt: nowIso,
      },
      ...state.luggageItems,
    ],
  };
}

export function handleReleaseLuggage(state: AppState, payload: { id: string }): AppState {
  return {
    ...state,
    luggageItems: state.luggageItems.map((l) =>
      l.id === payload.id ? { ...l, status: 'released' as const } : l
    ),
  };
}

export function handleAddTransfer(state: AppState, params: AddTransferPayload): AppState {
  return {
    ...state,
    transfers: [
      {
        id: makeId('tr'),
        propertyId: state.propertyId,
        ...params,
        status: 'assigned',
      },
      ...state.transfers,
    ],
  };
}

export function handleCycleTransferStatus(state: AppState, payload: { id: string }): AppState {
  return {
    ...state,
    transfers: state.transfers.map((t) => {
      if (t.id !== payload.id) return t;
      const nextStatus =
        t.status === 'assigned'
          ? 'en_route'
          : t.status === 'en_route'
            ? 'picked_up'
            : 'assigned';
      return { ...t, status: nextStatus };
    }),
  };
}

export function handleAdjustStock(
  state: AppState,
  payload: { id: string; delta: number }
): AppState {
  return {
    ...state,
    stockItems: state.stockItems.map((s) =>
      s.id === payload.id ? { ...s, quantity: Math.max(0, s.quantity + payload.delta) } : s
    ),
  };
}

export function handleSubmitGuestQrRequest(
  state: AppState,
  params: SubmitGuestQrPayload,
  timeHm = formatTashkentHm()
): AppState {
  const serviceMap = {
    extend: { title: 'Продлить ночь напрямую (+1 ночь)', priceUsd: 18, category: 'accommodation' },
    laundry_fast: { title: 'Быстрая стирка (22 мин)', priceUsd: 2, category: 'laundry_fast' },
    laundry_medium: { title: 'Средняя стирка (55 мин)', priceUsd: 3, category: 'laundry_medium' },
    transfer: { title: 'Трансфер в аэропорт Ташкент (3 км)', priceUsd: 5, category: 'transfer' },
    late_breakfast: { title: 'Поздний завтрак', priceUsd: 2, category: 'late_breakfast' },
  } as const;

  const meta = serviceMap[params.serviceType];
  const bkg =
    state.bookings.find((b) => b.id === params.bookingId && b.status === 'active') ??
    state.bookings.find((b) => b.status === 'active');
  if (!bkg) return state;

  const lastSeg = bkg.segments[bkg.segments.length - 1];
  const room = state.physicalRooms.find((r) => r.id === lastSeg?.roomId);
  const roomLabel = room?.code ?? 'Номер';
  const guestName = bkg.guests[0]?.fullName ?? 'Гость';
  const priceUsd =
    params.serviceType === 'extend' ? (lastSeg?.nightlyRateUsd ?? 18) : meta.priceUsd;

  const alert = {
    id: makeId('tg'),
    propertyId: state.propertyId,
    timestamp: timeHm,
    source: 'QR Concierge' as const,
    severity: 'info' as const,
    title: `Заявка с QR (${params.lang.toUpperCase()}): ${meta.title}`,
    body: `${roomLabel} · ${guestName} запросил услугу на ${formatUsd(priceUsd)} через QR-консьерж.`,
    resolved: false,
    actions: [
      {
        id: makeId('act'),
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
      { id: makeId('act'), label: 'Отклонить', kind: 'dismiss' as const },
    ],
  };

  return {
    ...state,
    telegramAlerts: [alert, ...state.telegramAlerts],
  };
}

export function handleUpdateTelegramAlertDraft(
  state: AppState,
  payload: { alertId: string; draftReply: string }
): AppState {
  return {
    ...state,
    telegramAlerts: state.telegramAlerts.map((a) =>
      a.id === payload.alertId ? { ...a, draftReply: payload.draftReply } : a
    ),
  };
}

export function handleResolveTelegramAlert(
  state: AppState,
  payload: { alertId: string }
): AppState {
  return {
    ...state,
    telegramAlerts: state.telegramAlerts.map((a) =>
      a.id === payload.alertId ? { ...a, resolved: true } : a
    ),
  };
}

export function handleStartHousekeepingTask(
  state: AppState,
  payload: { taskId: string },
  nowIso = new Date().toISOString()
): AppState {
  return {
    ...state,
    housekeepingTasks: state.housekeepingTasks.map((t) =>
      t.id === payload.taskId
        ? { ...t, cleaningStartedAt: t.cleaningStartedAt ?? nowIso }
        : t
    ),
  };
}

export function handleFinishHousekeepingTask(
  state: AppState,
  payload: { taskId: string },
  nowIso = new Date().toISOString()
): AppState {
  const task = state.housekeepingTasks.find((t) => t.id === payload.taskId);
  if (!task) return state;

  const nextRooms = state.physicalRooms.map((r) => {
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
    ...state,
    physicalRooms: nextRooms,
    housekeepingTasks: state.housekeepingTasks.map((t) =>
      t.id === payload.taskId
        ? {
            ...t,
            status: 'approved' as const,
            maidCompletedAt: formatTashkentHm(),
          }
        : t
    ),
    auditLog: [
      {
        id: makeId('aud'),
        propertyId: state.propertyId,
        timestamp: nowIso,
        actor: state.adminName,
        action: 'Уборка завершена (Чисто)',
        diff: `${task.roomLabel} → Свободно на Шахматке`,
        reason: 'Live Housekeeping Board',
      },
      ...state.auditLog,
    ],
  };
}

export function handleAddLostFound(
  state: AppState,
  params: AddLostFoundPayload,
  todayIso = getTashkentTodayIso()
): AppState {
  return {
    ...state,
    lostFoundItems: [
      {
        id: makeId('lf'),
        propertyId: state.propertyId,
        itemName: params.itemName.trim(),
        foundLocation: params.foundLocation.trim(),
        guestName: params.guestName?.trim() || undefined,
        foundDate: todayIso,
        status: 'stored',
        notes: params.notes.trim(),
      },
      ...(state.lostFoundItems ?? []),
    ],
  };
}

export function handleResolveLostFound(state: AppState, payload: { id: string }): AppState {
  return {
    ...state,
    lostFoundItems: (state.lostFoundItems ?? []).map((item) =>
      item.id === payload.id ? { ...item, status: 'returned' as const } : item
    ),
  };
}

export function handleUpsertGuestProfile(
  state: AppState,
  params: UpsertGuestProfilePayload,
  todayIso = getTashkentTodayIso()
): AppState {
  const passportClean = params.passportNo.trim().toUpperCase();
  const idx = state.guestProfiles.findIndex(
    (p) => p.passportNo.toUpperCase() === passportClean
  );
  if (idx >= 0) {
    const next = [...state.guestProfiles];
    next[idx] = {
      ...next[idx],
      fullName: params.fullName.trim() || next[idx].fullName,
      citizenship: params.citizenship.trim().toUpperCase() || next[idx].citizenship,
      phone: params.phone?.trim() || next[idx].phone,
      tag: params.tag,
      notes: params.notes.trim(),
    };
    return { ...state, guestProfiles: next };
  }
  return {
    ...state,
    guestProfiles: [
      {
        id: makeId('prof'),
        propertyId: state.propertyId,
        fullName: params.fullName.trim(),
        passportNo: passportClean,
        citizenship: params.citizenship.trim().toUpperCase() || 'UZB',
        phone: params.phone?.trim() || undefined,
        visitsCount: 1,
        tag: params.tag,
        notes: params.notes.trim(),
        lastVisitDate: todayIso,
      },
      ...state.guestProfiles,
    ],
  };
}

export function handleAddMailInquiry(
  state: AppState,
  payload: Omit<MailInquiry, 'id' | 'propertyId' | 'handled'>
): AppState {
  return {
    ...state,
    mailInbox: [
      {
        id: makeId('mail'),
        propertyId: state.propertyId,
        handled: false,
        ...payload,
      },
      ...(state.mailInbox ?? []),
    ],
  };
}

export function handleDismissMailInquiry(state: AppState, payload: { id: string }): AppState {
  return {
    ...state,
    mailInbox: (state.mailInbox ?? []).map((m) =>
      m.id === payload.id ? { ...m, handled: true } : m
    ),
  };
}
