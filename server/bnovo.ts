/**
 * Real Bnovo API v1 («Старт») Server-Side Client
 * Handles JWT authentication with 23-hour cache, automatic 401 refresh,
 * and exponential backoff retry on HTTP 429 rate limits.
 */

const BNOVO_BASE_URL = 'https://api.pms.bnovo.ru/api/v1';
const TOKEN_TTL_MS = 23 * 60 * 60 * 1000; // 23 hours

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

  const res = await fetch(`${BNOVO_BASE_URL}/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      id: Number.isNaN(Number(accountId)) ? accountId : Number(accountId),
      password: apiKey,
    }),
  });

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

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: 'application/json',
    },
  });

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
    const raw = (await bnovoFetchWithRetry('/bookings', {
      date_from: dateFrom,
      date_to: dateTo,
      data_type: 'check_in',
    })) as {
      data?: { bookings?: Array<Record<string, unknown>> };
      bookings?: Array<Record<string, unknown>>;
    };

    const items = raw.data?.bookings ?? raw.bookings ?? [];
    const bookings: BnovoBookingSummary[] = items.map((item) => {
      const customer = (item.customer ?? {}) as Record<string, unknown>;
      const nameParts = [customer.name, customer.surname].filter(Boolean).join(' ').trim();
      const dates = (item.dates ?? {}) as Record<string, unknown>;
      const prices = (item.prices ?? {}) as Record<string, unknown>;
      return {
        id: String(item.id ?? ''),
        number: String(item.number ?? item.id ?? ''),
        guestName: nameParts || String(item.guest_name ?? 'Гость Bnovo'),
        arrival: String(dates.arrival ?? item.arrival ?? dateFrom).slice(0, 10),
        departure: String(dates.departure ?? item.departure ?? dateTo).slice(0, 10),
        status: String((item.status as Record<string, unknown>)?.name ?? item.status ?? 'confirmed'),
        totalAmount: Number(prices.total ?? item.amount ?? 0),
        currency: String(prices.currency ?? 'USD'),
        source: String((item.source as Record<string, unknown>)?.name ?? 'Bnovo'),
      };
    });

    return {
      configured: true,
      ok: true,
      bookings,
      syncedAt,
      note: `Синхронизировано ${bookings.length} броней из Bnovo API v1.`,
    };
  } catch (err) {
    return {
      configured: true,
      ok: false,
      bookings: [],
      syncedAt,
      note: err instanceof Error ? err.message : 'Ошибка запроса Bnovo API',
    };
  }
}
