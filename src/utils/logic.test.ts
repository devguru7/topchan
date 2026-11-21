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
  computeDailyAvailabilitySummary,
  findAlternativeFreeRooms,
  findRoomConflicts,
  hasDateOverlap,
} from './availability';
import { createEmptyCashFormDefaults } from './cashFormDefaults';
import {
  computeMrzCheckDigit,
  parseTd3MrzStrict,
  SAMPLE_MRZ_FEMALE_DE,
} from './mrzParser';
import {
  buildCashPnlCsv,
  buildShiftArchiveCsv,
  buildTouristTaxCsv,
} from './exportReports';
import { migrateAppState } from '../services/storageAdapter';
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
  assert.equal(activeRooms, 20);
  const monthlyTax = calcMonthlyTouristTaxUzs(seed.bookings, DEFAULT_BCV_UZS, activeRooms);
  assert.equal(monthlyTax, 572000 + 88000 + 10560);
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
  assert.equal(cmd.roomLabel, 'Small-3');
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

test('Topchan v4 inventory matches exact 20 physical rooms (17 private + 3 dorms / 20 dorm beds = 37 bookable units)', () => {
  const seed = createSeedState('2026-11-20');
  assert.equal(seed.schemaVersion, 4);

  const privateRooms = seed.physicalRooms.filter((r) => !r.beds);
  const dormRooms = seed.physicalRooms.filter((r) => Boolean(r.beds));
  const totalDormBeds = dormRooms.reduce((sum, r) => sum + (r.beds?.length ?? 0), 0);

  assert.equal(seed.physicalRooms.length, 20);
  assert.equal(privateRooms.length, 17);
  assert.equal(dormRooms.length, 3);
  assert.equal(totalDormBeds, 20);
  assert.equal(privateRooms.length + totalDormBeds, 37);

  // Exact category capacities & special attributes
  const byId = new Map(seed.roomCategories.map((c) => [c.id, c]));
  assert.equal(byId.get('cat-orange')?.maxOccupancy, 2);
  assert.equal(byId.get('cat-pink')?.maxOccupancy, 3);
  assert.equal(byId.get('cat-yellow')?.maxOccupancy, 3);
  assert.equal(byId.get('cat-green')?.bedType, 'Double (нераздельная кровать)');
  assert.equal(byId.get('cat-fem-dorm')?.femaleOnly, true);

  // Exact bed counts per dorm
  assert.equal(seed.physicalRooms.find((r) => r.id === 'room-mix-dorm')?.beds?.length, 10);
  assert.equal(seed.physicalRooms.find((r) => r.id === 'room-six-dorm')?.beds?.length, 6);
  assert.equal(seed.physicalRooms.find((r) => r.id === 'room-fem-dorm')?.beds?.length, 4);

  // Command parser recognizes Six Dorm, Yellow-5, Small-6, Mix-10, Fem-4
  const sixCmd = parseRussianReceptionCommand(
    'Сикс 3, Дэвид Ли, 2 ночи, дал $30, сдача сумами',
    seed.physicalRooms,
    seed.roomCategories,
    seed.currency
  );
  assert.equal(sixCmd.roomId, 'room-six-dorm');
  assert.equal(sixCmd.bedId, 'six-bed-3');
  assert.equal(sixCmd.nightlyRateUsd, 12);

  const yellow5Cmd = parseRussianReceptionCommand(
    'Yellow-5, Анна Иванова, 1 ночь, дал $24',
    seed.physicalRooms,
    seed.roomCategories,
    seed.currency
  );
  assert.equal(yellow5Cmd.roomId, 'room-yellow-5');
  assert.equal(yellow5Cmd.roomLabel, 'Yellow-5');
});

