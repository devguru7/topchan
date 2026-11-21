import test from 'node:test';
import assert from 'node:assert/strict';
import { createSeedState } from '../data/seed';
import { opsReducer } from './opsReducer';
import { calcBookingTotals } from '../utils/math';

test('full reception lifecycle: check-in, overbooking block, laundry, payment, extend/move, E-mehmon check, checkout, housekeeping, safe collection', () => {
  const BASE_DATE = '2026-11-20';
  let state = createSeedState(BASE_DATE);
  const initialBookingsCount = state.bookings.length;

  // 1. Check in new guest into free room Small #3 (2 nights @ $18 = $36), paid $20 USD upfront -> $16 debt
  state = opsReducer(state, {
    type: 'CHECK_IN',
    todayIso: BASE_DATE,
    nowIso: '2026-11-20T14:00:00+05:00',
    payload: {
      roomId: 'room-small-3',
      fromDate: BASE_DATE,
      nights: 2,
      nightlyRateUsd: 18,
      source: 'Walk-in',
      guests: [
        {
          fullName: 'Elena Sokolova',
          citizenship: 'RUS',
          age: 33,
          passportNo: '759012345',
          dob: '1993-04-12',
          sex: 'F',
          isForeigner: true,
          emehmonRegistered: false,
          emehmonCheckedOut: false,
          registrationSlipPrinted: false,
          keyIssued: true,
        },
      ],
      initialPayment: {
        amountUsdEquivalent: 20,
        originalCurrency: 'USD',
        originalAmount: 20,
        pocketId: 'cash_usd',
      },
    },
  });

  assert.equal(state.bookings.length, initialBookingsCount + 1);
  const newBooking = state.bookings[0];
  assert.equal(newBooking.status, 'active');
  assert.equal(calcBookingTotals(newBooking).debtUsd, 16);
  const small3 = state.physicalRooms.find((r) => r.id === 'room-small-3')!;
  assert.equal(small3.status, 'occupied');

  // 2. Overbooking guard MUST block another check-in on Small #3 for overlapping dates
  const bookingsBeforeConflict = state.bookings.length;
  state = opsReducer(state, {
    type: 'CHECK_IN',
    todayIso: BASE_DATE,
    payload: {
      roomId: 'room-small-3',
      fromDate: '2026-11-21',
      nights: 2,
      nightlyRateUsd: 18,
      source: 'Walk-in',
      guests: [
        {
          fullName: 'Overlap Guest',
          citizenship: 'KAZ',
          age: 36,
          passportNo: 'AA0000001',
          dob: '1990-01-01',
          sex: 'M',
          isForeigner: true,
          emehmonRegistered: false,
          emehmonCheckedOut: false,
          registrationSlipPrinted: false,
          keyIssued: false,
        },
      ],
    },
  });
  assert.equal(state.bookings.length, bookingsBeforeConflict, 'Overbooking must be blocked');

  // 3. Start fast laundry ($2) charged to folio -> debt increases from $16 to $18
  state = opsReducer(state, {
    type: 'START_LAUNDRY',
    nowIso: '2026-11-20T15:00:00+05:00',
    payload: {
      bookingId: newBooking.id,
      guestName: 'Elena Sokolova',
      roomLabel: 'Small #3',
      mode: 'fast',
      chargeToFolio: true,
    },
  });
  const startedJob = state.laundryJobs[0];
  assert.equal(startedJob.status, 'running');
  assert.equal(
    calcBookingTotals(state.bookings.find((b) => b.id === newBooking.id)!).debtUsd,
    18
  );

  // Complete laundry job
  state = opsReducer(state, {
    type: 'COMPLETE_LAUNDRY_JOB',
    timeHm: '15:22',
    payload: { jobId: startedJob.id },
  });
  assert.equal(state.laundryJobs.find((j) => j.id === startedJob.id)?.status, 'completed');

  // 4. Add remaining $18 payment via Uzcard/Humo terminal -> debt drops to $0
  state = opsReducer(state, {
    type: 'ADD_PAYMENT',
    nowIso: '2026-11-20T16:00:00+05:00',
    payload: {
      bookingId: newBooking.id,
      pocketId: 'terminal',
      currency: 'UZS',
      originalAmount: 220000,
      usdEquivalent: 18,
      receiptVerified: true,
    },
  });
  assert.equal(
    calcBookingTotals(state.bookings.find((b) => b.id === newBooking.id)!).debtUsd,
    0
  );

  // 5. Move/extend attempt into already-occupied Small #1 MUST be blocked by overbooking guard
  const segmentsBeforeMove = state.bookings.find((b) => b.id === newBooking.id)!.segments.length;
  state = opsReducer(state, {
    type: 'EXTEND_OR_MOVE_STAY',
    todayIso: BASE_DATE,
    payload: {
      bookingId: newBooking.id,
      mode: 'move',
      extraNights: 1,
      newRoomId: 'room-small-1',
      nightlyRateUsd: 18,
    },
  });
  assert.equal(
    state.bookings.find((b) => b.id === newBooking.id)!.segments.length,
    segmentsBeforeMove
  );

  // 6a. Checkout MUST be blocked while foreign guest Elena is not registered in E-mehmon
  const blockedCheckoutState = opsReducer(state, {
    type: 'CHECK_OUT',
    nowIso: '2026-11-22T11:45:00+05:00',
    timeHm: '11:45',
    payload: { bookingId: newBooking.id },
  });
  assert.equal(
    blockedCheckoutState.bookings.find((b) => b.id === newBooking.id)?.status,
    'active',
    'Unregistered foreigner checkout without override must be blocked'
  );

  // 6b. Register Elena in E-mehmon, then check out -> room becomes dirty and HK task is created
  const elenaGuestId = state.bookings.find((b) => b.id === newBooking.id)!.guests[0].id;
  state = opsReducer(state, {
    type: 'MARK_EMEHMON_REGISTERED',
    payload: { bookingId: newBooking.id, guestId: elenaGuestId },
  });

  state = opsReducer(state, {
    type: 'CHECK_OUT',
    nowIso: '2026-11-22T11:45:00+05:00',
    timeHm: '11:45',
    payload: {
      bookingId: newBooking.id,
      slipPrintedConfirmed: true,
      emehmonClosedConfirmed: true,
    },
  });
  assert.equal(state.bookings.find((b) => b.id === newBooking.id)?.status, 'checked_out');
  assert.equal(state.physicalRooms.find((r) => r.id === 'room-small-3')?.status, 'dirty');
  const hkTask = state.housekeepingTasks.find(
    (t) => t.roomId === 'room-small-3' && t.status === 'dirty'
  )!;
  assert.ok(hkTask);

  // 7. Two-step housekeeping sign-off (Maid -> Admin) restores room to 'available'
  state = opsReducer(state, {
    type: 'MAID_MARK_CLEANED',
    timeHm: '12:30',
    payload: { taskId: hkTask.id },
  });
  assert.equal(state.housekeepingTasks.find((t) => t.id === hkTask.id)?.status, 'maid_done');

  state = opsReducer(state, {
    type: 'ADMIN_APPROVE_HOUSEKEEPING',
    payload: { taskId: hkTask.id },
  });
  assert.equal(state.housekeepingTasks.find((t) => t.id === hkTask.id)?.status, 'approved');
  assert.equal(state.physicalRooms.find((r) => r.id === 'room-small-3')?.status, 'available');

  // 8. Safe collection & owner confirmation deducts cash_usd accurately
  const usdBeforeSafe = state.pockets.find((p) => p.id === 'cash_usd')!.balance;
  state = opsReducer(state, {
    type: 'CREATE_SAFE_COLLECTION',
    nowIso: '2026-11-22T18:00:00+05:00',
    payload: { amountUzs: 500000, amountUsd: 50, amountEur: 0 },
  });
  assert.equal(state.pockets.find((p) => p.id === 'cash_usd')!.balance, usdBeforeSafe - 50);
  const collection = state.safeCollections[0];
  assert.equal(collection.status, 'pending');

  state = opsReducer(state, {
    type: 'CONFIRM_SAFE_COLLECTION',
    nowIso: '2026-11-22T18:10:00+05:00',
    payload: { id: collection.id },
  });
  assert.equal(
    state.safeCollections.find((c) => c.id === collection.id)?.status,
    'confirmed'
  );
});

