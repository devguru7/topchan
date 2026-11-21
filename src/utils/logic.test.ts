import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calcAccommodationUzs,
  calcBookingTotals,
  calcBookingTouristTaxUzs,
  calcChangeUzs,
  calcDefaultAccRate,
  calcDefaultExRate,
  calcDenominationTotals,
  calcDualRateChange,
  calcMonthlyTouristTaxUzs,
  calcTouristTaxPerNightUzs,
} from './math';
import { parseTd3Mrz, SAMPLE_MRZ_ITALY, SAMPLE_MRZ_KOREA } from './mrz';
import { parseRussianReceptionCommand } from './commandParser';
import {
  addDaysIso,
  getDateRangeIso,
  getDaysToTouristTaxDeadline,
  getShiftBusinessDate,
  getTashkentTodayIso,
  getTashkentYear,
} from './time';
import {
  findAlternativeFreeRooms,
  findRoomConflicts,
  hasDateOverlap,
} from './availability';
import { createSeedState, FALLBACK_CBU_USD, DEFAULT_BCV_UZS } from '../data/seed';
import { parseSafeAmount } from '../../server/bnovo';

test('default Acc and Ex rates derive accurately from CBU USD', () => {
  assert.equal(calcDefaultAccRate(FALLBACK_CBU_USD), 12200);
  assert.equal(calcDefaultExRate(FALLBACK_CBU_USD), 11800);
});

test('accommodation UZS rounds UP to nearest 1000 and change UZS rounds DOWN to nearest 1000', () => {
  assert.equal(calcAccommodationUzs(18, 12200), 220000); // 219600 -> 220000
  assert.equal(calcChangeUzs(12, 11800), 141000); // 141600 -> 141000
  assert.equal(calcChangeUzs(0, 11800), 0);
});

test('dual-rate change calculator computes exact UZS change when guest overpays in USD', () => {
  const res = calcDualRateChange({
    billUsd: 38,
    receivedCurrency: 'USD',
    receivedAmount: 50,
    accRate: 12200,
    exRate: 11800,
    cbuUsd: 12004.48,
    cbuEur: 13280.68,
  });
  assert.equal(res.overpaidUsd, 12);
  assert.equal(res.underpaidUsd, 0);
  assert.equal(res.changeUsd, 12);
  assert.equal(res.changeUzs, 141000);
});

test('FIX 4 regression: same-currency UZS payment gives zero-spread exact change and exact billUzs yields zero overpayment', () => {
  // Bill $18 @ Acc 12200 -> billUzs = 220,000. Paying 500,000 UZS -> exact 280,000 UZS change (not 270,000)
  const overpaid = calcDualRateChange({
    billUsd: 18,
    receivedCurrency: 'UZS',
    receivedAmount: 500000,
    accRate: 12200,
    exRate: 11800,
    cbuUsd: 12004.48,
    cbuEur: 13280.68,
  });
  assert.equal(overpaid.billUzs, 220000);
  assert.equal(overpaid.changeUzs, 280000);
  assert.equal(overpaid.underpaidUsd, 0);

  // Paying exact billUzs (220,000) must yield zero overpayment and zero change
  const exact = calcDualRateChange({
    billUsd: 18,
    receivedCurrency: 'UZS',
    receivedAmount: 220000,
    accRate: 12200,
    exRate: 11800,
    cbuUsd: 12004.48,
    cbuEur: 13280.68,
  });
  assert.equal(exact.overpaidUsd, 0);
  assert.equal(exact.underpaidUsd, 0);
  assert.equal(exact.changeUzs, 0);

  // Zero-division guard: zero rates never return NaN/Infinity
  const zeroRate = calcDualRateChange({
    billUsd: 18,
    receivedCurrency: 'EUR',
    receivedAmount: 20,
    accRate: 0,
    exRate: 0,
    cbuUsd: 0,
    cbuEur: 0,
  });
  assert.equal(Number.isFinite(zeroRate.receivedUsdEquivalent), true);
  assert.equal(Number.isFinite(zeroRate.changeUzs), true);
});

test('debt is computed strictly from immutable ledger entries', () => {
  const seed = createSeedState('2026-11-20');
  const yellow = seed.bookings.find((b) => b.id === 'bkg-yellow-1')!;
  const totals = calcBookingTotals(yellow);
  assert.equal(totals.totalChargesUsd, 53); // 48 + 3 + 2
  assert.equal(totals.totalPaymentsUsd, 48);
  assert.equal(totals.debtUsd, 5);
});

