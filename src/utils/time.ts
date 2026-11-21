const TASHKENT_TZ = 'Asia/Tashkent';

/**
 * Returns the current Date parts in Asia/Tashkent (UTC+5) timezone.
 */
export function getTashkentParts(date: Date = new Date()): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: TASHKENT_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = formatter.formatToParts(date);
  const pick = (type: string) =>
    parseInt(parts.find((p) => p.type === type)?.value ?? '0', 10);

  return {
    year: pick('year'),
    month: pick('month'),
    day: pick('day'),
    hour: pick('hour'),
    minute: pick('minute'),
    second: pick('second'),
  };
}

/**
 * Returns current Date object representing now (paired with Tashkent helpers).
 */
export function getTashkentNow(): Date {
  return new Date();
}

/**
 * Returns YYYY-MM-DD for today in Asia/Tashkent.
 */
export function getTashkentTodayIso(date: Date = new Date()): string {
  const p = getTashkentParts(date);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/**
 * Returns current 4-digit year in Asia/Tashkent.
 */
export function getTashkentYear(date: Date = new Date()): number {
  return getTashkentParts(date).year;
}

/**
 * Formats DD.MM.YYYY in Asia/Tashkent.
 */
export function formatTashkentDateRu(date: Date = new Date()): string {
  const p = getTashkentParts(date);
  return `${String(p.day).padStart(2, '0')}.${String(p.month).padStart(2, '0')}.${p.year}`;
}

/**
 * Formats live HH:MM:SS clock string in Asia/Tashkent.
 */
export function formatTashkentClock(date: Date = new Date()): string {
  const p = getTashkentParts(date);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}:${String(p.second).padStart(2, '0')}`;
}

/**
 * Formats HH:MM in Asia/Tashkent.
 */
export function formatTashkentHm(date: Date = new Date()): string {
  const p = getTashkentParts(date);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

/**
 * Adds or subtracts whole calendar days from an ISO date string (YYYY-MM-DD).
 */
export function addDaysIso(baseIso: string, days: number): string {
  const [y, m, d] = baseIso.split('-').map((n) => parseInt(n, 10));
  if (!y || !m || !d) return baseIso;
  const utc = new Date(Date.UTC(y, m - 1, d + days));
  const yy = utc.getUTCFullYear();
  const mm = String(utc.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(utc.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/**
 * Returns an array of N consecutive ISO dates starting from startIso.
 */
export function getDateRangeIso(startIso: string, count: number): string[] {
  return Array.from({ length: Math.max(0, count) }, (_, i) => addDaysIso(startIso, i));
}

/**
 * Returns the business shift date in Asia/Tashkent.
 * Before cutoffHour (default 08:00), night shift still belongs to the previous calendar day.
 */
export function getShiftBusinessDate(cutoffHour = 8, date: Date = new Date()): string {
  const p = getTashkentParts(date);
  const todayIso = `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
  return p.hour < cutoffHour ? addDaysIso(todayIso, -1) : todayIso;
}

/**
 * Computes days remaining until the 5th of next month (Uzbekistan tourist tax payment deadline).
 */
export function getDaysToTouristTaxDeadline(dateInput: Date | string = new Date()): {
  daysLeft: number;
  deadlineLabel: string;
  monthProgressPct: number;
} {
  const date =
    typeof dateInput === 'string'
      ? new Date(`${dateInput}T12:00:00+05:00`)
      : dateInput;
  const p = getTashkentParts(date);
  const daysInMonth = new Date(Date.UTC(p.year, p.month, 0)).getUTCDate();
  const monthProgressPct = Math.min(100, Math.round((p.day / daysInMonth) * 100));

  if (p.day <= 5) {
    return {
      daysLeft: 5 - p.day,
      deadlineLabel: `05.${String(p.month).padStart(2, '0')}.${p.year}`,
      monthProgressPct,
    };
  }
  const nextMonth = p.month === 12 ? 1 : p.month + 1;
  const nextYear = p.month === 12 ? p.year + 1 : p.year;
  const daysLeft = daysInMonth - p.day + 5;
  return {
    daysLeft,
    deadlineLabel: `05.${String(nextMonth).padStart(2, '0')}.${nextYear}`,
    monthProgressPct,
  };
}

const RU_WEEKDAYS = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'] as const;

export function formatShortDateColumn(iso: string): {
  dayNum: string;
  dayMonth: string;
  weekday: string;
  isWeekend: boolean;
} {
  const [y, m, d] = iso.split('-').map((n) => parseInt(n, 10));
  const dt = new Date(Date.UTC(y, m - 1, d));
  const wd = dt.getUTCDay();
  const dayMonth = `${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')}`;
  return {
    dayNum: dayMonth,
    dayMonth,
    weekday: RU_WEEKDAYS[wd] ?? '',
    isWeekend: wd === 0 || wd === 6,
  };
}
