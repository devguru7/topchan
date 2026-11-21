import type {
  AppState,
  BookingGroup,
  CashPocketId,
  LedgerEntry,
  ParsedCommand,
} from '../../types/ops';
import { calcBookingTotals, formatUsd, round2 } from '../../utils/math';
import { addDaysIso, formatTashkentHm, getTashkentTodayIso } from '../../utils/time';
import { findRoomConflicts } from '../../utils/availability';
import {
  makeId,
  type AddPaymentPayload,
  type CheckInPayload,
  type CheckOutPayload,
  type ExtendOrMovePayload,
} from '../types';

export function handleCheckIn(
  state: AppState,
  payload: CheckInPayload,
  nowIso = new Date().toISOString(),
  todayIso = getTashkentTodayIso()
): AppState {
  const room = state.physicalRooms.find((r) => r.id === payload.roomId);
  if (!room) return state;

  const fromDate = payload.fromDate || todayIso;
  const nights = Math.max(1, Math.round(payload.nights));
  const toDate = addDaysIso(fromDate, nights);

  // Overbooking guard: block conflicting stays on the same room/bed
  const conflicts = findRoomConflicts(
    state.bookings,
    payload.roomId,
    payload.bedId,
    fromDate,
    toDate
  );
  if (conflicts.length > 0) {
    return state;
  }

  const bookingId = makeId('bkg');
  const bed = room.beds?.find((b) => b.id === payload.bedId);
  const roomLabel = bed ? `${room.code} · Койка ${bed.label}` : room.code;
  const stayUsd = round2(nights * payload.nightlyRateUsd);

  const ledgerEntries: LedgerEntry[] = [
    {
      id: makeId('led'),
      timestamp: nowIso,
      type: 'charge',
      category: 'accommodation',
      label: `Проживание ${roomLabel} (${nights} н. × $${payload.nightlyRateUsd})`,
      amountUsd: stayUsd,
      actor: state.adminName,
    },
  ];

  const nextPockets = state.pockets.map((p) => ({ ...p }));
  const nextTransactions = [...state.transactions];

  if (payload.initialPayment && payload.initialPayment.originalAmount > 0) {
    const pay = payload.initialPayment;
    ledgerEntries.push({
      id: makeId('led'),
      timestamp: nowIso,
      type: 'payment',
      category: 'payment',
      label: `Оплата при заезде (${pay.originalCurrency})`,
      amountUsd: round2(pay.amountUsdEquivalent),
      originalCurrency: pay.originalCurrency,
      originalAmount: pay.originalAmount,
      pocketId: pay.pocketId,
      actor: state.adminName,
    });
    const pocket = nextPockets.find((p) => p.id === pay.pocketId);
    if (pocket) {
      pocket.balance = round2(pocket.balance + pay.originalAmount);
    }
    nextTransactions.unshift({
      id: makeId('tx'),
      propertyId: state.propertyId,
      timestamp: nowIso,
      pocketId: pay.pocketId,
      direction: 'in',
      currency: pay.originalCurrency,
      amount: pay.originalAmount,
      label: `${roomLabel} · ${payload.guests[0]?.fullName ?? 'Гость'}`,
      bookingId,
      receiptVerified: pay.pocketId === 'transfer',
      actor: state.adminName,
    });
  }

  if (payload.changeUzsOut && payload.changeUzsOut > 0) {
    const uzsPocket = nextPockets.find((p) => p.id === 'cash_uzs');
    if (uzsPocket) {
      uzsPocket.balance = Math.round(uzsPocket.balance - payload.changeUzsOut);
    }
    nextTransactions.unshift({
      id: makeId('tx'),
      propertyId: state.propertyId,
      timestamp: nowIso,
      pocketId: 'cash_uzs',
      direction: 'out',
      currency: 'UZS',
      amount: payload.changeUzsOut,
      label: `Сдача сумами · ${roomLabel}`,
      bookingId,
      actor: state.adminName,
    });
  }

  const isOccupiedToday = fromDate <= todayIso && toDate > todayIso;

  const newBooking: BookingGroup = {
    id: bookingId,
    propertyId: state.propertyId,
    bnovoId: `BN-${Math.floor(49000 + Math.random() * 9000)}`,
    status: 'active',
    checkOutTime: '12:00',
    checkingOutToday: toDate === todayIso,
    source: payload.source,
    notes: payload.notes,
    createdAt: nowIso,
    segments: [
      {
        id: makeId('seg'),
        roomId: payload.roomId,
        bedId: payload.bedId,
        fromDate,
        toDate,
        nights,
        nightlyRateUsd: payload.nightlyRateUsd,
      },
    ],
    guests: payload.guests.map((g) => ({ ...g, id: makeId('g') })),
    ledgerEntries,
  };

  const nextRooms = isOccupiedToday
    ? state.physicalRooms.map((r) => {
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
      })
    : state.physicalRooms;

  const nextProfiles = [...state.guestProfiles];
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
        id: makeId('prof'),
        propertyId: state.propertyId,
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
    ...state,
    physicalRooms: nextRooms,
    bookings: [newBooking, ...state.bookings],
    guestProfiles: nextProfiles,
    pockets: nextPockets,
    transactions: nextTransactions,
    auditLog: [
      {
        id: makeId('aud'),
        propertyId: state.propertyId,
        timestamp: nowIso,
        actor: state.adminName,
        action: 'Заселение (Check-in)',
        diff: `${roomLabel} · ${payload.guests[0]?.fullName ?? 'Гость'} (${nights} н., ${fromDate} → ${toDate})`,
        reason: `Источник: ${payload.source}`,
      },
      ...state.auditLog,
    ],
  };
}

