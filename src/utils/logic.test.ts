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
  const seed = createSeedState();
  const yellow = seed.bookings.find((b) => b.id === 'bkg-yellow-1')!;
  const totals = calcBookingTotals(yellow);
  assert.equal(totals.totalChargesUsd, 53); // 48 + 3 + 2
  assert.equal(totals.totalPaymentsUsd, 48);
  assert.equal(totals.debtUsd, 5);
});

test('Uzbekistan 2026 tourist tax respects age < 16 exemption and room count threshold', () => {
  // Child under 16 is always exempt
  assert.equal(calcTouristTaxPerNightUzs({ age: 11, isForeigner: false }, DEFAULT_BCV_UZS, 15), 0);
  assert.equal(calcTouristTaxPerNightUzs({ age: 15, isForeigner: true }, DEFAULT_BCV_UZS, 15), 0);

  // UZ citizen >= 16: 440 000 * 0.004 = 1 760 UZS
  assert.equal(calcTouristTaxPerNightUzs({ age: 38, isForeigner: false }, DEFAULT_BCV_UZS, 15), 1760);

  // Foreigner >= 16 with <= 10 rooms: 440 000 * 0.05 = 22 000 UZS
  assert.equal(calcTouristTaxPerNightUzs({ age: 30, isForeigner: true }, DEFAULT_BCV_UZS, 10), 22000);

  // Foreigner >= 16 with > 10 rooms: 440 000 * 0.10 = 44 000 UZS
  assert.equal(calcTouristTaxPerNightUzs({ age: 30, isForeigner: true }, DEFAULT_BCV_UZS, 15), 44000);

  // Monthly aggregate across seed bookings must be > 0 and deterministic
  const seed = createSeedState();
  const activeRooms = seed.physicalRooms.filter((r) => !r.archived).length;
  assert.equal(activeRooms, 15);
  const monthlyTax = calcMonthlyTouristTaxUzs(seed.bookings, DEFAULT_BCV_UZS, activeRooms);
  // Foreigner nights: Small1(3) + Small2(2) + Yellow1(2) + Mix4(2) + Green1(4) = 13 * 44000 = 572000
  // UZ adult nights: Blue1(2 adults * 3 nights) = 6 * 1760 = 10560 (child age 11 = 0)
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

test('TD3 MRZ parser extracts Italian and Korean passport fields accurately', () => {
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
});

test('zero-typing Russian command parser handles Small 3 + Alex Kim + $50 + change UZS + fast laundry', () => {
  const seed = createSeedState();
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