test('STAGE 1 BUG 1 & 2: Cyrillic commandParser matches средняя стирка ($3), быстрая стирка ($2), ранний заезд, поздний выезд, and does NOT false-match Смолов as Small', () => {
  const seed = createSeedState('2026-11-20');

  const medLaundry = parseRussianReceptionCommand(
    'Сикс 3, Дэвид Ли, 2 ночи, дал $30, сдача сумами, средняя стирка',
    seed.physicalRooms,
    seed.roomCategories,
    seed.currency
  );
  assert.equal(medLaundry.extras.length, 1);
  assert.equal(medLaundry.extras[0].type, 'laundry_medium');
  assert.equal(medLaundry.extras[0].priceUsd, 3);

  const fastLaundry = parseRussianReceptionCommand(
    'Смолл 4, Иван Петров, 1 ночь, быстрая стирка',
    seed.physicalRooms,
    seed.roomCategories,
    seed.currency
  );
  assert.equal(fastLaundry.extras[0]?.type, 'laundry_fast');
  assert.equal(fastLaundry.extras[0]?.priceUsd, 2);

  const earlyCheckIn = parseRussianReceptionCommand(
    'Йеллоу 2, Алексей Смолов, 2 ночи, ранний заезд, дал $60',
    seed.physicalRooms,
    seed.roomCategories,
    seed.currency
  );
  assert.equal(earlyCheckIn.roomId, 'room-yellow-2');
  assert.equal(earlyCheckIn.guestName, 'Алексей Смолов');
  assert.equal(earlyCheckIn.extras.some((e) => e.type === 'early_late'), true);
  assert.equal(earlyCheckIn.extras.find((e) => e.type === 'early_late')?.priceUsd, 12); // 50% of $24

  const lateCheckOut = parseRussianReceptionCommand(
    'Оранж, Смолов, 1 ночь, поздний выезд',
    seed.physicalRooms,
    seed.roomCategories,
    seed.currency
  );
  assert.equal(lateCheckOut.roomId, 'room-orange-1');
  assert.equal(lateCheckOut.guestName, 'Смолов');
  assert.equal(lateCheckOut.extras.some((e) => e.type === 'early_late'), true);

  // Pure surname "Смолов" without a room keyword must NEVER trigger Small via substring "смол"
  const smolovOnly = parseRussianReceptionCommand(
    'Пинк, Смолов Дмитрий, 1 ночь',
    seed.physicalRooms,
    seed.roomCategories,
    seed.currency
  );
  assert.equal(smolovOnly.roomId, 'room-pink-1');
  assert.equal(smolovOnly.guestName, 'Смолов Дмитрий');
});

test('STAGE 1 BUG 3: computeDailyAvailabilitySummary reflects dirty and maintenance units matching availableUnits KPI', () => {
  const seed = createSeedState('2026-11-20');
  // Put one clean room into maintenance to test both dirty (Red is dirty in seed) and maintenance
  const rooms = seed.physicalRooms.map((r) =>
    r.id === 'room-orange-1' ? { ...r, status: 'maintenance' as const } : r
  );

  const availableUnits = rooms.reduce((sum, r) => {
    if (r.archived) return sum;
    if (r.beds) return sum + r.beds.filter((b) => b.status === 'available').length;
    return sum + (r.status === 'available' ? 1 : 0);
  }, 0);

  const summary = computeDailyAvailabilitySummary(
    rooms,
    seed.bookings,
    ['2026-11-20', '2026-11-21'],
    '2026-11-20'
  );

  assert.equal(summary[0].iso, '2026-11-20');
  assert.equal(summary[0].dirty, 1); // Red is dirty
  assert.equal(summary[0].maintenance, 1); // Orange is maintenance
  assert.equal(summary[0].free, availableUnits);
  assert.equal(
    summary[0].free + summary[0].occupied + summary[0].dirty + summary[0].maintenance,
    37
  );
  // Future day excludes maintenance room from free count
  assert.equal(summary[1].maintenance, 1);
  assert.equal(summary[1].free + summary[1].occupied + summary[1].maintenance, 37);
});

