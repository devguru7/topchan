/**
 * Real Bnovo API v1 («Старт») Server-Side Client
 * Handles:
 * - JWT authentication with 23-hour cache & automatic 401 refresh
 * - Exponential backoff retry on HTTP 429 rate limits
 * - Rolling 14-day lookback window so in-house guests checked in before dateFrom are NEVER dropped
 * - Full pagination loop (up to 20 pages)
 * - Locale-safe numeric parsing (handles European comma decimals like "100,50")
 */

const BNOVO_BASE_URL = 'https://api.pms.bnovo.ru/api/v1';
const TOKEN_TTL_MS = 23 * 60 * 60 * 1000; // 23 hours
const PAGE_LIMIT = 50;
const MAX_PAGES = 20;
const ROLLING_LOOKBACK_DAYS = 14;

interface CachedToken {
  jwt: string;
  expiresAt: number;
}

let cachedToken: CachedToken | null = null;

export interface BnovoBookingSummary {
  id: string;
  number: string;
  guestName: string;
  arrival: string;
  departure: string;
  status: string;
  totalAmount: number;
  currency: string;
  source: string;
}

export interface BnovoSyncResponse {
  configured: boolean;
  ok: boolean;
  bookings: BnovoBookingSummary[];
  syncedAt: string;
  note: string;
}

/**
 * Safely parses locale-formatted money values (e.g. "100,50", "1 250,75 USD", 48.5)
 * into a finite non-NaN number.
 */