test('Uzbekistan tourist tax respects age < 16 exemption and room count threshold', () => {
  assert.equal(calcTouristTaxPerNightUzs({ age: 11, isForeigner: false }, DEFAULT_BCV_UZS, 15), 0);
  assert.equal(calcTouristTaxPerNightUzs({ age: 15, isForeigner: true }, DEFAULT_BCV_UZS, 15), 0);
  assert.equal(calcTouristTaxPerNightUzs({ age: 38, isForeigner: false }, DEFAULT_BCV_UZS, 15), 1760);
  assert.equal(calcTouristTaxPerNightUzs({ age: 30, isForeigner: true }, DEFAULT_BCV_UZS, 10), 22000);
  assert.equal(calcTouristTaxPerNightUzs({ age: 30, isForeigner: true }, DEFAULT_BCV_UZS, 15), 44000);

  const seed = createSeedState('2026-11-20');
  const activeRooms = seed.physicalRooms.filter((r) => !r.archived).length;
  assert.equal(activeRooms, 15);
  const monthlyTax = calcMonthlyTouristTaxUzs(seed.bookings, DEFAULT_BCV_UZS, activeRooms);
  assert.equal(monthlyTax, 572000 + 10560);
});

test('FIX 5 regression: parallel multi-room segments do NOT double-count tourist tax nights', () => {
  const seed = createSeedState('2026-11-20');
  const template = seed.bookings[0];
  // 2 rooms booked in parallel for the SAME 2 nights (2026-11-20 -> 2026-11-22) with 1 adult foreigner
  const parallelBooking = {
    ...template,
    id: 'bkg-parallel-test',
    guests: [
      {
        ...template.guests[0],
        id: 'gst-parallel-1',
        age: 31,
        isForeigner: true,
      },
    ],
    segments: [
      {
        id: 'seg-a',
        roomId: 'room-small-3',
        fromDate: '2026-11-20',
        toDate: '2026-11-22',
        nights: 2,
        nightlyRateUsd: 18,
      },
      {
        id: 'seg-b',
        roomId: 'room-small-4',
        fromDate: '2026-11-20',
        toDate: '2026-11-22',
        nights: 2,
        nightlyRateUsd: 18,
      },
    ],
  };

  // At 15 rooms, daily tax = 44,000 UZS. 2 unique nights = 88,000 UZS (NOT 176,000!)
  assert.equal(calcBookingTouristTaxUzs(parallelBooking, DEFAULT_BCV_UZS, 15), 88000);

  // Zero-night booking yields 0 tax
  const zeroNightBooking = {
    ...parallelBooking,
    segments: [
      {
        id: 'seg-zero',
        roomId: 'room-small-3',
        fromDate: '2026-11-20',
        toDate: '2026-11-20',
        nights: 0,
        nightlyRateUsd: 18,
      },
    ],
  };
  assert.equal(calcBookingTouristTaxUzs(zeroNightBooking, DEFAULT_BCV_UZS, 15), 0);
});

test('FIX 9 regression: parseSafeAmount parses European comma decimals and never returns NaN', () => {
  assert.equal(parseSafeAmount('100,50'), 100.5);
  assert.equal(parseSafeAmount('1 250,75 USD'), 1250.75);
  assert.equal(parseSafeAmount('1,250.50'), 1250.5);
  assert.equal(parseSafeAmount(42.25), 42.25);
  assert.equal(parseSafeAmount('invalid'), 0);
  assert.equal(parseSafeAmount(null), 0);
  assert.equal(parseSafeAmount(Number.NaN), 0);
});

test('denomination counter sums UZS and USD bills accurately', () => {
  const res = calcDenominationTotals(
    { 200000: 5, 100000: 10, 50000: 9 },
    { 100: 2, 50: 2, 20: 2 }
  );
  assert.equal(res.totalUzs, 2450000);
  assert.equal(res.totalUsd, 340);
});

