import type {
  AppState,
  BookingGroup,
  CashPocketId,
  CurrencyCode,
  LedgerEntry,
  ParsedCommand,
} from '../../types/ops';
import { calcBookingTotals, calcMonthlyTouristTaxUzs, formatUsd, formatUzs, round2 } from '../../utils/math';
import { addDaysIso, diffDaysIso, formatTashkentHm, getTashkentTodayIso } from '../../utils/time';
import { findRoomConflicts } from '../../utils/availability';
import {
  makeId,
  type AddPaymentPayload,
  type CheckInPayload,
  type CheckOutPayload,
  type CompleteNightAuditPayload,
  type ExtendOrMovePayload,
  type IssueRefundPayload,
  type MoveOrResizeSegmentPayload,
  type SplitStayPayload,
} from '../types';

export function validateFemaleOnlyRoom(
  state: AppState,
  roomId: string,
  guests: Array<{ fullName: string; sex?: 'M' | 'F' }>
): string | null {
  const room = state.physicalRooms.find((r) => r.id === roomId);
  if (!room) return null;
  const cat = state.roomCategories.find((c) => c.id === room.categoryId);
  if (!cat?.femaleOnly) return null;
  const maleGuest = guests.find((g) => g.sex === 'M');
  if (maleGuest) {
    return `Женский дорм (${room.code}) предназначен только для женщин — гость ${maleGuest.fullName} (M) не может быть размещён сюда.`;
  }
  return null;
}

export function isPocketCurrencyMatch(pocketId: CashPocketId, currency: CurrencyCode): boolean {
  if (pocketId === 'safe') return false;
  if (pocketId === 'cash_usd') return currency === 'USD';
  if (pocketId === 'cash_eur') return currency === 'EUR';
  if (pocketId === 'cash_uzs' || pocketId === 'terminal' || pocketId === 'transfer') {
    return currency === 'UZS';
  }
  return false;
}

export function validateGuestPayment(
  state: AppState,
  pocketId: CashPocketId,
  currency: CurrencyCode,
  originalAmount: number,
  changeUzsOut = 0
): string | null {
  if (pocketId === 'safe') {
    return 'Карман «Сейф» предназначен только для инкассации, а не для оплаты гостя.';
  }
  if (!isPocketCurrencyMatch(pocketId, currency)) {
    return `Валюта ${currency} не соответствует выбранному карману кассы.`;
  }
  if (!Number.isFinite(originalAmount) || originalAmount <= 0) {
    return 'Сумма оплаты должна быть больше нуля.';
  }
  const cleanChange = Math.max(0, Math.round(changeUzsOut));
  if (cleanChange > 0 && (pocketId === 'terminal' || pocketId === 'transfer')) {
    return 'Выдача наличной сдачи UZS невозможна при безналичной оплате (терминал/перевод).';
  }
  if (cleanChange > 0) {
    const uzsPocket = state.pockets.find((p) => p.id === 'cash_uzs');
    const availableUzs =
      (uzsPocket?.balance ?? 0) + (pocketId === 'cash_uzs' ? Math.round(originalAmount) : 0);
    if (cleanChange > availableUzs) {
      return `Недостаточно UZS в ящике ресепшн для выдачи сдачи (${formatUzs(cleanChange)} > ${formatUzs(availableUzs)}).`;
    }
  }
  return null;
}

