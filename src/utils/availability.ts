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

export interface DailyAvailabilityPoint {
  iso: string;
  total: number;
  occupied: number;
  dirty: number;
  maintenance: number;
  free: number; // ready to sell (clean & not occupied & not maintenance)
  pct: number;
}

/**
 * Computes daily availability across all bookable units (rooms + dorm beds).
 * On `todayIso`, reflects real unit statuses (occupied, dirty, maintenance) so `free`
 * strictly matches the top-level `availableUnits` KPI.
 * On future dates, accounts for scheduled booking segments and units out-of-order in maintenance.
 */
export function computeDailyAvailabilitySummary(
  rooms: PhysicalRoom[],
  bookings: BookingGroup[],
  dates: string[],
  todayIso: string
): DailyAvailabilityPoint[] {
  const units: Array<{ key: string; status: 'available' | 'occupied' | 'dirty' | 'maintenance' }> = [];
  for (const room of rooms) {
    if (room.archived) continue;
    if (room.beds && room.beds.length > 0) {
      for (const bed of room.beds) {
        units.push({ key: `${room.id}:${bed.id}`, status: bed.status });
      }
    } else {
      units.push({ key: room.id, status: room.status });
    }
  }

  const total = units.length;
  const activeBookings = bookings.filter((b) => b.status === 'active');

  return dates.map((iso) => {
    if (iso === todayIso) {
      let occupied = 0;
      let dirty = 0;
      let maintenance = 0;
      for (const u of units) {
        if (u.status === 'occupied') occupied += 1;
        else if (u.status === 'dirty') dirty += 1;
        else if (u.status === 'maintenance') maintenance += 1;
      }
      const free = Math.max(0, total - occupied - dirty - maintenance);
      const pct = total > 0 ? Math.round((occupied / total) * 100) : 0;
      return { iso, total, occupied, dirty, maintenance, free, pct };
    }

    const occupiedKeys = new Set<string>();
    for (const b of activeBookings) {
      for (const seg of b.segments) {
        if (seg.fromDate <= iso && iso < seg.toDate) {
          occupiedKeys.add(seg.bedId ? `${seg.roomId}:${seg.bedId}` : seg.roomId);
        }
      }
    }

    let maintenance = 0;
    for (const u of units) {
      if (u.status === 'maintenance' && !occupiedKeys.has(u.key)) {
        maintenance += 1;
      }
    }

    const occupied = occupiedKeys.size;
    const dirty = 0;
    const free = Math.max(0, total - occupied - maintenance);
    const pct = total > 0 ? Math.round((occupied / total) * 100) : 0;
    return { iso, total, occupied, dirty, maintenance, free, pct };
  });
}

