import type { AppState, BookingGroup, DietaryTag } from '../types/ops';
import { addDaysIso, getTashkentTodayIso } from './time';

export const DIETARY_TAG_LABELS: Record<DietaryTag, string> = {
  halal: 'Халяль',
  vegetarian: 'Вегетарианец',
  no_pork: 'Без свинины',
  gluten_free: 'Без глютена',
  allergy: 'Аллергия',
};

export const ALL_DIETARY_TAGS: DietaryTag[] = [
  'halal',
  'vegetarian',
  'no_pork',
  'gluten_free',
  'allergy',
];

export interface SanitizedBreakfastRoom {
  bookingId: string;
  roomCode: string;
  isDorm: boolean;
  guestCount: number;
  adultsCount: number;
  childrenCount: number;
  isCheckingOutToday: boolean;
  dietaryTags: DietaryTag[];
  dietaryNotes: string[];
}

export interface SanitizedArrivalRoom {
  bookingId: string;
  roomCode: string;
  isDorm: boolean;
  guestCount: number;
  adultsCount: number;
  childrenCount: number;
  expectedArrivalTime?: string;
  isEarlyBefore10: boolean;
  dietaryTags: DietaryTag[];
  dietaryNotes: string[];
}

export interface DietarySummaryItem {
  tag: DietaryTag;
  label: string;
  guestCount: number;
  roomCodes: string[];
}

export interface BreakfastForecast {
  targetDateIso: string;
  inHouseNow: {
    totalGuests: number;
    adultsCount: number;
    childrenCount: number;
    checkingOutTodayCount: number;
    rooms: SanitizedBreakfastRoom[];
  };
  arrivingToday: {
    totalGuests: number;
    earlyArrivalsBefore10: number;
    standardArrivals: number;
    rooms: SanitizedArrivalRoom[];
  };
  todayBreakfastEstimate: {
    minPortions: number;
    maxPortions: number;
    arrivingLaterCount: number;
  };
  tomorrowBreakfastEstimate: {
    totalPortions: number;
    stayingInHouseCount: number;
    arrivingTodayCount: number;
  };
  dietarySummary: DietarySummaryItem[];
  dietaryNotesList: Array<{ roomCode: string; note: string }>;
}

/**
 * Returns true if an HH:mm time string is strictly earlier than 10:00 (00:00..09:59).
 * Guests arriving before 10:00 are likely to eat today's free breakfast (08:00–10:00).
 */
export function isArrivalBeforeTenAm(timeStr?: string): boolean {
  if (!timeStr) return false;
  const match = timeStr.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return false;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return false;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return false;
  return hour < 10;
}

function getBookingDateRange(booking: BookingGroup): { fromDate: string; toDate: string } | null {
  if (!booking.segments || booking.segments.length === 0) return null;
  let minFrom = booking.segments[0].fromDate;
  let maxTo = booking.segments[0].toDate;
  for (const seg of booking.segments) {
    if (seg.fromDate < minFrom) minFrom = seg.fromDate;
    if (seg.toDate > maxTo) maxTo = seg.toDate;
  }
  return { fromDate: minFrom, toDate: maxTo };
}

function resolveRoomMetaForDate(
  state: AppState,
  booking: BookingGroup,
  targetDateIso: string
): { roomCode: string; isDorm: boolean } {
  const seg =
    booking.segments.find((s) => s.fromDate <= targetDateIso && s.toDate >= targetDateIso) ??
    booking.segments[0];
  const room = state.physicalRooms.find((r) => r.id === seg?.roomId);
  if (!room) return { roomCode: 'Номер', isDorm: false };
  const cat = state.roomCategories.find((c) => c.id === room.categoryId);
  const bed = seg?.bedId ? room.beds?.find((b) => b.id === seg.bedId) : undefined;
  const roomCode = bed ? `${room.code} ${bed.label}` : room.code;
  return {
    roomCode,
    isDorm: Boolean(cat?.isDorm || room.beds),
  };
}

/**
 * Deterministic, PII-free, finance-free breakfast forecast engine for Topchan Hostel kitchen.
 *
 * Strictly NEVER exposes passport numbers, DOBs, prices, debts, or guest full names —
 * only room/bed labels, headcounts (adults/children), arrival times, and dietary tags.
 */