export function handleAddLedgerCharge(
  state: AppState,
  payload: {
    bookingId: string;
    category: LedgerEntry['category'];
    label: string;
    amountUsd: number;
    options?: { startLaundryMode?: 'fast' | 'medium' };
  },
  nowIso = new Date().toISOString()
): AppState {
  const bkg = state.bookings.find((b) => b.id === payload.bookingId);
  if (!bkg) return state;

  const lastSeg = bkg.segments[bkg.segments.length - 1];
  const room = state.physicalRooms.find((r) => r.id === lastSeg?.roomId);
  const bed = room?.beds?.find((b) => b.id === lastSeg?.bedId);
  const roomLabel = room ? (bed ? `${room.code} ${bed.label}` : room.code) : 'Номер';

  const nextBookings = state.bookings.map((b) =>
    b.id === payload.bookingId
      ? {
          ...b,
          ledgerEntries: [
            ...b.ledgerEntries,
            {
              id: makeId('led'),
              timestamp: nowIso,
              type: 'charge' as const,
              category: payload.category,
              label: payload.label,
              amountUsd: round2(payload.amountUsd),
              actor: state.adminName,
            },
          ],
        }
      : b
  );

  let nextLaundry = state.laundryJobs;
  if (payload.options?.startLaundryMode) {
    const secs = payload.options.startLaundryMode === 'fast' ? 22 * 60 : 55 * 60;
    nextLaundry = [
      {
        id: makeId('lnd'),
        propertyId: state.propertyId,
        bookingId: payload.bookingId,
        guestName: bkg.guests[0]?.fullName ?? 'Гость',
        roomLabel,
        mode: payload.options.startLaundryMode,
        priceUsd: payload.amountUsd,
        totalSeconds: secs,
        remainingSeconds: secs,
        status: 'running',
        startedAt: nowIso,
      },
      ...state.laundryJobs,
    ];
  }

  return {
    ...state,
    bookings: nextBookings,
    laundryJobs: nextLaundry,
    auditLog: [
      {
        id: makeId('aud'),
        propertyId: state.propertyId,
        timestamp: nowIso,
        actor: state.adminName,
        action: 'Доп. начисление',
        diff: `+${formatUsd(payload.amountUsd)} (${payload.label}) · ${roomLabel}`,
        reason: 'Добавлено из карточки гостя',
      },
      ...state.auditLog,
    ],
  };
}

