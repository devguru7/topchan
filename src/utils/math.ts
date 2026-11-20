import type { BookingGroup, CurrencyCode, StayGuest } from '../types/ops';

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function calcDefaultAccRate(cbuUsd: number): number {
  return Math.ceil((cbuUsd + 150) / 100) * 100;
}

export function calcDefaultExRate(cbuUsd: number): number {
  return Math.floor((cbuUsd - 200) / 100) * 100;
}

export function calcAccommodationUzs(usdAmount: number, accRate: number): number {
  if (usdAmount <= 0) return 0;
  return Math.ceil((usdAmount * accRate) / 1000) * 1000;
}

export function calcChangeUzs(overpaidUsd: number, exRate: number): number {
  if (overpaidUsd <= 0) return 0;
  return Math.floor((overpaidUsd * exRate) / 1000) * 1000;
}

export interface BookingFinancials {
  totalChargesUsd: number;
  totalPaymentsUsd: number;
  debtUsd: number;
  overpaidUsd: number;
}

export function calcBookingTotals(booking: Pick<BookingGroup, 'ledgerEntries'>): BookingFinancials {
  let charges = 0;
  let payments = 0;
  for (const entry of booking.ledgerEntries) {
    if (entry.type === 'charge') {
      charges += entry.amountUsd;
    } else if (entry.type === 'payment') {
      payments += entry.amountUsd;
    }
  }
  const totalChargesUsd = round2(charges);
  const totalPaymentsUsd = round2(payments);
  const rawBalance = round2(totalChargesUsd - totalPaymentsUsd);
  return {
    totalChargesUsd,
    totalPaymentsUsd,
    debtUsd: rawBalance > 0 ? rawBalance : 0,
    overpaidUsd: rawBalance < 0 ? round2(Math.abs(rawBalance)) : 0,
  };
}

/**
 * Uzbekistan 2026 Tourist Tax formula per guest per night:
 * - Exempt if age < 16
 * - UZ citizen: bcvUzs * 0.004 (1 760 UZS/night at BCV = 440 000)
 * - Foreigner: bcvUzs * (totalPhysicalRooms <= 10 ? 0.05 : 0.10) (22 000 or 44 000 UZS/night)
 */
export function calcTouristTaxPerNightUzs(
  guest: Pick<StayGuest, 'age' | 'isForeigner'>,
  bcvUzs: number,
  totalPhysicalRooms: number
): number {
  if (guest.age < 16) return 0;
  if (!guest.isForeigner) {
    return Math.round(bcvUzs * 0.004);
  }
  const rate = totalPhysicalRooms <= 10 ? 0.05 : 0.10;
  return Math.round(bcvUzs * rate);
}

export function calcBookingTouristTaxUzs(
  booking: Pick<BookingGroup, 'guests' | 'segments'>,
  bcvUzs: number,
  totalPhysicalRooms: number
): number {
  const totalNights = booking.segments.reduce((acc, seg) => acc + Math.max(1, seg.nights), 0);
  return booking.guests.reduce((sum, guest) => {
    return sum + calcTouristTaxPerNightUzs(guest, bcvUzs, totalPhysicalRooms) * totalNights;
  }, 0);
}

export function calcMonthlyTouristTaxUzs(
  bookings: Array<Pick<BookingGroup, 'guests' | 'segments' | 'status'>>,
  bcvUzs: number,
  totalPhysicalRooms: number
): number {
  return bookings
    .filter((b) => b.status !== 'cancelled')
    .reduce((sum, b) => sum + calcBookingTouristTaxUzs(b, bcvUzs, totalPhysicalRooms), 0);
}

export const UZS_DENOMINATIONS = [200000, 100000, 50000, 20000, 10000, 5000] as const;
export const USD_DENOMINATIONS = [100, 50, 20, 10, 5, 1] as const;

export function calcDenominationTotals(
  uzsCounts: Record<number, number>,
  usdCounts: Record<number, number>
): { totalUzs: number; totalUsd: number } {
  const totalUzs = UZS_DENOMINATIONS.reduce(
    (sum, denom) => sum + denom * Math.max(0, Math.floor(uzsCounts[denom] || 0)),
    0
  );
  const totalUsd = USD_DENOMINATIONS.reduce(
    (sum, denom) => sum + denom * Math.max(0, Math.floor(usdCounts[denom] || 0)),
    0
  );
  return { totalUzs, totalUsd };
}

export interface ChangeCalcResult {
  billUsd: number;
  billUzs: number;
  receivedUsdEquivalent: number;
  overpaidUsd: number;
  underpaidUsd: number;
  changeUsd: number;
  changeUzs: number;
}

export function calcDualRateChange(params: {
  billUsd: number;
  receivedCurrency: CurrencyCode;
  receivedAmount: number;
  accRate: number;
  exRate: number;
  cbuUsd: number;
  cbuEur: number;
}): ChangeCalcResult {
  const { billUsd, receivedCurrency, receivedAmount, accRate, exRate, cbuUsd, cbuEur } = params;
  const cleanBillUsd = Math.max(0, round2(billUsd));
  const cleanReceived = Math.max(0, receivedAmount);
  const billUzs = calcAccommodationUzs(cleanBillUsd, accRate);

  let receivedUsdEquivalent = 0;
  if (receivedCurrency === 'USD') {
    receivedUsdEquivalent = round2(cleanReceived);
  } else if (receivedCurrency === 'UZS') {
    receivedUsdEquivalent = accRate > 0 ? round2(cleanReceived / accRate) : 0;
  } else {
    const eurToUsd = cbuUsd > 0 ? cbuEur / cbuUsd : 1.1;
    receivedUsdEquivalent = round2(cleanReceived * eurToUsd);
  }

  const diffUsd = round2(receivedUsdEquivalent - cleanBillUsd);
  if (diffUsd >= 0) {
    return {
      billUsd: cleanBillUsd,
      billUzs,
      receivedUsdEquivalent,
      overpaidUsd: diffUsd,
      underpaidUsd: 0,
      changeUsd: diffUsd,
      changeUzs: calcChangeUzs(diffUsd, exRate),
    };
  }

  return {
    billUsd: cleanBillUsd,
    billUzs,
    receivedUsdEquivalent,
    overpaidUsd: 0,
    underpaidUsd: round2(Math.abs(diffUsd)),
    changeUsd: 0,
    changeUzs: 0,
  };
}

export function formatUzs(amount: number): string {
  return `${Math.round(amount).toLocaleString('ru-RU')} сум`;
}

export function formatUsd(amount: number): string {
  const fixed = Number.isInteger(amount) ? amount.toString() : amount.toFixed(2);
  return `$${fixed}`;
}

export function formatEur(amount: number): string {
  const fixed = Number.isInteger(amount) ? amount.toString() : amount.toFixed(2);
  return `€${fixed}`;
}

export function formatTimer(totalSeconds: number): string {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const mins = Math.floor(clamped / 60);
  const secs = clamped % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}