export function computeBreakfastForecast(
  state: AppState,
  targetDateIso = state.operationalDate ?? getTashkentTodayIso()
): BreakfastForecast {
  const inHouseRooms: SanitizedBreakfastRoom[] = [];
  const arrivingRooms: SanitizedArrivalRoom[] = [];

  let inHouseTotal = 0;
  let inHouseAdults = 0;
  let inHouseChildren = 0;
  let checkingOutTodayCount = 0;
  let stayingInHouseTomorrow = 0;

  let arrivingTotal = 0;
  let earlyBefore10Count = 0;
  let standardArrivalsCount = 0;
  let arrivingTodayForTomorrow = 0;

  // Dietary aggregation across today's breakfast guests (in-house + early arrivals <10:00)
  const tagCounts = new Map<DietaryTag, { guestCount: number; roomCodes: Set<string> }>();
  const dietaryNotesList: Array<{ roomCode: string; note: string }> = [];

  const recordDietaryForRoom = (roomCode: string, guests: BookingGroup['guests']) => {
    for (const g of guests) {
      if (Array.isArray(g.dietaryTags)) {
        for (const tag of g.dietaryTags) {
          if (!DIETARY_TAG_LABELS[tag]) continue;
          const bucket = tagCounts.get(tag) ?? { guestCount: 0, roomCodes: new Set<string>() };
          bucket.guestCount += 1;
          bucket.roomCodes.add(roomCode);
          tagCounts.set(tag, bucket);
        }
      }
      const note = g.dietaryNote?.trim();
      if (note) {
        dietaryNotesList.push({ roomCode, note });
      }
    }
  };

  for (const booking of state.bookings) {
    if (booking.status === 'cancelled' || booking.status === 'checked_out') continue;
    const range = getBookingDateRange(booking);
    if (!range) continue;

    const guestCount = Math.max(1, booking.guests.length);
    const childrenCount = booking.guests.filter((g) => typeof g.age === 'number' && g.age < 16).length;
    const adultsCount = Math.max(0, guestCount - childrenCount);

    const uniqueTags = Array.from(
      new Set(
        booking.guests.flatMap((g) => (Array.isArray(g.dietaryTags) ? g.dietaryTags : []))
      )
    );
    const roomNotes = booking.guests
      .map((g) => g.dietaryNote?.trim())
      .filter((n): n is string => Boolean(n));

    const { roomCode, isDorm } = resolveRoomMetaForDate(state, booking, targetDateIso);

    // Case 1: Active in-house guests covering this morning (including 12:00 checkouts!)
    if (
      booking.status === 'active' &&
      range.fromDate <= targetDateIso &&
      range.toDate >= targetDateIso
    ) {
      const isCheckingOutToday = range.toDate === targetDateIso;
      inHouseTotal += guestCount;
      inHouseAdults += adultsCount;
      inHouseChildren += childrenCount;
      if (isCheckingOutToday) {
        checkingOutTodayCount += guestCount;
      }
      if (range.toDate > targetDateIso) {
        stayingInHouseTomorrow += guestCount;
      }

      inHouseRooms.push({
        bookingId: booking.id,
        roomCode,
        isDorm,
        guestCount,
        adultsCount,
        childrenCount,
        isCheckingOutToday,
        dietaryTags: uniqueTags,
        dietaryNotes: roomNotes,
      });

      recordDietaryForRoom(roomCode, booking.guests);
      continue;
    }

    // Case 2: Confirmed or pending reservations arriving today (not yet checked in)
    if (
      (booking.status === 'confirmed' || booking.status === 'pending') &&
      range.fromDate === targetDateIso
    ) {
      const isEarly = isArrivalBeforeTenAm(booking.expectedArrivalTime);
      arrivingTotal += guestCount;
      if (isEarly) {
        earlyBefore10Count += guestCount;
        recordDietaryForRoom(roomCode, booking.guests);
      } else {
        standardArrivalsCount += guestCount;
      }
      if (range.toDate > targetDateIso) {
        arrivingTodayForTomorrow += guestCount;
      }

      arrivingRooms.push({
        bookingId: booking.id,
        roomCode,
        isDorm,
        guestCount,
        adultsCount,
        childrenCount,
        expectedArrivalTime: booking.expectedArrivalTime,
        isEarlyBefore10: isEarly,
        dietaryTags: uniqueTags,
        dietaryNotes: roomNotes,
      });
    }
  }

  // Sort rooms: Private rooms first, then Dorms, alphabetically by roomCode
  inHouseRooms.sort((a, b) => {
    if (a.isDorm !== b.isDorm) return a.isDorm ? 1 : -1;
    return a.roomCode.localeCompare(b.roomCode, 'ru');
  });

  arrivingRooms.sort((a, b) => {
    if (a.isEarlyBefore10 !== b.isEarlyBefore10) return a.isEarlyBefore10 ? -1 : 1;
    return (a.expectedArrivalTime ?? '23:59').localeCompare(b.expectedArrivalTime ?? '23:59');
  });

  const dietarySummary: DietarySummaryItem[] = ALL_DIETARY_TAGS.filter((tag) =>
    tagCounts.has(tag)
  ).map((tag) => {
    const entry = tagCounts.get(tag)!;
    return {
      tag,
      label: DIETARY_TAG_LABELS[tag],
      guestCount: entry.guestCount,
      roomCodes: Array.from(entry.roomCodes).sort((a, b) => a.localeCompare(b, 'ru')),
    };
  });

  // Also ensure addDaysIso is exercised cleanly for tomorrow date coherence
  void addDaysIso(targetDateIso, 1);

  return {
    targetDateIso,
    inHouseNow: {
      totalGuests: inHouseTotal,
      adultsCount: inHouseAdults,
      childrenCount: inHouseChildren,
      checkingOutTodayCount,
      rooms: inHouseRooms,
    },
    arrivingToday: {
      totalGuests: arrivingTotal,
      earlyArrivalsBefore10: earlyBefore10Count,
      standardArrivals: standardArrivalsCount,
      rooms: arrivingRooms,
    },
    todayBreakfastEstimate: {
      minPortions: inHouseTotal,
      maxPortions: inHouseTotal + earlyBefore10Count,
      arrivingLaterCount: standardArrivalsCount,
    },
    tomorrowBreakfastEstimate: {
      totalPortions: stayingInHouseTomorrow + arrivingTodayForTomorrow,
      stayingInHouseCount: stayingInHouseTomorrow,
      arrivingTodayCount: arrivingTodayForTomorrow,
    },
    dietarySummary,
    dietaryNotesList,
  };
}