export function handleAddPayment(
  state: AppState,
  params: AddPaymentPayload,
  nowIso = new Date().toISOString()
): AppState {
  const bkg = state.bookings.find((b) => b.id === params.bookingId);
  if (!bkg) return state;

  const lastSeg = bkg.segments[bkg.segments.length - 1];
  const room = state.physicalRooms.find((r) => r.id === lastSeg?.roomId);
  const roomLabel = room?.code ?? 'Номер';
  const pocketName = state.pockets.find((p) => p.id === params.pocketId)?.name ?? params.pocketId;

  const nextBookings = state.bookings.map((b) =>
    b.id === params.bookingId
      ? {
          ...b,
          ledgerEntries: [
            ...b.ledgerEntries,
            {
              id: makeId('led'),
              timestamp: nowIso,
              type: 'payment' as const,
              category: 'payment' as const,
              label: `Оплата: ${pocketName}`,
              amountUsd: round2(params.usdEquivalent),
              originalCurrency: params.currency,
              originalAmount: params.originalAmount,
              pocketId: params.pocketId,
              actor: state.adminName,
            },
          ],
        }
      : b
  );

  const nextPockets = state.pockets.map((p) => {
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
      id: makeId('tx'),
      propertyId: state.propertyId,
      timestamp: nowIso,
      pocketId: params.pocketId,
      direction: 'in' as const,
      currency: params.currency,
      amount: params.originalAmount,
      label: `${roomLabel} · ${bkg.guests[0]?.fullName ?? 'Гость'}`,
      bookingId: params.bookingId,
      receiptVerified: params.receiptVerified ?? params.pocketId === 'transfer',
      actor: state.adminName,
    },
    ...state.transactions,
  ];

  if (params.changeUzsOut && params.changeUzsOut > 0) {
    nextTransactions.unshift({
      id: makeId('tx'),
      propertyId: state.propertyId,
      timestamp: nowIso,
      pocketId: 'cash_uzs',
      direction: 'out',
      currency: 'UZS',
      amount: params.changeUzsOut,
      label: `Сдача сумами · ${roomLabel}`,
      bookingId: params.bookingId,
      actor: state.adminName,
    });
  }

  return {
    ...state,
    bookings: nextBookings,
    pockets: nextPockets,
    transactions: nextTransactions,
    auditLog: [
      {
        id: makeId('aud'),
        propertyId: state.propertyId,
        timestamp: nowIso,
        actor: state.adminName,
        action: 'Оплата в фолио',
        diff: `+${formatUsd(params.usdEquivalent)} (${pocketName}) · ${roomLabel}`,
        reason: 'Оплата принята и проведена в кассу',
      },
      ...state.auditLog,
    ],
  };
}