test('FIX 1 regression: ADD_PAYMENT into cash_uzs with changeUzsOut updates cash_uzs in a single pass and avoids fake folio overpayment', () => {
  const BASE_DATE = '2026-11-20';
  let state = createSeedState(BASE_DATE);

  // Yellow #1 has $5 debt (61,000 UZS @ 12200). Guest hands 100,000 UZS and receives 39,000 UZS change.
  const uzsBefore = state.pockets.find((p) => p.id === 'cash_uzs')!.balance;
  state = opsReducer(state, {
    type: 'ADD_PAYMENT',
    nowIso: '2026-11-20T12:00:00+05:00',
    payload: {
      bookingId: 'bkg-yellow-1',
      pocketId: 'cash_uzs',
      currency: 'UZS',
      originalAmount: 100000,
      usdEquivalent: 8.2, // gross USD before change
      changeUzsOut: 39000,
    },
  });

  const uzsAfter = state.pockets.find((p) => p.id === 'cash_uzs')!.balance;
  assert.equal(
    uzsAfter,
    uzsBefore + 100000 - 39000,
    'cash_uzs must be incremented by originalAmount AND decremented by changeUzsOut'
  );

  const yellowTotals = calcBookingTotals(state.bookings.find((b) => b.id === 'bkg-yellow-1')!);
  assert.equal(yellowTotals.debtUsd, 0);
  assert.equal(yellowTotals.overpaidUsd, 0, 'Cash change must never create fake folio overpayment');

  // Guard checks: reject direct payment into safe pocket or mismatched currency
  const revBeforeReject = state.revision;
  state = opsReducer(state, {
    type: 'ADD_PAYMENT',
    payload: {
      bookingId: 'bkg-yellow-1',
      pocketId: 'safe',
      currency: 'USD',
      originalAmount: 10,
      usdEquivalent: 10,
    },
  });
  state = opsReducer(state, {
    type: 'ADD_PAYMENT',
    payload: {
      bookingId: 'bkg-yellow-1',
      pocketId: 'cash_usd',
      currency: 'UZS',
      originalAmount: 50000,
      usdEquivalent: 4,
    },
  });
  assert.equal(state.revision, revBeforeReject, 'Invalid payments must be rejected without mutating state');
});

