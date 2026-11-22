import type { BookingGroup, CurrencyCode, StayGuest, StaySegment } from '../types/ops';
import { addDaysIso } from './time';

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

export function countUniqueSegmentNights(segments: StaySegment[]): number {
  if (segments.length === 0) return 0;

  const uniqueNights = new Set<string>();
  let usedDateSpan = false;

  for (const seg of segments) {
    const rawNights = Math.max(0, Math.floor(seg.nights));
    if (rawNights === 0) continue;

    if (seg.fromDate && seg.toDate && seg.fromDate < seg.toDate) {
      usedDateSpan = true;
      let cursor = seg.fromDate;
      // Guard against malformed multi-year spans (cap at 366 days per segment)
      let guard = 0;
      while (cursor < seg.toDate && guard < 366) {
        uniqueNights.add(cursor);
        cursor = addDaysIso(cursor, 1);
        guard += 1;
      }
    } else if (seg.fromDate) {
      usedDateSpan = true;
      for (let i = 0; i < rawNights; i++) {
        uniqueNights.add(addDaysIso(seg.fromDate, i));
      }
    }
  }

  if (usedDateSpan) {
    return uniqueNights.size;
  }

  // Fallback if dates are missing: use max segment duration rather than summing parallel rooms
  return segments.reduce((maxN, seg) => Math.max(maxN, Math.max(0, Math.floor(seg.nights))), 0);
}

export function calcBookingTouristTaxUzs(
  booking: Pick<BookingGroup, 'guests' | 'segments'>,
  bcvUzs: number,
  totalPhysicalRooms: number
): number {
  if (booking.segments.length === 0 || booking.guests.length === 0) return 0;

  const sharedUniqueNights = countUniqueSegmentNights(booking.segments);

  return booking.guests.reduce((sum, guest) => {
    let guestNights = sharedUniqueNights;
    if (guest.segmentId) {
      const assignedSeg = booking.segments.find((s) => s.id === guest.segmentId);
      if (assignedSeg) {
        guestNights = countUniqueSegmentNights([assignedSeg]);
      }
    }
    return sum + calcTouristTaxPerNightUzs(guest, bcvUzs, totalPhysicalRooms) * guestNights;
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
  const cleanBillUsd = Number.isFinite(billUsd) ? Math.max(0, round2(billUsd)) : 0;
  const cleanReceived = Number.isFinite(receivedAmount) ? Math.max(0, receivedAmount) : 0;
  const safeAccRate = Number.isFinite(accRate) && accRate > 0 ? accRate : 0;
  const safeExRate = Number.isFinite(exRate) && exRate > 0 ? exRate : 0;
  const safeCbuUsd = Number.isFinite(cbuUsd) && cbuUsd > 0 ? cbuUsd : 0;
  const safeCbuEur = Number.isFinite(cbuEur) && cbuEur > 0 ? cbuEur : 0;

  const billUzs = safeAccRate > 0 ? calcAccommodationUzs(cleanBillUsd, safeAccRate) : 0;

  // Explicit currency validation — never silently default unknown currencies to EUR
  if (receivedCurrency !== 'USD' && receivedCurrency !== 'UZS' && receivedCurrency !== 'EUR') {
    return {
      billUsd: cleanBillUsd,
      billUzs,
      receivedUsdEquivalent: 0,
      overpaidUsd: 0,
      underpaidUsd: cleanBillUsd,
      changeUsd: 0,
      changeUzs: 0,
    };
  }

  // Same-currency UZS path: NEVER round-trip through exRate (zero spread loss in guest's own currency)
  if (receivedCurrency === 'UZS') {
    const cleanReceivedUzs = Math.round(cleanReceived);
    if (cleanReceivedUzs === billUzs) {
      return {
        billUsd: cleanBillUsd,
        billUzs,
        receivedUsdEquivalent: cleanBillUsd,
        overpaidUsd: 0,
        underpaidUsd: 0,
        changeUsd: 0,
        changeUzs: 0,
      };
    }

    if (cleanReceivedUzs > billUzs) {
      const diffUzs = cleanReceivedUzs - billUzs;
      const changeUzs = Math.floor(diffUzs / 1000) * 1000;
      const overpaidUsd = safeAccRate > 0 ? round2(diffUzs / safeAccRate) : 0;
      return {
        billUsd: cleanBillUsd,
        billUzs,
        receivedUsdEquivalent: safeAccRate > 0 ? round2(cleanBillUsd + overpaidUsd) : cleanBillUsd,
        overpaidUsd,
        underpaidUsd: 0,
        changeUsd: overpaidUsd,
        changeUzs,
      };
    }

    const receivedUsdEquivalent = safeAccRate > 0 ? round2(cleanReceivedUzs / safeAccRate) : 0;
    return {
      billUsd: cleanBillUsd,
      billUzs,
      receivedUsdEquivalent,
      overpaidUsd: 0,
      underpaidUsd: Math.max(0, round2(cleanBillUsd - receivedUsdEquivalent)),
      changeUsd: 0,
      changeUzs: 0,
    };
  }

  // Cross-currency USD or EUR path
  let receivedUsdEquivalent = 0;
  if (receivedCurrency === 'USD') {
    receivedUsdEquivalent = round2(cleanReceived);
  } else {
    // EUR
    const eurToUsd = safeCbuUsd > 0 && safeCbuEur > 0 ? safeCbuEur / safeCbuUsd : 0;
    receivedUsdEquivalent = eurToUsd > 0 ? round2(cleanReceived * eurToUsd) : 0;
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
      changeUzs: safeExRate > 0 ? calcChangeUzs(diffUsd, safeExRate) : 0,
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