export function handleExtendOrMoveStay(
  state: AppState,
  params: ExtendOrMovePayload,
  nowIso = new Date().toISOString(),
  todayIso = getTashkentTodayIso()
): AppState {
  const bkg = state.bookings.find((b) => b.id === params.bookingId);
  if (!bkg) return state;
  const lastSeg = bkg.segments[bkg.segments.length - 1];
  if (!lastSeg) return state;

  const targetRoomId = params.mode === 'move' && params.newRoomId ? params.newRoomId : lastSeg.roomId;
  const targetBedId = params.mode === 'move' ? params.newBedId : lastSeg.bedId;
  const fromDate = params.mode === 'move' ? todayIso : lastSeg.toDate;
  const nights = Math.max(1, Math.round(params.extraNights));
  const toDate = addDaysIso(fromDate, nights);

  // Overbooking guard excluding the current booking
  const conflicts = findRoomConflicts(
    state.bookings,
    targetRoomId,
    targetBedId,
    fromDate,
    toDate,
    params.bookingId
  );
  if (conflicts.length > 0) {
    return state;
  }

  const targetRoom = state.physicalRooms.find((r) => r.id === targetRoomId);
  const targetBed = targetRoom?.beds?.find((b) => b.id === targetBedId);
  const targetLabel = targetRoom
    ? targetBed
      ? `${targetRoom.code} ${targetBed.label}`
      : targetRoom.code
    : 'Номер';

  const chargeUsd = round2(nights * params.nightlyRateUsd);

  let nextRooms = state.physicalRooms;
  let nextHk = state.housekeepingTasks;

  if (params.mode === 'move' && (targetRoomId !== lastSeg.roomId || targetBedId !== lastSeg.bedId)) {
    const oldRoom = state.physicalRooms.find((r) => r.id === lastSeg.roomId);
    nextRooms = state.physicalRooms.map((r) => {
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
          id: makeId('hk'),
          propertyId: state.propertyId,
          roomId: oldRoom.id,
          bedId: lastSeg.bedId,
          roomLabel: lastSeg.bedId
            ? `${oldRoom.code} ${oldRoom.beds?.find((b) => b.id === lastSeg.bedId)?.label ?? ''}`
            : oldRoom.code,
          status: 'dirty',
          createdAt: nowIso,
          notes: 'Переселение гостя — требуется уборка',
        },
        ...state.housekeepingTasks,
      ];
    }
  }

  const nextBookings = state.bookings.map((b) =>
    b.id === params.bookingId
      ? {
          ...b,
          checkingOutToday: false,
          segments: [
            ...b.segments,
            {
              id: makeId('seg'),
              roomId: targetRoomId,
              bedId: targetBedId,
              fromDate,
              toDate,
              nights,
              nightlyRateUsd: params.nightlyRateUsd,
            },
          ],
          ledgerEntries: [
            ...b.ledgerEntries,
            {
              id: makeId('led'),
              timestamp: nowIso,
              type: 'charge' as const,
              category: 'accommodation' as const,
              label:
                params.mode === 'move'
                  ? `Переселение в ${targetLabel} (${nights} н. × $${params.nightlyRateUsd})`
                  : `Продление ${targetLabel} (+${nights} н. × $${params.nightlyRateUsd})`,
              amountUsd: chargeUsd,
              actor: state.adminName,
            },
          ],
        }
      : b
  );

  return {
    ...state,
    physicalRooms: nextRooms,
    housekeepingTasks: nextHk,
    bookings: nextBookings,
    auditLog: [
      {
        id: makeId('aud'),
        propertyId: state.propertyId,
        timestamp: nowIso,
        actor: state.adminName,
        action: params.mode === 'move' ? 'Переселение' : 'Продление',
        diff: `${targetLabel} (+${nights} н., +${formatUsd(chargeUsd)})`,
        reason: 'Изменение сегмента проживания',
      },
      ...state.auditLog,
    ],
  };
}