test('FIX 2 regression: multi-currency safe collection preserves UZS/USD/EUR, blocks negative/excess amounts, and prevents double-confirm', () => {
  const BASE_DATE = '2026-11-20';
  let state = createSeedState(BASE_DATE);

  const uzsBefore = state.pockets.find((p) => p.id === 'cash_uzs')!.balance;
  const usdBefore = state.pockets.find((p) => p.id === 'cash_usd')!.balance;
  const eurBefore = state.pockets.find((p) => p.id === 'cash_eur')!.balance;
  const safeBefore = state.pockets.find((p) => p.id === 'safe')!.safeBalances!;

  // Negative & excess amounts must be rejected
  const revBeforeBad = state.revision;
  state = opsReducer(state, {
    type: 'CREATE_SAFE_COLLECTION',
    payload: { amountUzs: -10000, amountUsd: 10, amountEur: 0 },
  });
  state = opsReducer(state, {
    type: 'CREATE_SAFE_COLLECTION',
    payload: { amountUzs: uzsBefore + 100000, amountUsd: 0, amountEur: 0 },
  });
  assert.equal(state.revision, revBeforeBad, 'Negative or excess safe collections must be rejected');

  // Valid multi-currency collection (UZS + USD + EUR)
  state = opsReducer(state, {
    type: 'CREATE_SAFE_COLLECTION',
    nowIso: '2026-11-20T18:00:00+05:00',
    payload: { amountUzs: 500000, amountUsd: 100, amountEur: 50 },
  });

  assert.equal(state.pockets.find((p) => p.id === 'cash_uzs')!.balance, uzsBefore - 500000);
  assert.equal(state.pockets.find((p) => p.id === 'cash_usd')!.balance, usdBefore - 100);
  assert.equal(state.pockets.find((p) => p.id === 'cash_eur')!.balance, eurBefore - 50);

  const safeAfterCreate = state.pockets.find((p) => p.id === 'safe')!.safeBalances!;
  assert.equal(safeAfterCreate.UZS, safeBefore.UZS + 500000);
  assert.equal(safeAfterCreate.USD, safeBefore.USD + 100);
  assert.equal(safeAfterCreate.EUR, safeBefore.EUR + 50);

  // Confirm once -> hands over from safe to owner, deducts from safeBalances
  const colId = state.safeCollections[0].id;
  state = opsReducer(state, {
    type: 'CONFIRM_SAFE_COLLECTION',
    nowIso: '2026-11-20T18:10:00+05:00',
    payload: { id: colId },
  });
  const safeAfterConfirm = state.pockets.find((p) => p.id === 'safe')!.safeBalances!;
  assert.equal(safeAfterConfirm.UZS, safeBefore.UZS);
  assert.equal(safeAfterConfirm.USD, safeBefore.USD);
  assert.equal(safeAfterConfirm.EUR, safeBefore.EUR);

  // Double-confirm MUST be a strict no-op (no duplicate audit log or double deduction)
  const auditLenAfterFirstConfirm = state.auditLog.length;
  state = opsReducer(state, {
    type: 'CONFIRM_SAFE_COLLECTION',
    nowIso: '2026-11-20T18:15:00+05:00',
    payload: { id: colId },
  });
  assert.equal(state.auditLog.length, auditLenAfterFirstConfirm);
  assert.deepEqual(state.pockets.find((p) => p.id === 'safe')!.safeBalances, safeAfterConfirm);

  // RECORD_CASH_CALC must log to auditLog and deduct changeUsd cleanly
  const usdDeskBeforeCalc = state.pockets.find((p) => p.id === 'cash_usd')!.balance;
  const auditBeforeCalc = state.auditLog.length;
  state = opsReducer(state, {
    type: 'RECORD_CASH_CALC',
    nowIso: '2026-11-20T18:20:00+05:00',
    payload: {
      pocketId: 'cash_usd',
      currency: 'USD',
      receivedAmount: 50,
      changeUzs: 0,
      changeUsd: 12,
      label: 'Тест сдачи USD',
    },
  });
  assert.equal(state.pockets.find((p) => p.id === 'cash_usd')!.balance, usdDeskBeforeCalc + 38);
  assert.equal(state.auditLog.length, auditBeforeCalc + 1);
});