test('TD3 MRZ parser extracts Italian and Korean passport fields and rejects malformed input', () => {
  const it = parseTd3Mrz(SAMPLE_MRZ_ITALY, 2026);
  assert.equal(it.valid, true);
  assert.equal(it.surname, 'Rossi');
  assert.equal(it.givenName, 'Marco');
  assert.equal(it.passportNo, 'YA4829103');
  assert.equal(it.nationality, 'ITA');
  assert.equal(it.dob, '1991-06-15');
  assert.equal(it.sex, 'M');
  assert.equal(it.isForeigner, true);

  const kr = parseTd3Mrz(SAMPLE_MRZ_KOREA, 2026);
  assert.equal(kr.valid, true);
  assert.equal(kr.surname, 'Park');
  assert.equal(kr.givenName, 'Minjun');
  assert.equal(kr.passportNo, 'M83910421');
  assert.equal(kr.nationality, 'KOR');
  assert.equal(kr.dob, '1996-03-22');

  const bad = parseTd3Mrz('INVALID SINGLE LINE');
  assert.equal(bad.valid, false);
});

test('Asia/Tashkent time engine handles UTC+5 dates, shift business date cutoff, and tax deadline', () => {
  const today = getTashkentTodayIso();
  assert.match(today, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(getTashkentYear() >= 2025);
  assert.equal(addDaysIso('2026-11-30', 1), '2026-12-01');
  assert.equal(addDaysIso('2026-03-01', -1), '2026-02-28');
  assert.equal(getDateRangeIso('2026-11-20', 14).length, 14);

  // 02:30 UTC is 07:30 Tashkent -> before 08:00 shift cutoff, so business date is previous day
  const beforeCutoff = new Date('2026-11-20T02:30:00Z');
  assert.equal(getShiftBusinessDate(8, beforeCutoff), '2026-11-19');

  // 04:00 UTC is 09:00 Tashkent -> after 08:00 shift cutoff, so business date is same day
  const afterCutoff = new Date('2026-11-20T04:00:00Z');
  assert.equal(getShiftBusinessDate(8, afterCutoff), '2026-11-20');

  // Tourist tax deadline is 5th of next month
  const deadline = getDaysToTouristTaxDeadline('2026-11-20');
  assert.equal(deadline.daysLeft, 15);
});

test('overbooking availability engine allows same-day turnover, flags overlaps, and suggests alternatives', () => {
  // Same-day turnover (10->12 and 12->14) is NOT an overlap
  assert.equal(hasDateOverlap('2026-11-10', '2026-11-12', '2026-11-12', '2026-11-14'), false);
  // Shared night (10->13 and 12->14) IS an overlap
  assert.equal(hasDateOverlap('2026-11-10', '2026-11-13', '2026-11-12', '2026-11-14'), true);

  const seed = createSeedState('2026-11-20');
  // Small #1 is occupied from 2026-11-19 to 2026-11-22
  const conflicts = findRoomConflicts(seed.bookings, 'room-small-1', undefined, '2026-11-20', '2026-11-22');
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].bookingId, 'bkg-small-1');

  // Excluding own booking during extension check yields 0 conflicts
  const selfExcluded = findRoomConflicts(
    seed.bookings,
    'room-small-1',
    undefined,
    '2026-11-19',
    '2026-11-24',
    'bkg-small-1'
  );
  assert.equal(selfExcluded.length, 0);

  // Alternative free rooms prioritize same category (Small #3, #4, #5) first
  const alts = findAlternativeFreeRooms(
    seed.physicalRooms,
    seed.bookings,
    'cat-small',
    '2026-11-20',
    '2026-11-22'
  );
  assert.ok(alts.length >= 3);
  assert.equal(alts[0].sameCategory, true);
  assert.equal(alts[0].categoryId, 'cat-small');
});

test('zero-typing Russian command parser handles Small 3 + Alex Kim + $50 + change UZS + fast laundry', () => {
  const seed = createSeedState('2026-11-20');
  const cmd = parseRussianReceptionCommand(
    'Смолл 3, Алекс Ким, 2 ночи, дал $50, сдача сумами, быстрая стирка',
    seed.physicalRooms,
    seed.roomCategories,
    seed.currency
  );
  assert.equal(cmd.roomId, 'room-small-3');
  assert.equal(cmd.roomLabel, 'Small #3');
  assert.equal(cmd.guestName, 'Алекс Ким');
  assert.equal(cmd.nights, 2);
  assert.equal(cmd.nightlyRateUsd, 18);
  assert.equal(cmd.extras.length, 1);
  assert.equal(cmd.extras[0].type, 'laundry_fast');
  assert.equal(cmd.totalUsd, 38); // 2*18 + 2
  assert.equal(cmd.paidAmount, 50);
  assert.equal(cmd.overpaidUsd, 12);
  assert.equal(cmd.changeUzs, 141000); // floor(12 * 11800 / 1000) * 1000
  assert.equal(cmd.debtUsd, 0);
});

