import type { BookingGroup, PhysicalRoom } from '../types/ops';

export interface RoomConflict {
  bookingId: string;
  bnovoId: string;
  guestName: string;
  fromDate: string;
  toDate: string;
  roomId: string;
  bedId?: string;
}

export interface AlternativeRoomOption {
  key: string;
  roomId: string;
  bedId?: string;
  label: string;
  categoryId: string;
  sameCategory: boolean;
}

/**
 * Standard hotel half-open date interval overlap check: [startA, endA) vs [startB, endB).
 * Same-day turnover (endA === startB, e.g., check-out 12:00 / check-in 14:00) is NOT an overlap.
 */
export function hasDateOverlap(
  startA: string,
  endA: string,
  startB: string,
  endB: string
): boolean {
  if (!startA || !endA || !startB || !endB) return false;
  return startA < endB && startB < endA;
}

/**
 * Finds all active bookings conflicting with a target room (and optional dorm bed) in [fromDate, toDate).
 */
export function findRoomConflicts(
  bookings: BookingGroup[],
  roomId: string,
  bedId: string | undefined,
  fromDate: string,
  toDate: string,
  excludeBookingId?: string
): RoomConflict[] {
  const conflicts: RoomConflict[] = [];
  for (const b of bookings) {
    if (b.status !== 'active') continue;
    if (excludeBookingId && b.id === excludeBookingId) continue;

    for (const seg of b.segments) {
      if (seg.roomId !== roomId) continue;
      if (bedId && seg.bedId && seg.bedId !== bedId) continue;
      if ((bedId && !seg.bedId) || (!bedId && seg.bedId)) continue;

      if (hasDateOverlap(fromDate, toDate, seg.fromDate, seg.toDate)) {
        conflicts.push({
          bookingId: b.id,
          bnovoId: b.bnovoId,
          guestName: b.guests[0]?.fullName ?? 'Гость',
          fromDate: seg.fromDate,
          toDate: seg.toDate,
          roomId: seg.roomId,
          bedId: seg.bedId,
        });
      }
    }
  }
  return conflicts;
}

/**
 * Suggests alternative free rooms/beds for [fromDate, toDate), prioritizing the same category first.
 */
export function findAlternativeFreeRooms(
  rooms: PhysicalRoom[],
  bookings: BookingGroup[],
  preferredCategoryId: string,
  fromDate: string,
  toDate: string,
  excludeBookingId?: string
): AlternativeRoomOption[] {
  const results: AlternativeRoomOption[] = [];

  for (const room of rooms) {
    if (room.archived) continue;
    const sameCategory = room.categoryId === preferredCategoryId;

    if (room.beds && room.beds.length > 0) {
      for (const bed of room.beds) {
        if (bed.status === 'maintenance') continue;
        const conflicts = findRoomConflicts(
          bookings,
          room.id,
          bed.id,
          fromDate,
          toDate,
          excludeBookingId
        );
        if (conflicts.length === 0) {
          results.push({
            key: `${room.id}:${bed.id}`,
            roomId: room.id,
            bedId: bed.id,
            label: `${room.code} · Койка ${bed.label} (${bed.tier})`,
            categoryId: room.categoryId,
            sameCategory,
          });
        }
      }
    } else {
      if (room.status === 'maintenance') continue;
      const conflicts = findRoomConflicts(
        bookings,
        room.id,
        undefined,
        fromDate,
        toDate,
        excludeBookingId
      );
      if (conflicts.length === 0) {
        results.push({
          key: room.id,
          roomId: room.id,
          label: room.code,
          categoryId: room.categoryId,
          sameCategory,
        });
      }
    }
  }

  return results.sort((a, b) => {
    if (a.sameCategory !== b.sameCategory) return a.sameCategory ? -1 : 1;
    return a.label.localeCompare(b.label, 'ru');
  });
}