export function handleCheckOut(
  state: AppState,
  payload: CheckOutPayload,
  nowIso = new Date().toISOString(),
  timeHm = formatTashkentHm()
): AppState {
  const bkg = state.bookings.find((b) => b.id === payload.bookingId);
  if (!bkg) return state;

  const lastSeg = bkg.segments[bkg.segments.length - 1];
  const room = state.physicalRooms.find((r) => r.id === lastSeg?.roomId);
  const bed = room?.beds?.find((b) => b.id === lastSeg?.bedId);
  const roomLabel = room ? (bed ? `${room.code} ${bed.label}` : room.code) : 'Номер';
  const primaryGuest = bkg.guests[0]?.fullName ?? 'Гость';
  const financials = calcBookingTotals(bkg);

  const nextRooms = state.physicalRooms.map((r) => {
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

  const nextBookings = state.bookings.map((b) =>
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
      id: makeId('hk'),
      propertyId: state.propertyId,
      roomId: lastSeg?.roomId ?? '',
      bedId: lastSeg?.bedId,
      roomLabel,
      status: 'dirty' as const,
      createdAt: nowIso,
      notes: `Выселение: ${primaryGuest}. Требуется уборка и смена белья.`,
    },
    ...state.housekeepingTasks,
  ];

  let nextLuggage = state.luggageItems;
  if (payload.createLuggage) {
    const nextNum = 14 + state.luggageItems.length;
    const tagCode = `#B${nextNum}`;
    nextLuggage = [
      {
        id: makeId('lug'),
        propertyId: state.propertyId,
        tagCode,
        guestName: primaryGuest,
        bagsCount: Math.max(1, payload.createLuggage.bagsCount),
        flightTime: payload.createLuggage.flightTime || '22:00',
        notes: payload.createLuggage.notes || `Оставлен при выезде из ${roomLabel}`,
        status: 'stored' as const,
        createdAt: nowIso,
      },
      ...state.luggageItems,
    ];
  }

  const reviewAlert = {
    id: makeId('tg'),
    propertyId: state.propertyId,
    timestamp: timeHm,
    source: 'Review Booster' as const,
    severity: 'success' as const,
    title: `Review Booster (2 этапа): ${primaryGuest} выселен`,
    body: `Гость выехал из ${roomLabel}. Этап 1 — уточните оценку (1–5★) лично, чтобы решить замечания приватно. При 5★ отправьте ссылку Google Maps / Booking.`,
    draftReply: `Здравствуйте, ${primaryGuest}! Спасибо, что выбрали Topchan Hostel в Ташкенте. Как вам проживание от 1 до 5? Если всё понравилось на 5★, будем очень благодарны за отзыв на Google Maps: https://g.page/r/topchan-hostel-review. Счастливого пути!`,
    resolved: false,
    actions: [
      { id: makeId('act'), label: 'Скопировать приглашение', kind: 'copy_draft' as const },
      { id: makeId('act'), label: 'Отправлено', kind: 'dismiss' as const },
    ],
  };

  return {
    ...state,
    physicalRooms: nextRooms,
    bookings: nextBookings,
    housekeepingTasks: nextHk,
    luggageItems: nextLuggage,
    telegramAlerts: [reviewAlert, ...state.telegramAlerts],
    auditLog: [
      {
        id: makeId('aud'),
        propertyId: state.propertyId,
        timestamp: nowIso,
        actor: state.adminName,
        action: financials.debtUsd > 0 ? 'Выселение с долгом (Override)' : 'Выселение (Check-out)',
        diff: `${roomLabel} → Уборка · Долг: ${formatUsd(financials.debtUsd)}`,
        reason:
          payload.debtOverrideReason ||
          'Стандартный check-out (ключ сдан, Bnovo/E-mehmon закрыты)',
      },
      ...state.auditLog,
    ],
  };
}

export function handleCommitParsedCommand(
  state: AppState,
  cmd: ParsedCommand,
  nowIso = new Date().toISOString(),
  todayIso = getTashkentTodayIso()
): AppState {
  if (!cmd.roomId) return state;
  const room = state.physicalRooms.find((r) => r.id === cmd.roomId);
  if (!room) return state;

  const fromDate = todayIso;
  const nights = Math.max(1, cmd.nights);
  const toDate = addDaysIso(fromDate, nights);

  const conflicts = findRoomConflicts(state.bookings, cmd.roomId, cmd.bedId, fromDate, toDate);
  if (conflicts.length > 0) {
    return state;
  }

  const bookingId = makeId('bkg');
  const stayUsd = round2(nights * cmd.nightlyRateUsd);

  const ledgerEntries: LedgerEntry[] = [
    {
      id: makeId('led'),
      timestamp: nowIso,
      type: 'charge',
      category: 'accommodation',
      label: `Проживание ${cmd.roomLabel} (${nights} н. × $${cmd.nightlyRateUsd})`,
      amountUsd: stayUsd,
      actor: state.adminName,
    },
  ];

  const nextLaundry = [...state.laundryJobs];

  for (const extra of cmd.extras) {
    ledgerEntries.push({
      id: makeId('led'),
      timestamp: nowIso,
      type: 'charge',
      category: extra.type,
      label: extra.label,
      amountUsd: extra.priceUsd,
      actor: state.adminName,
    });
    if (extra.type === 'laundry_fast' || extra.type === 'laundry_medium') {
      const secs = extra.type === 'laundry_fast' ? 22 * 60 : 55 * 60;
      nextLaundry.unshift({
        id: makeId('lnd'),
        propertyId: state.propertyId,
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

  const nextPockets = state.pockets.map((p) => ({ ...p }));
  const nextTransactions = [...state.transactions];

  if (cmd.paidAmount > 0) {
    const pocketId: CashPocketId =
      cmd.paidCurrency === 'USD'
        ? 'cash_usd'
        : cmd.paidCurrency === 'EUR'
          ? 'cash_eur'
          : 'cash_uzs';
    const settledUsd = Math.min(
      cmd.totalUsd,
      cmd.paidCurrency === 'USD' ? cmd.paidAmount : cmd.totalUsd
    );
    ledgerEntries.push({
      id: makeId('led'),
      timestamp: nowIso,
      type: 'payment',
      category: 'payment',
      label: `Оплата (${cmd.paidCurrency} · Автопилот)`,
      amountUsd: round2(settledUsd),
      originalCurrency: cmd.paidCurrency,
      originalAmount: cmd.paidAmount,
      pocketId,
      actor: state.adminName,
    });
    const pIn = nextPockets.find((p) => p.id === pocketId);
    if (pIn) pIn.balance = round2(pIn.balance + cmd.paidAmount);
    nextTransactions.unshift({
      id: makeId('tx'),
      propertyId: state.propertyId,
      timestamp: nowIso,
      pocketId,
      direction: 'in',
      currency: cmd.paidCurrency,
      amount: cmd.paidAmount,
      label: `${cmd.roomLabel} · ${cmd.guestName} (автопилот)`,
      bookingId,
      actor: state.adminName,
    });
  }

  if (cmd.changeUzs > 0) {
    const pUzs = nextPockets.find((p) => p.id === 'cash_uzs');
    if (pUzs) pUzs.balance = Math.round(pUzs.balance - cmd.changeUzs);
    nextTransactions.unshift({
      id: makeId('tx'),
      propertyId: state.propertyId,
      timestamp: nowIso,
      pocketId: 'cash_uzs',
      direction: 'out',
      currency: 'UZS',
      amount: cmd.changeUzs,
      label: `Сдача сумами (курс ${state.currency.exRate}) · ${cmd.roomLabel}`,
      bookingId,
      actor: state.adminName,
    });
  } else if (cmd.changeUsd > 0) {
    const pUsd = nextPockets.find((p) => p.id === 'cash_usd');
    if (pUsd) pUsd.balance = round2(pUsd.balance - cmd.changeUsd);
    nextTransactions.unshift({
      id: makeId('tx'),
      propertyId: state.propertyId,
      timestamp: nowIso,
      pocketId: 'cash_usd',
      direction: 'out',
      currency: 'USD',
      amount: cmd.changeUsd,
      label: `Сдача долларами · ${cmd.roomLabel}`,
      bookingId,
      actor: state.adminName,
    });
  }

  const newBooking: BookingGroup = {
    id: bookingId,
    propertyId: state.propertyId,
    bnovoId: `BN-${Math.floor(50000 + Math.random() * 9000)}`,
    status: 'active',
    checkOutTime: '12:00',
    checkingOutToday: false,
    source: 'Walk-in',
    notes: `Создано через Автопилот: "${cmd.raw}"`,
    createdAt: nowIso,
    segments: [
      {
        id: makeId('seg'),
        roomId: cmd.roomId,
        bedId: cmd.bedId,
        fromDate,
        toDate,
        nights,
        nightlyRateUsd: cmd.nightlyRateUsd,
      },
    ],
    guests: [
      {
        id: makeId('g'),
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

  const nextRooms = state.physicalRooms.map((r) => {
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
    ...state,
    physicalRooms: nextRooms,
    bookings: [newBooking, ...state.bookings],
    pockets: nextPockets,
    transactions: nextTransactions,
    laundryJobs: nextLaundry,
    auditLog: [
      {
        id: makeId('aud'),
        propertyId: state.propertyId,
        timestamp: nowIso,
        actor: state.adminName,
        action: 'Автопилот (Zero-Typing)',
        diff: `${cmd.roomLabel} · ${cmd.guestName} · ${formatUsd(cmd.totalUsd)}`,
        reason: cmd.raw,
      },
      ...state.auditLog,
    ],
  };
}

export function handleMarkEmehmonRegistered(
  state: AppState,
  payload: { bookingId: string; guestId: string }
): AppState {
  return {
    ...state,
    bookings: state.bookings.map((b) =>
      b.id === payload.bookingId
        ? {
            ...b,
            guests: b.guests.map((g) =>
              g.id === payload.guestId ? { ...g, emehmonRegistered: true } : g
            ),
          }
        : b
    ),
  };
}