test('FIX 3 regression: checkout works with overpayment, supports refund, enforces debt role guard, and marks ALL multi-segment rooms dirty', () => {
  const BASE_DATE = '2026-11-20';
  let state = createSeedState(BASE_DATE);

  // 1. Check in registered guest into Small #3 (1 night @ $18), pay $30 USD without change -> $12 overpayment
  state = opsReducer(state, {
    type: 'CHECK_IN',
    todayIso: BASE_DATE,
    payload: {
      roomId: 'room-small-3',
      fromDate: BASE_DATE,
      nights: 1,
      nightlyRateUsd: 18,
      source: 'QR Direct',
      guests: [
        {
          fullName: 'Marco Rossi',
          citizenship: 'ITA',
          age: 35,
          passportNo: 'YA4829103',
          dob: '1991-06-15',
          sex: 'M',
          isForeigner: true,
          emehmonRegistered: true,
          emehmonCheckedOut: false,
          registrationSlipPrinted: false,
          keyIssued: true,
        },
      ],
      initialPayment: {
        amountUsdEquivalent: 30,
        originalCurrency: 'USD',
        originalAmount: 30,
        pocketId: 'cash_usd',
      },
    },
  });

  const bookingId = state.bookings[0].id;
  assert.equal(calcBookingTotals(state.bookings[0]).overpaidUsd, 12);

  // 2. Move guest mid-stay to Small #4 (creating a 2nd segment in another room)
  state = opsReducer(state, {
    type: 'EXTEND_OR_MOVE_STAY',
    todayIso: BASE_DATE,
    payload: {
      bookingId,
      mode: 'move',
      extraNights: 1,
      newRoomId: 'room-small-4',
      nightlyRateUsd: 18,
    },
  });
  // Total charges now $36, paid $30 -> $6 debt. Add $16 payment -> $10 overpayment!
  state = opsReducer(state, {
    type: 'ADD_PAYMENT',
    payload: {
      bookingId,
      pocketId: 'cash_usd',
      currency: 'USD',
      originalAmount: 16,
      usdEquivalent: 16,
    },
  });
  assert.equal(calcBookingTotals(state.bookings.find((b) => b.id === bookingId)!).overpaidUsd, 10);

  // 3. Issue $10 USD refund from cash_usd -> overpayment becomes $0
  const usdBeforeRefund = state.pockets.find((p) => p.id === 'cash_usd')!.balance;
  state = opsReducer(state, {
    type: 'ISSUE_REFUND',
    payload: {
      bookingId,
      pocketId: 'cash_usd',
      currency: 'USD',
      amountOriginal: 10,
      amountUsd: 10,
    },
  });
  assert.equal(state.pockets.find((p) => p.id === 'cash_usd')!.balance, usdBeforeRefund - 10);
  assert.equal(calcBookingTotals(state.bookings.find((b) => b.id === bookingId)!).overpaidUsd, 0);

  // Add another $5 overpayment to verify checkout ALSO succeeds directly with overpayment > 0
  state = opsReducer(state, {
    type: 'ADD_PAYMENT',
    payload: {
      bookingId,
      pocketId: 'cash_usd',
      currency: 'USD',
      originalAmount: 5,
      usdEquivalent: 5,
    },
  });
  assert.equal(calcBookingTotals(state.bookings.find((b) => b.id === bookingId)!).overpaidUsd, 5);

  // 4. Checkout multi-segment booking -> BOTH room-small-3 AND room-small-4 must be marked dirty + have HK tasks!
  state = opsReducer(state, {
    type: 'CHECK_OUT',
    payload: {
      bookingId,
      slipPrintedConfirmed: true,
      emehmonClosedConfirmed: true,
    },
  });
  assert.equal(state.bookings.find((b) => b.id === bookingId)?.status, 'checked_out');
  assert.equal(state.physicalRooms.find((r) => r.id === 'room-small-3')?.status, 'dirty');
  assert.equal(state.physicalRooms.find((r) => r.id === 'room-small-4')?.status, 'dirty');
  assert.ok(state.housekeepingTasks.some((t) => t.roomId === 'room-small-3' && t.status === 'dirty'));
  assert.ok(state.housekeepingTasks.some((t) => t.roomId === 'room-small-4' && t.status === 'dirty'));

  // 5. Debt override guard: reception role is blocked from checking out bkg-yellow-1 ($5 debt)
  const blockedReception = opsReducer(state, {
    type: 'CHECK_OUT',
    payload: {
      bookingId: 'bkg-yellow-1',
      actorRole: 'reception',
      debtOverrideReason: 'Гость обещал перевести на карту завтра утром',
      emehmonOverrideReason: 'Все зарегистрированы ранее в системе',
    },
  });
  assert.equal(
    blockedReception.bookings.find((b) => b.id === 'bkg-yellow-1')?.status,
    'active',
    'reception role must not be allowed to override unpaid debt at checkout'
  );
});