export function parseSafeAmount(val: unknown): number {
  if (typeof val === 'number') {
    return Number.isFinite(val) ? val : 0;
  }
  if (typeof val !== 'string') {
    return 0;
  }
  const cleaned = val
    .trim()
    .replace(/\s+/g, '')
    .replace(/[^0-9,.-]/g, '');
  if (!cleaned) return 0;

  // Handle both "1,250.50" and "100,50" / "1.250,50"
  let normalized = cleaned;
  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    if (lastComma > lastDot) {
      normalized = cleaned.replace(/\./g, '').replace(',', '.');
    } else {
      normalized = cleaned.replace(/,/g, '');
    }
  } else if (lastComma > -1) {
    normalized = cleaned.replace(',', '.');
  }

  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function shiftIsoDate(isoDate: string, deltaDays: number): string {
  const m = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return isoDate;
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + deltaDays));
  const y = dt.getUTCFullYear();
  const mo = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${mo}-${d}`;
}

export function isBnovoConfigured(): boolean {
  return Boolean(process.env.BNOVO_ACCOUNT_ID?.trim() && process.env.BNOVO_API_KEY?.trim());
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function authenticateBnovo(forceRefresh = false): Promise<string> {
  if (!forceRefresh && cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.jwt;
  }

  const accountId = process.env.BNOVO_ACCOUNT_ID?.trim();
  const apiKey = process.env.BNOVO_API_KEY?.trim();
  if (!accountId || !apiKey) {
    throw new Error('BNOVO_NOT_CONFIGURED');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  const res = await fetch(`${BNOVO_BASE_URL}/auth`, {
    method: 'POST',
    signal: controller.signal,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      id: Number.isNaN(Number(accountId)) ? accountId : Number(accountId),
      password: apiKey,
    }),
  }).finally(() => clearTimeout(timer));

  if (!res.ok) {
    const bodyText = await res.text().catch(() => '');
    throw new Error(`Bnovo auth HTTP ${res.status}: ${bodyText.slice(0, 180)}`);
  }

  const payload = (await res.json()) as {
    data?: { access_token?: string; token?: string };
    access_token?: string;
    token?: string;
  };
  const jwt =
    payload.data?.access_token ??
    payload.data?.token ??
    payload.access_token ??
    payload.token;

  if (!jwt) {
    throw new Error('Bnovo auth response did not include JWT token');
  }

  cachedToken = { jwt, expiresAt: Date.now() + TOKEN_TTL_MS };
  return jwt;
}

async function bnovoFetchWithRetry(
  path: string,
  params: Record<string, string>,
  attempt = 0,
  retriedAuth = false
): Promise<unknown> {
  const jwt = await authenticateBnovo(false);
  const qs = new URLSearchParams(params).toString();
  const url = `${BNOVO_BASE_URL}${path}${qs ? `?${qs}` : ''}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  const res = await fetch(url, {
    method: 'GET',
    signal: controller.signal,
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: 'application/json',
    },
  }).finally(() => clearTimeout(timer));

  if (res.status === 401 && !retriedAuth) {
    cachedToken = null;
    await authenticateBnovo(true);
    return bnovoFetchWithRetry(path, params, attempt, true);
  }

  if (res.status === 429 && attempt < 3) {
    const delayMs = Math.min(8000, 600 * Math.pow(2, attempt));
    await sleep(delayMs);
    return bnovoFetchWithRetry(path, params, attempt + 1, retriedAuth);
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Bnovo API HTTP ${res.status}: ${errText.slice(0, 180)}`);
  }

  return res.json();
}

export async function getBnovoBookings(
  dateFrom: string,
  dateTo: string
): Promise<BnovoSyncResponse> {
  const syncedAt = new Date().toISOString();
  if (!isBnovoConfigured()) {
    return {
      configured: false,
      ok: true,
      bookings: [],
      syncedAt,
      note: 'Bnovo API не подключён: укажите BNOVO_ACCOUNT_ID и BNOVO_API_KEY в .env (Меню → Bnovo Octopus → API-доступ).',
    };
  }

  try {
    // Rolling 14-day lookback window ensures guests already in-house before dateFrom are included
    const rollingFrom = shiftIsoDate(dateFrom, -ROLLING_LOOKBACK_DAYS);
    const seenIds = new Set<string>();
    const bookings: BnovoBookingSummary[] = [];

    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const raw = (await bnovoFetchWithRetry('/bookings', {
        date_from: rollingFrom,
        date_to: dateTo,
        limit: String(PAGE_LIMIT),
        offset: String((page - 1) * PAGE_LIMIT),
        page: String(page),
      })) as {
        data?: { bookings?: Array<Record<string, unknown>> };
        bookings?: Array<Record<string, unknown>>;
      };

      const items = raw.data?.bookings ?? raw.bookings ?? [];
      if (items.length === 0) break;

      let addedOnPage = 0;
      for (const item of items) {
        const id = String(item.id ?? '');
        if (id && seenIds.has(id)) continue;
        if (id) seenIds.add(id);

        const customer = (item.customer ?? {}) as Record<string, unknown>;
        const nameParts = [customer.name, customer.surname].filter(Boolean).join(' ').trim();
        const dates = (item.dates ?? {}) as Record<string, unknown>;
        const prices = (item.prices ?? {}) as Record<string, unknown>;

        const arrival = String(dates.arrival ?? item.arrival ?? dateFrom).slice(0, 10);
        const departure = String(dates.departure ?? item.departure ?? dateTo).slice(0, 10);

        // Keep stays overlapping [dateFrom, dateTo] (including in-house guests)
        if (departure < dateFrom || arrival > dateTo) {
          continue;
        }

        bookings.push({
          id,
          number: String(item.number ?? item.id ?? ''),
          guestName: nameParts || String(item.guest_name ?? 'Гость Bnovo'),
          arrival,
          departure,
          status: String((item.status as Record<string, unknown>)?.name ?? item.status ?? 'confirmed'),
          totalAmount: parseSafeAmount(prices.total ?? item.amount ?? 0),
          currency: String(prices.currency ?? 'USD'),
          source: String((item.source as Record<string, unknown>)?.name ?? 'Bnovo'),
        });
        addedOnPage += 1;
      }

      if (items.length < PAGE_LIMIT || addedOnPage === 0) {
        break;
      }
    }

    return {
      configured: true,
      ok: true,
      bookings,
      syncedAt,
      note: `Синхронизировано ${bookings.length} броней из Bnovo API v1 (окно ${rollingFrom} → ${dateTo}).`,
    };
  } catch (err) {
    console.error('[Bnovo Sync] Error:', err);
    return {
      configured: true,
      ok: false,
      bookings: [],
      syncedAt,
      note: 'Не удалось получить брони из Bnovo API v1. Проверьте ключи и доступность сервиса.',
    };
  }
}
