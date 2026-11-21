import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calcAccommodationUzs,
  calcBookingTotals,
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