test('inline SET_ROOM_HOUSEKEEPING_STATUS toggles room & dorm bed cleanliness, syncs HK tasks, and blocks occupied units', () => {
  const BASE_DATE = '2026-11-20';
  let state = createSeedState(BASE_DATE);

  // 1. Occupied room (Small-1) MUST NOT be overwritten to dirty/maintenance
  const revBeforeOccupied = state.revision;
  state = opsReducer(state, {
    type: 'SET_ROOM_HOUSEKEEPING_STATUS',
    payload: { roomId: 'room-small-1', status: 'dirty' },
  });
  assert.equal(state.revision, revBeforeOccupied);
  assert.equal(state.physicalRooms.find((r) => r.id === 'room-small-1')?.status, 'occupied');

  // 2. Unoccupied room (Yellow-4) available -> dirty creates HK task -> maintenance -> available approves HK task
  state = opsReducer(state, {
    type: 'SET_ROOM_HOUSEKEEPING_STATUS',
    nowIso: '2026-11-20T10:00:00+05:00',
    payload: { roomId: 'room-yellow-4', status: 'dirty' },
  });
  assert.equal(state.physicalRooms.find((r) => r.id === 'room-yellow-4')?.status, 'dirty');
  assert.ok(
    state.housekeepingTasks.some((t) => t.roomId === 'room-yellow-4' && t.status === 'dirty')
  );

  state = opsReducer(state, {
    type: 'SET_ROOM_HOUSEKEEPING_STATUS',
    payload: { roomId: 'room-yellow-4', status: 'maintenance' },
  });
  assert.equal(state.physicalRooms.find((r) => r.id === 'room-yellow-4')?.status, 'maintenance');

  state = opsReducer(state, {
    type: 'SET_ROOM_HOUSEKEEPING_STATUS',
    payload: { roomId: 'room-yellow-4', status: 'available' },
  });
  assert.equal(state.physicalRooms.find((r) => r.id === 'room-yellow-4')?.status, 'available');
  assert.ok(
    state.housekeepingTasks.every(
      (t) => t.roomId !== 'room-yellow-4' || t.status === 'approved'
    )
  );

  // 3. Dorm bed inline toggle works on unoccupied Six-3, blocked on occupied Six-2
  state = opsReducer(state, {
    type: 'SET_ROOM_HOUSEKEEPING_STATUS',
    payload: { roomId: 'room-six-dorm', bedId: 'six-bed-3', status: 'dirty' },
  });
  assert.equal(
    state.physicalRooms
      .find((r) => r.id === 'room-six-dorm')
      ?.beds?.find((b) => b.id === 'six-bed-3')?.status,
    'dirty'
  );

  const revBeforeOccupiedBed = state.revision;
  state = opsReducer(state, {
    type: 'SET_ROOM_HOUSEKEEPING_STATUS',
    payload: { roomId: 'room-six-dorm', bedId: 'six-bed-2', status: 'available' },
  });
  assert.equal(state.revision, revBeforeOccupiedBed);
});

