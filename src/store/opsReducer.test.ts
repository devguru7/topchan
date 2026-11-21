import test from 'node:test';
import assert from 'node:assert/strict';
import { createSeedState } from '../data/seed';
import { opsReducer } from './opsReducer';
import { calcBookingTotals } from '../utils/math';

test('full reception lifecycle: check-in, overbooking block, laundry, payment, extend/move, checkout, housekeeping, safe collection', () => {
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

  // 6. Check out Elena -> room becomes dirty and housekeeping task is created
  state = opsReducer(state, {
    type: 'CHECK_OUT',
    nowIso: '2026-11-22T11:45:00+05:00',
    timeHm: '11:45',
    payload: { bookingId: newBooking.id },
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
