/**
 * Refined, non-neon Topchan Hostel room color map used for subtle 3px left bars
 * and category indicator dots across both Obsidian Dark and Crisp Daylight themes.
 */
export const TOPCHAN_ROOM_COLORS: Record<string, string> = {
  'cat-small': '#64748B',
  'cat-yellow': '#D97706',
  'cat-orange': '#EA580C',
  'cat-pink': '#DB2777',
  'cat-violet': '#7C3AED',
  'cat-red': '#DC2626',
  'cat-green': '#059669',
  'cat-blue': '#2563EB',
  'cat-mix-dorm': '#0D9488',
  'cat-fem-dorm': '#9333EA',
};

export function getTopchanRoomColor(categoryId: string, fallbackHex = '#64748B'): string {
  return TOPCHAN_ROOM_COLORS[categoryId] ?? fallbackHex;
}