test('STAGE 3 Tape Chart DnD MOVE_OR_RESIZE_SEGMENT: recalculates folio, blocks overlap, and supports 1-click Undo', () => {
  const BASE_DATE = '2026-11-20';
  let state = createSeedState(BASE_DATE);

  // Check in a guest to Small-3 for 2 nights ($18/night = $36)
  state = opsReducer(state, {
    type: 'CHECK_IN',
    todayIso: BASE_DATE,
    payload: {
      roomId: 'room-small-3',
      fromDate: BASE_DATE,
      nights: 2,
      nightlyRateUsd: 18,
      source: 'Walk-in',
      guests: [
        {
          fullName: 'Elena Petrova',
          citizenship: 'UZB',
          age: 29,
          passportNo: 'AA1234567',
          dob: '1997-04-12',
          sex: 'F',
          isForeigner: false,
          emehmonRegistered: true,
          emehmonCheckedOut: false,
          registrationSlipPrinted: false,
          keyIssued: true,
        },
      ],
    },
  });

  const booking = state.bookings[0];
  const seg = booking.segments[0];
  const snapshotBookings = structuredClone(state.bookings);
  const snapshotRooms = structuredClone(state.physicalRooms);

  // Move to Yellow-4 ($24/night) and resize to 3 nights ($72 total -> +$36 adjustment)
  state = opsReducer(state, {
    type: 'MOVE_OR_RESIZE_SEGMENT',
    todayIso: BASE_DATE,
    payload: {
      bookingId: booking.id,
      segmentId: seg.id,
      targetRoomId: 'room-yellow-4',
      newFromDate: BASE_DATE,
      newToDate: '2026-11-23',
    },
  });

  const moved = state.bookings.find((b) => b.id === booking.id)!;
  assert.equal(moved.segments[0].roomId, 'room-yellow-4');
  assert.equal(moved.segments[0].nights, 3);
  assert.equal(calcBookingTotals(moved).totalChargesUsd, 72);
  assert.equal(state.physicalRooms.find((r) => r.id === 'room-small-3')?.status, 'available');
  assert.equal(state.physicalRooms.find((r) => r.id === 'room-yellow-4')?.status, 'occupied');

  // Attempt conflicting move onto already-occupied room-small-1 (yesterday..plus2) -> rejected (revision unchanged)
  const revBeforeConflict = state.revision;
  state = opsReducer(state, {
    type: 'MOVE_OR_RESIZE_SEGMENT',
    todayIso: BASE_DATE,
    payload: {
      bookingId: booking.id,
      segmentId: seg.id,
      targetRoomId: 'room-small-1',
      newFromDate: BASE_DATE,
      newToDate: '2026-11-23',
    },
  });
  assert.equal(state.revision, revBeforeConflict);

  // 1-click Undo restores exact bookings & rooms state
  state = opsReducer(state, {
    type: 'RESTORE_BOOKINGS_AND_ROOMS',
    payload: {
      bookings: snapshotBookings,
      physicalRooms: snapshotRooms,
      label: 'Отмена переноса Elena Petrova',
    },
  });
  const restored = state.bookings.find((b) => b.id === booking.id)!;
  assert.equal(restored.segments[0].roomId, 'room-small-3');
  assert.equal(restored.segments[0].nights, 2);
  assert.equal(state.physicalRooms.find((r) => r.id === 'room-small-3')?.status, 'occupied');
});