export function validateCheckOutGuards(
  state: AppState,
  payload: CheckOutPayload
): string | null {
  const bkg = state.bookings.find((b) => b.id === payload.bookingId);
  if (!bkg || bkg.status !== 'active') {
    return 'Бронь не найдена или уже закрыта.';
  }
  const financials = calcBookingTotals(bkg);
  const role = payload.actorRole ?? state.adminRole ?? 'senior_admin';

  if (financials.debtUsd > 0) {
    if (role !== 'owner' && role !== 'senior_admin') {
      return 'Закрытие с неоплаченным долгом доступно только старшему администратору или владельцу.';
    }
    if (!payload.debtOverrideReason || payload.debtOverrideReason.trim().length < 8) {
      return 'Для выселения с долгом укажите подробную причину (минимум 8 символов) для аудит-лога.';
    }
  }

  const unregisteredForeigner = bkg.guests.find((g) => g.isForeigner && !g.emehmonRegistered);
  if (unregisteredForeigner) {
    if (!payload.emehmonOverrideReason || payload.emehmonOverrideReason.trim().length < 8) {
      return `Иностранный гость ${unregisteredForeigner.fullName} не зарегистрирован в E-mehmon. Оформите регистрацию или укажите причину исключения (минимум 8 символов).`;
    }
  }

  return null;
}

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

  // Female-only dorm guard (Fem Dorm: Fem-1..4)
  if (validateFemaleOnlyRoom(state, payload.roomId, payload.guests)) {
    return state;
  }

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

  const changeUzsOut = Math.max(0, Math.round(payload.changeUzsOut ?? 0));

  if (payload.initialPayment && payload.initialPayment.originalAmount > 0) {
    const pay = payload.initialPayment;
    const payError = validateGuestPayment(
      state,
      pay.pocketId,
      pay.originalCurrency,
      pay.originalAmount,
      changeUzsOut
    );
    if (payError) {
      return state;
    }
  } else if (changeUzsOut > 0) {
    // Cannot dispense change without an initial payment
    return state;
  }

  const nextPockets = state.pockets.map((p) => {
    const pay = payload.initialPayment;
    const added =
      pay && pay.originalAmount > 0 && p.id === pay.pocketId ? pay.originalAmount : 0;
    const changeDeducted = p.id === 'cash_uzs' ? changeUzsOut : 0;
    if (added === 0 && changeDeducted === 0) return p;
    const nextBalance =
      p.currency === 'UZS'
        ? Math.round(p.balance + added - changeDeducted)
        : round2(p.balance + added - changeDeducted);
    return { ...p, balance: nextBalance };
  });

  const nextTransactions = [...state.transactions];

  if (payload.initialPayment && payload.initialPayment.originalAmount > 0) {
    const pay = payload.initialPayment;
    // Net effective folio payment so returning cash change never produces fake overpayment
    let effectivePaymentUsd = round2(pay.amountUsdEquivalent);
    if (changeUzsOut > 0) {
      if (effectivePaymentUsd > stayUsd) {
        effectivePaymentUsd = stayUsd;
      } else if (pay.originalCurrency === 'UZS' && state.currency.accRate > 0) {
        effectivePaymentUsd = Math.max(
          0,
          round2((pay.originalAmount - changeUzsOut) / state.currency.accRate)
        );
      } else if (state.currency.exRate > 0) {
        effectivePaymentUsd = Math.max(
          0,
          round2(effectivePaymentUsd - changeUzsOut / state.currency.exRate)
        );
      }
    }

    ledgerEntries.push({
      id: makeId('led'),
      timestamp: nowIso,
      type: 'payment',
      category: 'payment',
      label:
        changeUzsOut > 0
          ? `Оплата при заезде (${pay.originalCurrency}, сдача ${formatUzs(changeUzsOut)})`
          : `Оплата при заезде (${pay.originalCurrency})`,
      amountUsd: effectivePaymentUsd,
      originalCurrency: pay.originalCurrency,
      originalAmount: pay.originalAmount,
      pocketId: pay.pocketId,
      actor: state.adminName,
    });

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

  if (changeUzsOut > 0) {
    nextTransactions.unshift({
      id: makeId('tx'),
      propertyId: state.propertyId,
      timestamp: nowIso,
      pocketId: 'cash_uzs',
      direction: 'out',
      currency: 'UZS',
      amount: changeUzsOut,
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

  const changeUzsOut = Math.max(0, Math.round(params.changeUzsOut ?? 0));
  const payError = validateGuestPayment(
    state,
    params.pocketId,
    params.currency,
    params.originalAmount,
    changeUzsOut
  );
  if (payError) {
    return state;
  }

  const lastSeg = bkg.segments[bkg.segments.length - 1];
  const room = state.physicalRooms.find((r) => r.id === lastSeg?.roomId);
  const roomLabel = room?.code ?? 'Номер';
  const pocketName = state.pockets.find((p) => p.id === params.pocketId)?.name ?? params.pocketId;

  // Record net effective payment on folio when cash change is returned so debtUsd stays exact (never fake overpayment)
  const currentDebt = calcBookingTotals(bkg).debtUsd;
  let effectivePaymentUsd = round2(params.usdEquivalent);
  if (changeUzsOut > 0) {
    if (currentDebt > 0 && effectivePaymentUsd > currentDebt) {
      effectivePaymentUsd = currentDebt;
    } else if (params.currency === 'UZS' && state.currency.accRate > 0) {
      effectivePaymentUsd = Math.max(
        0,
        round2((params.originalAmount - changeUzsOut) / state.currency.accRate)
      );
    } else if (state.currency.exRate > 0) {
      effectivePaymentUsd = Math.max(
        0,
        round2(effectivePaymentUsd - changeUzsOut / state.currency.exRate)
      );
    }
  }

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
              label:
                changeUzsOut > 0
                  ? `Оплата: ${pocketName} (сдача ${formatUzs(changeUzsOut)})`
                  : `Оплата: ${pocketName}`,
              amountUsd: effectivePaymentUsd,
              originalCurrency: params.currency,
              originalAmount: params.originalAmount,
              pocketId: params.pocketId,
              actor: state.adminName,
            },
          ],
        }
      : b
  );

  // Single-pass pocket balance computation (handles cash_uzs + changeUzsOut simultaneously!)
  const nextPockets = state.pockets.map((p) => {
    const added = p.id === params.pocketId ? params.originalAmount : 0;
    const changeDeducted = p.id === 'cash_uzs' ? changeUzsOut : 0;
    if (added === 0 && changeDeducted === 0) return p;
    const nextBalance =
      p.currency === 'UZS'
        ? Math.round(p.balance + added - changeDeducted)
        : round2(p.balance + added - changeDeducted);
    return { ...p, balance: nextBalance };
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

  if (changeUzsOut > 0) {
    nextTransactions.unshift({
      id: makeId('tx'),
      propertyId: state.propertyId,
      timestamp: nowIso,
      pocketId: 'cash_uzs',
      direction: 'out',
      currency: 'UZS',
      amount: changeUzsOut,
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
        diff: `+${formatUsd(effectivePaymentUsd)} (${pocketName})${changeUzsOut > 0 ? ` · сдача ${formatUzs(changeUzsOut)}` : ''} · ${roomLabel}`,
        reason: 'Оплата принята и проведена в кассу',
      },
      ...state.auditLog,
    ],
  };
}

export function handleIssueRefund(
  state: AppState,
  params: IssueRefundPayload,
  nowIso = new Date().toISOString()
): AppState {
  const bkg = state.bookings.find((b) => b.id === params.bookingId);
  if (!bkg) return state;
  if (params.amountOriginal <= 0 || params.amountUsd <= 0) return state;

  const pocket = state.pockets.find((p) => p.id === params.pocketId);
  if (!pocket || pocket.currency !== params.currency || pocket.balance < params.amountOriginal) {
    return state;
  }

  const lastSeg = bkg.segments[bkg.segments.length - 1];
  const room = state.physicalRooms.find((r) => r.id === lastSeg?.roomId);
  const roomLabel = room?.code ?? 'Номер';

  const nextPockets = state.pockets.map((p) =>
    p.id === params.pocketId
      ? {
          ...p,
          balance:
            p.currency === 'UZS'
              ? Math.round(p.balance - params.amountOriginal)
              : round2(p.balance - params.amountOriginal),
        }
      : p
  );

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
              label: `Возврат переплаты (${params.currency})`,
              amountUsd: -round2(params.amountUsd),
              originalCurrency: params.currency,
              originalAmount: -params.amountOriginal,
              pocketId: params.pocketId,
              actor: state.adminName,
            },
          ],
        }
      : b
  );

  return {
    ...state,
    pockets: nextPockets,
    bookings: nextBookings,
    transactions: [
      {
        id: makeId('tx'),
        propertyId: state.propertyId,
        timestamp: nowIso,
        pocketId: params.pocketId,
        direction: 'out',
        currency: params.currency,
        amount: params.amountOriginal,
        label: `Возврат переплаты · ${roomLabel} (${bkg.guests[0]?.fullName ?? 'Гость'})`,
        bookingId: params.bookingId,
        actor: state.adminName,
      },
      ...state.transactions,
    ],
    auditLog: [
      {
        id: makeId('aud'),
        propertyId: state.propertyId,
        timestamp: nowIso,
        actor: state.adminName,
        action: 'Возврат переплаты',
        diff: `-${formatUsd(params.amountUsd)} (${params.currency}) · ${roomLabel}`,
        reason: params.reason || 'Возврат остатка гостю при выселении',
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
  const guardError = validateCheckOutGuards(state, payload);
  if (guardError) return state;

  const bkg = state.bookings.find((b) => b.id === payload.bookingId);
  if (!bkg) return state;

  const primaryGuest = bkg.guests[0]?.fullName ?? 'Гость';
  const financials = calcBookingTotals(bkg);

  // Deduplicate ALL unique rooms/beds across every segment of this booking
  const uniqueUnits: Array<{ roomId: string; bedId?: string; label: string }> = [];
  const seenKeys = new Set<string>();
  for (const seg of bkg.segments) {
    const key = `${seg.roomId}:${seg.bedId ?? ''}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    const r = state.physicalRooms.find((rm) => rm.id === seg.roomId);
    const b = r?.beds?.find((bd) => bd.id === seg.bedId);
    const label = r ? (b ? `${r.code} ${b.label}` : r.code) : 'Номер';
    uniqueUnits.push({ roomId: seg.roomId, bedId: seg.bedId, label });
  }

  const primaryRoomLabel = uniqueUnits[uniqueUnits.length - 1]?.label ?? 'Номер';
  const allRoomsSummary = uniqueUnits.map((u) => u.label).join(', ');

  // Mark EVERY occupied room/bed across all segments as 'dirty'
  const nextRooms = state.physicalRooms.map((r) => {
    const roomUnits = uniqueUnits.filter((u) => u.roomId === r.id);
    if (roomUnits.length === 0) return r;
    if (r.beds && roomUnits.some((u) => u.bedId)) {
      const dirtyBedIds = new Set(roomUnits.map((u) => u.bedId).filter(Boolean));
      return {
        ...r,
        beds: r.beds.map((bed) =>
          dirtyBedIds.has(bed.id) ? { ...bed, status: 'dirty' as const } : bed
        ),
      };
    }
    return { ...r, status: 'dirty' as const };
  });

  const emehmonClosedConfirmed = payload.emehmonClosedConfirmed ?? true;
  const slipPrintedConfirmed = payload.slipPrintedConfirmed ?? true;

  // Never falsely mark an unregistered guest as E-mehmon checked out or slip-printed
  const nextBookings = state.bookings.map((b) =>
    b.id === payload.bookingId
      ? {
          ...b,
          status: 'checked_out' as const,
          checkingOutToday: false,
          guests: b.guests.map((g) => ({
            ...g,
            emehmonCheckedOut: g.emehmonRegistered ? emehmonClosedConfirmed : false,
            registrationSlipPrinted: g.emehmonRegistered
              ? g.registrationSlipPrinted || slipPrintedConfirmed
              : false,
            keyIssued: false,
          })),
        }
      : b
  );

  // Create housekeeping task for EVERY room/bed vacated in this booking
  const newHkTasks = uniqueUnits.map((unit) => ({
    id: makeId('hk'),
    propertyId: state.propertyId,
    roomId: unit.roomId,
    bedId: unit.bedId,
    roomLabel: unit.label,
    status: 'dirty' as const,
    createdAt: nowIso,
    notes: `Выселение: ${primaryGuest}. Требуется уборка и смена белья.`,
  }));

  const nextHk = [...newHkTasks, ...state.housekeepingTasks];

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
        notes: payload.createLuggage.notes || `Оставлен при выезде из ${primaryRoomLabel}`,
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
    body: `Гость выехал из ${allRoomsSummary}. Этап 1 — уточните оценку (1–5★) лично, чтобы решить замечания приватно. При 5★ отправьте ссылку Google Maps / Booking.`,
    draftReply: `Здравствуйте, ${primaryGuest}! Спасибо, что выбрали Topchan Hostel в Ташкенте. Как вам проживание от 1 до 5? Если всё понравилось на 5★, будем очень благодарны за отзыв на Google Maps: https://g.page/r/topchan-hostel-review. Счастливого пути!`,
    resolved: false,
    actions: [
      { id: makeId('act'), label: 'Скопировать приглашение', kind: 'copy_draft' as const },
      { id: makeId('act'), label: 'Отправлено', kind: 'dismiss' as const },
    ],
  };

  const reasons: string[] = [];
  if (payload.debtOverrideReason) reasons.push(`Долг-override: ${payload.debtOverrideReason}`);
  if (payload.emehmonOverrideReason) reasons.push(`E-mehmon-override: ${payload.emehmonOverrideReason}`);

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
        action:
          financials.debtUsd > 0 || payload.emehmonOverrideReason
            ? 'Выселение (Override)'
            : 'Выселение (Check-out)',
        diff: `${allRoomsSummary} → Уборка · Долг: ${formatUsd(financials.debtUsd)}`,
        reason:
          reasons.length > 0
            ? reasons.join(' | ')
            : 'Стандартный check-out (ключ сдан, Bnovo/E-mehmon закрыты)',
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

function syncRoomStatusesForToday(
  rooms: AppState['physicalRooms'],
  bookings: AppState['bookings'],
  todayIso: string
): AppState['physicalRooms'] {
  const occupiedKeys = new Set<string>();
  for (const b of bookings) {
    if (b.status !== 'active') continue;
    for (const seg of b.segments) {
      if (seg.fromDate <= todayIso && seg.toDate > todayIso) {
        occupiedKeys.add(`${seg.roomId}:${seg.bedId ?? ''}`);
      }
    }
  }
  return rooms.map((r) => {
    if (r.beds) {
      return {
        ...r,
        beds: r.beds.map((bed) => {
          const isOcc = occupiedKeys.has(`${r.id}:${bed.id}`);
          if (isOcc) return { ...bed, status: 'occupied' as const };
          if (bed.status === 'occupied') return { ...bed, status: 'available' as const };
          return bed;
        }),
      };
    }
    const isOcc = occupiedKeys.has(`${r.id}:`);
    if (isOcc) return { ...r, status: 'occupied' as const };
    if (r.status === 'occupied') return { ...r, status: 'available' as const };
    return r;
  });
}

export function validateMoveOrResizeSegment(
  state: AppState,
  payload: MoveOrResizeSegmentPayload
): string | null {
  const bkg = state.bookings.find((b) => b.id === payload.bookingId);
  if (!bkg || bkg.status !== 'active') return 'Бронь не найдена или уже закрыта.';
  const seg = bkg.segments.find((s) => s.id === payload.segmentId);
  if (!seg) return 'Сегмент проживания не найден.';
  const nights = diffDaysIso(payload.newFromDate, payload.newToDate);
  if (nights < 1) return 'Минимальная длительность проживания — 1 ночь.';

  const femaleErr = validateFemaleOnlyRoom(state, payload.targetRoomId, bkg.guests);
  if (femaleErr) return femaleErr;

  const conflicts = findRoomConflicts(
    state.bookings,
    payload.targetRoomId,
    payload.targetBedId,
    payload.newFromDate,
    payload.newToDate,
    payload.bookingId
  );
  if (conflicts.length > 0) {
    return `Конфликт дат с ${conflicts[0].guestName} (${conflicts[0].fromDate} — ${conflicts[0].toDate}).`;
  }
  return null;
}

export function handleMoveOrResizeSegment(
  state: AppState,
  payload: MoveOrResizeSegmentPayload,
  nowIso = new Date().toISOString(),
  todayIso = getTashkentTodayIso()
): AppState {
  if (validateMoveOrResizeSegment(state, payload)) return state;
  const bkg = state.bookings.find((b) => b.id === payload.bookingId)!;
  const oldSeg = bkg.segments.find((s) => s.id === payload.segmentId)!;

  const newNights = diffDaysIso(payload.newFromDate, payload.newToDate);
  const targetRoom = state.physicalRooms.find((r) => r.id === payload.targetRoomId);
  if (!targetRoom) return state;
  const targetCat = state.roomCategories.find((c) => c.id === targetRoom.categoryId);
  const occKey = Math.min(Math.max(1, bkg.guests.length), targetCat?.maxOccupancy ?? 1);
  const roomChanged =
    payload.targetRoomId !== oldSeg.roomId || (payload.targetBedId ?? '') !== (oldSeg.bedId ?? '');
  const nextRate = roomChanged
    ? (targetCat?.pricesUsd[occKey] ?? targetCat?.pricesUsd[1] ?? oldSeg.nightlyRateUsd)
    : oldSeg.nightlyRateUsd;

  const oldTotal = round2(oldSeg.nights * oldSeg.nightlyRateUsd);
  const newTotal = round2(newNights * nextRate);
  const deltaUsd = round2(newTotal - oldTotal);

  const targetBed = targetRoom.beds?.find((b) => b.id === payload.targetBedId);
  const targetLabel = targetBed ? `${targetRoom.code} ${targetBed.label}` : targetRoom.code;

  const nextBookings = state.bookings.map((b) => {
    if (b.id !== payload.bookingId) return b;
    const nextSegments = b.segments.map((s) =>
      s.id === payload.segmentId
        ? {
            ...s,
            roomId: payload.targetRoomId,
            bedId: payload.targetBedId,
            fromDate: payload.newFromDate,
            toDate: payload.newToDate,
            nights: newNights,
            nightlyRateUsd: nextRate,
          }
        : s
    );
    const lastSeg = nextSegments[nextSegments.length - 1];
    const nextLedger =
      deltaUsd !== 0
        ? [
            ...b.ledgerEntries,
            {
              id: makeId('led'),
              timestamp: nowIso,
              type: 'charge' as const,
              category: 'accommodation' as const,
              label: `Перерасчёт шахматки · ${targetLabel} (${payload.newFromDate.slice(5)}→${payload.newToDate.slice(5)}, ${newNights} н.)`,
              amountUsd: deltaUsd,
              actor: state.adminName,
            },
          ]
        : b.ledgerEntries;
    return {
      ...b,
      checkingOutToday: lastSeg?.toDate === todayIso,
      segments: nextSegments,
      ledgerEntries: nextLedger,
    };
  });

  const nextRooms = syncRoomStatusesForToday(state.physicalRooms, nextBookings, todayIso);

  return {
    ...state,
    physicalRooms: nextRooms,
    bookings: nextBookings,
    auditLog: [
      {
        id: makeId('aud'),
        propertyId: state.propertyId,
        timestamp: nowIso,
        actor: state.adminName,
        action: 'Перенос / изменение на Шахматке',
        diff: `${targetLabel} · ${payload.newFromDate} → ${payload.newToDate} (${newNights} н.${deltaUsd !== 0 ? `, ${deltaUsd > 0 ? '+' : ''}${formatUsd(deltaUsd)}` : ''})`,
        reason: 'Drag-and-Drop / Resize на шахматке',
      },
      ...state.auditLog,
    ],
  };
}

export function handleRestoreBookingsAndRooms(
  state: AppState,
  payload: { bookings: BookingGroup[]; physicalRooms: AppState['physicalRooms']; label: string },
  nowIso = new Date().toISOString()
): AppState {
  return {
    ...state,
    bookings: payload.bookings,
    physicalRooms: payload.physicalRooms,
    auditLog: [
      {
        id: makeId('aud'),
        propertyId: state.propertyId,
        timestamp: nowIso,
        actor: state.adminName,
        action: 'Отмена действия (Undo)',
        diff: payload.label,
        reason: 'Восстановление состояния шахматки в 1 клик',
      },
      ...state.auditLog,
    ],
  };
}

export function validateSplitStay(state: AppState, payload: SplitStayPayload): string | null {
  const bkg = state.bookings.find((b) => b.id === payload.bookingId);
  if (!bkg || bkg.status !== 'active') return 'Бронь не найдена или уже закрыта.';
  const seg = bkg.segments.find((s) => s.id === payload.segmentId);
  if (!seg) return 'Сегмент не найден.';
  if (payload.splitDate <= seg.fromDate || payload.splitDate >= seg.toDate) {
    return 'Дата переселения должна быть строго между датой заезда и датой выезда.';
  }
  const femaleErr = validateFemaleOnlyRoom(state, payload.targetRoomId, bkg.guests);
  if (femaleErr) return femaleErr;

  const conflicts = findRoomConflicts(
    state.bookings,
    payload.targetRoomId,
    payload.targetBedId,
    payload.splitDate,
    seg.toDate,
    payload.bookingId
  );
  if (conflicts.length > 0) {
    return `Новый номер занят с ${payload.splitDate} (${conflicts[0].guestName}).`;
  }
  return null;
}

export function handleSplitStayBooking(
  state: AppState,
  payload: SplitStayPayload,
  nowIso = new Date().toISOString(),
  todayIso = getTashkentTodayIso()
): AppState {
  if (validateSplitStay(state, payload)) return state;
  const bkg = state.bookings.find((b) => b.id === payload.bookingId)!;
  const seg = bkg.segments.find((s) => s.id === payload.segmentId)!;

  const firstNights = diffDaysIso(seg.fromDate, payload.splitDate);
  const secondNights = diffDaysIso(payload.splitDate, seg.toDate);
  const oldTotal = round2(seg.nights * seg.nightlyRateUsd);
  const newTotal = round2(firstNights * seg.nightlyRateUsd + secondNights * payload.targetNightlyRateUsd);
  const deltaUsd = round2(newTotal - oldTotal);

  const targetRoom = state.physicalRooms.find((r) => r.id === payload.targetRoomId);
  const targetBed = targetRoom?.beds?.find((b) => b.id === payload.targetBedId);
  const targetLabel = targetRoom
    ? targetBed
      ? `${targetRoom.code} ${targetBed.label}`
      : targetRoom.code
    : 'Номер';

  const nextBookings = state.bookings.map((b) => {
    if (b.id !== payload.bookingId) return b;
    const nextSegments = b.segments.flatMap((s) => {
      if (s.id !== payload.segmentId) return [s];
      return [
        {
          ...s,
          toDate: payload.splitDate,
          nights: firstNights,
        },
        {
          id: makeId('seg'),
          roomId: payload.targetRoomId,
          bedId: payload.targetBedId,
          fromDate: payload.splitDate,
          toDate: s.toDate,
          nights: secondNights,
          nightlyRateUsd: payload.targetNightlyRateUsd,
        },
      ];
    });
    const nextLedger =
      deltaUsd !== 0
        ? [
            ...b.ledgerEntries,
            {
              id: makeId('led'),
              timestamp: nowIso,
              type: 'charge' as const,
              category: 'accommodation' as const,
              label: `Split-Stay с ${payload.splitDate.slice(5)} → ${targetLabel} (разница тарифа)`,
              amountUsd: deltaUsd,
              actor: state.adminName,
            },
          ]
        : b.ledgerEntries;
    return {
      ...b,
      segments: nextSegments,
      ledgerEntries: nextLedger,
    };
  });

  const nextRooms = syncRoomStatusesForToday(state.physicalRooms, nextBookings, todayIso);

  return {
    ...state,
    physicalRooms: nextRooms,
    bookings: nextBookings,
    auditLog: [
      {
        id: makeId('aud'),
        propertyId: state.propertyId,
        timestamp: nowIso,
        actor: state.adminName,
        action: 'Split-Stay переселение',
        diff: `С ${payload.splitDate} → ${targetLabel} (${secondNights} н., общий баланс сохранён)`,
        reason: 'Разделение брони на 2 связанных сегмента',
      },
      ...state.auditLog,
    ],
  };
}

export function handleCompleteNightAudit(
  state: AppState,
  payload: CompleteNightAuditPayload,
  nowIso = new Date().toISOString(),
  todayIso = getTashkentTodayIso()
): AppState {
  const businessDate = state.operationalDate ?? todayIso;
  const nextBusinessDate = addDaysIso(businessDate, 1);
  const noShowSet = new Set(payload.noShowBookingIds);

  const nextBookings = state.bookings.map((b) => {
    if (noShowSet.has(b.id) && b.status === 'active') {
      return { ...b, status: 'cancelled' as const, checkingOutToday: false };
    }
    if (b.status === 'active') {
      const lastSeg = b.segments[b.segments.length - 1];
      return {
        ...b,
        checkingOutToday: lastSeg?.toDate === nextBusinessDate,
      };
    }
    return b;
  });

  const nextRooms = syncRoomStatusesForToday(state.physicalRooms, nextBookings, nextBusinessDate);
  const activePhysicalCount = state.physicalRooms.filter((r) => !r.archived).length;
  const totalUnits = state.physicalRooms
    .filter((r) => !r.archived)
    .reduce((sum, r) => sum + (r.beds ? r.beds.length : 1), 0);
  const occupiedUnits = nextRooms
    .filter((r) => !r.archived)
    .reduce(
      (sum, r) =>
        sum + (r.beds ? r.beds.filter((b) => b.status === 'occupied').length : r.status === 'occupied' ? 1 : 0),
      0
    );
  const unregisteredForeigners = nextBookings
    .filter((b) => b.status === 'active')
    .reduce((sum, b) => sum + b.guests.filter((g) => g.isForeigner && !g.emehmonRegistered).length, 0);
  const touristTaxUzs = calcMonthlyTouristTaxUzs(nextBookings, state.currency.bcvUzs, activePhysicalCount);

  const auditRecord = {
    id: makeId('shift'),
    propertyId: state.propertyId,
    businessDate,
    closedAt: nowIso,
    actor: state.adminName,
    occupiedUnits,
    totalUnits,
    noShowCancelledCount: noShowSet.size,
    unregisteredForeigners,
    touristTaxUzs,
    pocketsSnapshot: state.pockets.map((p) => ({
      id: p.id,
      name: p.name,
      currency: p.currency,
      balance: p.balance,
    })),
    notes: payload.notes.trim() || 'Ночной аудит выполнен без замечаний.',
  };

  return {
    ...state,
    operationalDate: nextBusinessDate,
    physicalRooms: nextRooms,
    bookings: nextBookings,
    shiftHistory: [auditRecord, ...(state.shiftHistory ?? [])],
    shiftChecklist: state.shiftChecklist.map((item) => ({
      ...item,
      done: false,
      doneAt: undefined,
    })),
    auditLog: [
      {
        id: makeId('aud'),
        propertyId: state.propertyId,
        timestamp: nowIso,
        actor: state.adminName,
        action: 'Ночной аудит (Закрытие суток)',
        diff: `Сутки ${businessDate} закрыты → новая дата ${nextBusinessDate} · No-show: ${noShowSet.size}`,
        reason: auditRecord.notes,
      },
      ...state.auditLog,
    ],
  };
}