test('STAGE 1 BUG 4: CashTab live form defaults start strictly empty/zero', () => {
  const defaults = createEmptyCashFormDefaults();
  assert.equal(defaults.billInputUsd, '');
  assert.equal(defaults.receivedAmount, '');
  assert.equal(defaults.calcLabel, '');
  assert.equal(defaults.pettyCategory, '');
  assert.equal(defaults.pettyAmount, '');
  assert.equal(defaults.safeUzs, '');
  assert.equal(defaults.safeUsd, '');
  assert.equal(defaults.safeEur, '');
  assert.equal(
    Object.values(defaults.uzsBills).every((v) => v === 0),
    true
  );
  assert.equal(
    Object.values(defaults.usdBills).every((v) => v === 0),
    true
  );
});

test('STAGE 3 MRZ ICAO 9303 TD3: validates 7-3-1 check digits, extracts sex/dob/expiry, and flags tampered checksums', () => {
  assert.equal(computeMrzCheckDigit('520727'), 3);

  const validIta = parseTd3MrzStrict(SAMPLE_MRZ_ITALY, { refYear: 2026 });
  assert.equal(validIta.valid, true);
  assert.equal(validIta.checkDigits.allValid, true);
  assert.equal(validIta.nationality, 'ITA');
  assert.equal(validIta.sex, 'M');
  assert.equal(validIta.dob, '1991-06-15');

  const validDe = parseTd3MrzStrict(SAMPLE_MRZ_FEMALE_DE, { refYear: 2026 });
  assert.equal(validDe.valid, true);
  assert.equal(validDe.checkDigits.allValid, true);
  assert.equal(validDe.sex, 'F');
  assert.equal(validDe.nationality, 'DEU');

  // Corrupt passport number check digit on line 2 (index 9) -> passportValid must flip false
  const [l1, l2] = SAMPLE_MRZ_ITALY.split('\n');
  const badDigit = String((Number(l2[9]) + 1) % 10);
  const tampered = `${l1}\n${l2.slice(0, 9)}${badDigit}${l2.slice(10)}`;
  const parsedTampered = parseTd3MrzStrict(tampered, { refYear: 2026, requireValidCheckDigits: true });
  assert.equal(parsedTampered.valid, false);
  assert.equal(parsedTampered.checkDigits.passportValid, false);
  assert.equal(parsedTampered.checkDigits.allValid, false);
});

test('STAGE 3 CSV Exports: UTF-8 BOM, Uzbekistan BCV 440000 tourist tax, 6-pocket P&L, and Shift Archive', () => {
  const seed = createSeedState('2026-11-20');

  const taxCsv = buildTouristTaxCsv(seed);
  assert.equal(taxCsv.startsWith('\uFEFF'), true);
  assert.ok(taxCsv.includes('440000'));
  assert.ok(taxCsv.includes('10% (11–40 комн.)'));

  const pnlCsv = buildCashPnlCsv(seed);
  assert.equal(pnlCsv.startsWith('\uFEFF'), true);
  assert.ok(pnlCsv.includes('cash_uzs'));
  assert.ok(pnlCsv.includes('cash_usd'));
  assert.ok(pnlCsv.includes('cash_eur'));
  assert.ok(pnlCsv.includes('P&L Сводка'));

  const shiftsCsv = buildShiftArchiveCsv(seed.shiftHistory ?? []);
  assert.equal(shiftsCsv.startsWith('\uFEFF'), true);
  assert.ok(shiftsCsv.includes('Операционный день'));
});

test('STAGE 3 Backward Migration: legacy v4 snapshot missing operationalDate/lostFoundItems/shiftHistory/mailInbox hydrates safely', () => {
  const seed = createSeedState('2026-11-20');
  const legacyRaw = { ...seed } as Record<string, unknown>;
  delete legacyRaw.operationalDate;
  delete legacyRaw.lostFoundItems;
  delete legacyRaw.shiftHistory;
  delete legacyRaw.mailInbox;

  const migrated = migrateAppState(legacyRaw);
  assert.ok(migrated);
  assert.ok(typeof migrated.operationalDate === 'string' && migrated.operationalDate.length === 10);
  assert.ok(Array.isArray(migrated.lostFoundItems));
  assert.ok(Array.isArray(migrated.shiftHistory));
  assert.ok(Array.isArray(migrated.mailInbox));
});