test('STAGE 3 Split-Stay & Female-Only Dorm Guard: creates 2 linked segments and blocks male guests in Fem Dorm', () => {
  const BASE_DATE = '2026-11-20';
  let state = createSeedState(BASE_DATE);

  // 1. Male guest MUST be blocked from checking into Fem Dorm (fem-bed-1)
  const revBeforeMaleFem = state.revision;
  state = opsReducer(state, {
    type: 'CHECK_IN',
    todayIso: BASE_DATE,
    payload: {
      roomId: 'room-fem-dorm',
      bedId: 'fem-bed-1',
      fromDate: BASE_DATE,
      nights: 2,
      nightlyRateUsd: 11,
      source: 'Walk-in',
      guests: [
        {
          fullName: 'John Smith',
          citizenship: 'GBR',
          age: 30,
          passportNo: 'GB998877',
          dob: '1996-01-10',
          sex: 'M',
          isForeigner: true,
          emehmonRegistered: false,
          emehmonCheckedOut: false,
          registrationSlipPrinted: false,
          keyIssued: true,
        },
      ],
    },
  });
  assert.equal(state.revision, revBeforeMaleFem, 'Male guest must be blocked from Fem Dorm');

  // 2. Check in male guest to Small-3 for 3 nights ($18/night = $54), then Split-Stay on day 2 to Small-4 ($22/night)
  state = opsReducer(state, {
    type: 'CHECK_IN',
    todayIso: BASE_DATE,
    payload: {
      roomId: 'room-small-3',
      fromDate: BASE_DATE,
      nights: 3,
      nightlyRateUsd: 18,
      source: 'Bnovo',
      guests: [
        {
          fullName: 'John Smith',
          citizenship: 'GBR',
          age: 30,
          passportNo: 'GB998877',
          dob: '1996-01-10',
          sex: 'M',
          isForeigner: true,
          emehmonRegistered: true,
          emehmonCheckedOut: false,
          registrationSlipPrinted: false,
          keyIssued: true,
        },
      ],
    },
  });

  const booking = state.bookings[0];
  const origSeg = booking.segments[0];

  // Splitting male guest into Fem Dorm must also be blocked
  const revBeforeBadSplit = state.revision;
  state = opsReducer(state, {
    type: 'SPLIT_STAY_BOOKING',
    todayIso: BASE_DATE,
    payload: {
      bookingId: booking.id,
      segmentId: origSeg.id,
      splitDate: '2026-11-21',
      targetRoomId: 'room-fem-dorm',
      targetBedId: 'fem-bed-1',
      targetNightlyRateUsd: 11,
    },
  });
  assert.equal(state.revision, revBeforeBadSplit, 'Split-Stay of male guest into Fem Dorm must be blocked');

  // Valid Split-Stay into Small-4 ($22/night for remaining 2 nights -> 1*18 + 2*22 = $62)
  state = opsReducer(state, {
    type: 'SPLIT_STAY_BOOKING',
    todayIso: BASE_DATE,
    payload: {
      bookingId: booking.id,
      segmentId: origSeg.id,
      splitDate: '2026-11-21',
      targetRoomId: 'room-small-4',
      targetNightlyRateUsd: 22,
    },
  });

  const splitBooking = state.bookings.find((b) => b.id === booking.id)!;
  assert.equal(splitBooking.segments.length, 2);
  assert.equal(splitBooking.segments[0].roomId, 'room-small-3');
  assert.equal(splitBooking.segments[0].nights, 1);
  assert.equal(splitBooking.segments[1].roomId, 'room-small-4');
  assert.equal(splitBooking.segments[1].nights, 2);
  assert.equal(calcBookingTotals(splitBooking).totalChargesUsd, 62);
});

test('STAGE 3 Night Audit COMPLETE_NIGHT_AUDIT: cancels selected no-shows, advances operationalDate, and archives immutable ShiftAuditRecord', () => {
  const BASE_DATE = '2026-11-20';
  let state = createSeedState(BASE_DATE);

  // Add a fresh active booking to cancel as No-Show
  state = opsReducer(state, {
    type: 'CHECK_IN',
    todayIso: BASE_DATE,
    payload: {
      roomId: 'room-small-3',
      fromDate: BASE_DATE,
      nights: 2,
      nightlyRateUsd: 18,
      source: 'Bnovo',
      guests: [
        {
          fullName: 'NoShow Guest',
          citizenship: 'DEU',
          age: 28,
          passportNo: 'DE1122334',
          dob: '1998-03-01',
          sex: 'M',
          isForeigner: true,
          emehmonRegistered: false,
          emehmonCheckedOut: false,
          registrationSlipPrinted: false,
          keyIssued: false,
        },
      ],
    },
  });

  const noShowBookingId = state.bookings[0].id;
  const historyLenBefore = (state.shiftHistory ?? []).length;

  state = opsReducer(state, {
    type: 'COMPLETE_NIGHT_AUDIT',
    todayIso: BASE_DATE,
    nowIso: '2026-11-20T23:55:00+05:00',
    payload: {
      noShowBookingIds: [noShowBookingId],
      notes: 'Ночной аудит выполнен без расхождений',
    },
  });

  assert.equal(state.operationalDate, '2026-11-21');
  assert.equal(state.bookings.find((b) => b.id === noShowBookingId)?.status, 'cancelled');
  assert.equal(state.physicalRooms.find((r) => r.id === 'room-small-3')?.status, 'available');
  assert.equal((state.shiftHistory ?? []).length, historyLenBefore + 1);
  assert.equal(state.shiftHistory![0].businessDate, BASE_DATE);
  assert.equal(state.shiftHistory![0].noShowCancelledCount, 1);
});


