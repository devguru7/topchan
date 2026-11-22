import 'dotenv/config';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type NextFunction, type Request, type Response } from 'express';
import { getBnovoBookings, isBnovoConfigured } from './bnovo.ts';
import {
  draftGuestReplyWithGemini,
  extractMrzWithGemini,
  isGeminiConfigured,
  parseCommandWithGemini,
} from './gemini.ts';
import {
  getMailInboxSnapshot,
  isMailWatcherConfigured,
  pollYandexImapOnce,
  startMailWatcher,
} from './mailWatcher.ts';
import {
  getTelegramAuditLog,
  handleTelegramWebhookUpdate,
  isTelegramConfigured,
  sendTelegramMessage,
  startTelegramScheduler,
  updateLiveOpsSnapshot,
} from './telegramBot.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const PORT = Number(process.env.PORT) || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

// Asia/Tashkent (UTC+5) YYYY-MM-DD helper for server routes
function getTashkentTodayServerIso(): string {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tashkent',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = dtf.formatToParts(new Date());
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '01';
  return `${pick('year')}-${pick('month')}-${pick('day')}`;
}

export function constantTimeTokenMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Wraps Express async route handlers so any rejected promise is forwarded to global error middleware.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// Short-lived cache for verified Supabase JWTs (keyed by SHA-256 of token, never storing raw token)
const SUPABASE_JWT_CACHE_TTL_MS = 30_000;
const supabaseJwtCache = new Map<string, { userId: string; expiresAt: number }>();

function decodeBase64UrlJson(segment: string): Record<string, unknown> | null {
  try {
    const padded = segment.replace(/-/g, '+').replace(/_/g, '/');
    const padLen = (4 - (padded.length % 4)) % 4;
    const jsonStr = Buffer.from(padded + '='.repeat(padLen), 'base64').toString('utf8');
    const parsed = JSON.parse(jsonStr);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Verifies a Supabase Bearer JWT using either:
 * 1) Local HS256 cryptographic signature verification via `SUPABASE_JWT_SECRET`, or
 * 2) Authoritative Supabase Auth API lookup (`GET ${SUPABASE_URL}/auth/v1/user`).
 */
export async function verifySupabaseJwt(
  token: string,
  options?: {
    jwtSecret?: string;
    supabaseUrl?: string;
    supabaseAnonKey?: string;
    fetchImpl?: typeof fetch;
  }
): Promise<{ ok: boolean; userId?: string }> {
  const jwtSecret = (options?.jwtSecret ?? process.env.SUPABASE_JWT_SECRET ?? '').trim();
  const supabaseUrl = (
    options?.supabaseUrl ??
    process.env.SUPABASE_URL ??
    process.env.VITE_SUPABASE_URL ??
    ''
  )
    .trim()
    .replace(/\/+$/, '');
  const supabaseAnonKey = (
    options?.supabaseAnonKey ??
    process.env.SUPABASE_ANON_KEY ??
    process.env.VITE_SUPABASE_ANON_KEY ??
    ''
  ).trim();

  // Path 1: Local HS256 JWT signature verification via SUPABASE_JWT_SECRET
  if (jwtSecret) {
    const parts = token.split('.');
    if (parts.length !== 3) return { ok: false };
    const [headerB64, payloadB64, sigB64] = parts;
    const header = decodeBase64UrlJson(headerB64);
    const payload = decodeBase64UrlJson(payloadB64);
    if (!header || !payload || header.alg !== 'HS256') {
      return { ok: false };
    }
    const expectedSig = crypto
      .createHmac('sha256', jwtSecret)
      .update(`${headerB64}.${payloadB64}`)
      .digest('base64url');
    if (!constantTimeTokenMatch(sigB64, expectedSig)) {
      return { ok: false };
    }
    const nowSec = Math.floor(Date.now() / 1000);
    if (typeof payload.exp === 'number' && payload.exp <= nowSec) {
      return { ok: false };
    }
    if (typeof payload.nbf === 'number' && payload.nbf > nowSec) {
      return { ok: false };
    }
    const sub = typeof payload.sub === 'string' && payload.sub.trim() ? payload.sub.trim() : '';
    if (!sub) return { ok: false };
    return { ok: true, userId: sub };
  }

  // Path 2: Remote verification via Supabase Auth `/auth/v1/user`
  if (supabaseUrl.startsWith('https://') && supabaseAnonKey) {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const cached = supabaseJwtCache.get(tokenHash);
    if (cached && cached.expiresAt > Date.now()) {
      return { ok: true, userId: cached.userId };
    }

    const fetchFn = options?.fetchImpl ?? globalThis.fetch.bind(globalThis);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    try {
      const res = await fetchFn(`${supabaseUrl}/auth/v1/user`, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
      });
      if (!res.ok) return { ok: false };
      const body = (await res.json()) as { id?: string };
      if (typeof body?.id !== 'string' || !body.id.trim()) {
        return { ok: false };
      }
      supabaseJwtCache.set(tokenHash, {
        userId: body.id,
        expiresAt: Date.now() + SUPABASE_JWT_CACHE_TTL_MS,
      });
      if (supabaseJwtCache.size > 500) {
        const now = Date.now();
        for (const [k, v] of supabaseJwtCache.entries()) {
          if (v.expiresAt <= now) supabaseJwtCache.delete(k);
        }
      }
      return { ok: true, userId: body.id };
    } catch {
      return { ok: false };
    } finally {
      clearTimeout(timer);
    }
  }

  return { ok: false };
}

function isSupabaseAuthConfigured(): boolean {
  const hasSecret = Boolean(process.env.SUPABASE_JWT_SECRET?.trim());
  const hasRest = Boolean(
    (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL)?.trim().startsWith('https://') &&
      (process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY)?.trim()
  );
  return hasSecret || hasRest;
}

// Allowed CORS origins parsed from CORS_ORIGIN + APP_URL + local dev origin
function getAllowedOrigins(): Set<string> {
  const origins = new Set<string>();
  const rawList = [process.env.CORS_ORIGIN, process.env.APP_URL, `http://localhost:${PORT}`];
  for (const raw of rawList) {
    if (!raw) continue;
    for (const entry of raw.split(',')) {
      const cleaned = entry.trim().replace(/\/+$/, '');
      if (cleaned && cleaned !== 'MY_APP_URL') {
        origins.add(cleaned);
      }
    }
  }
  return origins;
}

// Lightweight in-memory sliding-window rate limiter per IP
function createRateLimiter(maxRequests: number, windowMs: number) {
  const hits = new Map<string, number[]>();

  return (req: Request, res: Response, next: NextFunction) => {
    const forwarded = req.headers['x-forwarded-for'];
    const ip =
      (typeof forwarded === 'string' ? forwarded.split(',')[0]?.trim() : undefined) ||
      req.ip ||
      req.socket.remoteAddress ||
      'unknown';

    const now = Date.now();
    const cutoff = now - windowMs;
    const recent = (hits.get(ip) ?? []).filter((ts) => ts > cutoff);

    if (recent.length >= maxRequests) {
      const retryAfterSec = Math.max(1, Math.ceil((recent[0] + windowMs - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSec));
      return res.status(429).json({
        ok: false,
        error: 'Превышен лимит запросов. Повторите попытку через минуту.',
      });
    }

    recent.push(now);
    hits.set(ip, recent);

    if (hits.size > 2000) {
      for (const [key, list] of hits.entries()) {
        if (list.every((ts) => ts <= cutoff)) {
          hits.delete(key);
        }
      }
    }

    return next();
  };
}

// Bearer Auth guard for protected /api/* routes (supports API_AUTH_TOKEN + Supabase JWT)
const PUBLIC_API_PATHS = new Set(['/api/health', '/api/rates/cbu', '/api/telegram/webhook']);

export const apiAuthMiddleware = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    if (req.method === 'OPTIONS' || PUBLIC_API_PATHS.has(req.path)) {
      return next();
    }

    const expectedToken = process.env.API_AUTH_TOKEN?.trim();
    const supabaseConfigured = isSupabaseAuthConfigured();

    if (!expectedToken && !supabaseConfigured) {
      if (IS_PROD) {
        return res.status(401).json({
          ok: false,
          error: 'Авторизация API не настроена на сервере.',
        });
      }
      return next();
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        ok: false,
        error: 'Требуется заголовок Authorization: Bearer <token>.',
      });
    }

    const provided = authHeader.slice('Bearer '.length).trim();
    if (!provided) {
      return res.status(401).json({
        ok: false,
        error: 'Пустой токен авторизации.',
      });
    }

    // 1. Static API_AUTH_TOKEN match
    if (expectedToken && constantTimeTokenMatch(provided, expectedToken)) {
      return next();
    }

    // 2. Supabase Auth JWT verification
    if (supabaseConfigured) {
      const jwtResult = await verifySupabaseJwt(provided);
      if (jwtResult.ok) {
        (req as Request & { authUserId?: string }).authUserId = jwtResult.userId;
        return next();
      }
    }

    return res.status(403).json({
      ok: false,
      error: 'Недействительный токен доступа API или сессия Supabase.',
    });
  }
);

/**
 * Validates Telegram webhook secret headers.
 * In production, rejects requests (503) if TELEGRAM_WEBHOOK_SECRET is unset to prevent spoofing.
 */
export function validateTelegramWebhookSecret(params: {
  isProd: boolean;
  expectedSecret?: string;
  providedSecret?: string;
}): { ok: boolean; status: number; error?: string } {
  const expected = params.expectedSecret?.trim() ?? '';
  if (!expected) {
    if (params.isProd) {
      return {
        ok: false,
        status: 503,
        error: 'TELEGRAM_WEBHOOK_SECRET не настроен в production — вебхук заблокирован.',
      };
    }
    return { ok: true, status: 200 };
  }
  const provided = params.providedSecret ?? '';
  if (!provided || !constantTimeTokenMatch(provided, expected)) {
    return {
      ok: false,
      status: 403,
      error: 'Invalid Telegram webhook secret.',
    };
  }
  return { ok: true, status: 200 };
}

// 1-hour in-memory cache for Central Bank of Uzbekistan (cbu.uz) exchange rates
const CBU_CACHE_TTL_MS = 60 * 60 * 1000;
let cbuCache: {
  usd: number;
  eur: number;
  date: string;
  source: 'live' | 'fallback';
  cachedAt: number;
} | null = null;

async function fetchCbuRates() {
  if (cbuCache && Date.now() - cbuCache.cachedAt < CBU_CACHE_TTL_MS) {
    return cbuCache;
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4500);
    const res = await fetch('https://cbu.uz/ru/arkhiv-kursov-valyut/json/', {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    }).finally(() => clearTimeout(timer));

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const list = (await res.json()) as Array<{ Ccy: string; Rate: string; Date: string }>;
    const usdRow = list.find((item) => item.Ccy === 'USD');
    const eurRow = list.find((item) => item.Ccy === 'EUR');
    const usd = Number.parseFloat(usdRow?.Rate ?? '');
    const eur = Number.parseFloat(eurRow?.Rate ?? '');

    if (Number.isFinite(usd) && usd > 5000) {
      cbuCache = {
        usd,
        eur: Number.isFinite(eur) && eur > 5000 ? eur : 13280.68,
        date: usdRow?.Date ?? getTashkentTodayServerIso(),
        source: 'live',
        cachedAt: Date.now(),
      };
      return cbuCache;
    }
    throw new Error('Invalid CBU payload');
  } catch {
    return (
      cbuCache ?? {
        usd: 12004.48,
        eur: 13280.68,
        date: getTashkentTodayServerIso(),
        source: 'fallback' as const,
        cachedAt: Date.now(),
      }
    );
  }
}

async function startServer() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '7mb' }));

  const allowedOrigins = getAllowedOrigins();

  // Baseline security headers
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    if (req.path.startsWith('/api/')) {
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('Cache-Control', 'no-store');
    }
    next();
  });

  // Strict CORS whitelist on /api/*
  app.use('/api', (req, res, next) => {
    const origin = req.headers.origin?.replace(/\/+$/, '');
    if (origin) {
      const requestHostOrigin = req.headers.host ? `${req.protocol}://${req.headers.host}` : '';
      const isAllowed = origin === requestHostOrigin || allowedOrigins.has(origin);
      if (!isAllowed) {
        return res.status(403).json({
          ok: false,
          error: 'CORS: источник запроса не разрешён.',
        });
      }
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      if (req.method === 'OPTIONS') {
        return res.status(204).end();
      }
    }
    return next();
  });

  // Rate limiters + Bearer Auth (API_AUTH_TOKEN or Supabase JWT)
  const generalApiLimiter = createRateLimiter(60, 60_000);
  const aiApiLimiter = createRateLimiter(15, 60_000);
  app.use('/api', generalApiLimiter);
  app.use('/api', apiAuthMiddleware);
  app.use('/api/ai', aiApiLimiter);

  if (!process.env.API_AUTH_TOKEN?.trim() && !isSupabaseAuthConfigured()) {
    console.warn(
      IS_PROD
        ? '[Topchan Security] WARNING: Neither API_AUTH_TOKEN nor Supabase JWT auth is configured in production — protected /api/* routes will reject requests with 401.'
        : '[Topchan Security] Dev mode: API_AUTH_TOKEN & Supabase JWT auth not set; configure before production deployment.'
    );
  }

  // 1. Health check (public)
  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'topchan-ops',
      timezone: 'Asia/Tashkent',
      geminiConfigured: isGeminiConfigured(),
      bnovoConfigured: isBnovoConfigured(),
      telegramConfigured: isTelegramConfigured(),
      mailWatcherConfigured: isMailWatcherConfigured(),
      authProtected: Boolean(process.env.API_AUTH_TOKEN?.trim() || isSupabaseAuthConfigured()),
      timestamp: new Date().toISOString(),
    });
  });

  // 2. Central Bank of Uzbekistan live exchange rates (public, 1h cache)
  app.get(
    '/api/rates/cbu',
    asyncHandler(async (_req, res) => {
      const rates = await fetchCbuRates();
      res.json({
        ok: true,
        usd: rates.usd,
        eur: rates.eur,
        date: rates.date,
        source: rates.source,
      });
    })
  );

  // 3. AI Smart Russian Reception Command Parser
  app.post(
    '/api/ai/parse-command',
    asyncHandler(async (req, res) => {
      const { text, availableRooms, categories } = req.body ?? {};
      if (typeof text !== 'string' || !text.trim() || text.length > 600) {
        return res.status(400).json({ ok: false, error: 'Некорректный текст команды.' });
      }
      if (!Array.isArray(availableRooms) || !Array.isArray(categories)) {
        return res.status(400).json({ ok: false, error: 'Отсутствует справочник комнат.' });
      }
      if (!isGeminiConfigured()) {
        return res.status(503).json({ ok: false, error: 'Gemini API не настроен' });
      }
      const result = await parseCommandWithGemini({
        text: text.trim(),
        availableRooms,
        categories,
      });
      if (!result) {
        return res.status(503).json({ ok: false, error: 'Не удалось распознать команду.' });
      }
      return res.json({ ok: true, result });
    })
  );

  // 4. AI In-Memory Passport Photo MRZ OCR
  app.post(
    '/api/ai/mrz-ocr',
    asyncHandler(async (req, res) => {
      const { imageBase64, mimeType } = req.body ?? {};
      if (typeof imageBase64 !== 'string' || typeof mimeType !== 'string') {
        return res.status(400).json({ ok: false, error: 'Отсутствуют данные изображения.' });
      }
      const outcome = await extractMrzWithGemini({ imageBase64, mimeType });
      if (!outcome.ok) {
        const statusCode = isGeminiConfigured() ? 422 : 503;
        return res.status(statusCode).json(outcome);
      }
      return res.json(outcome);
    })
  );

  // 5. AI Multilingual Guest Reply Drafter (RU / EN / UZ / ZH)
  app.post(
    '/api/ai/draft-reply',
    asyncHandler(async (req, res) => {
      const { guestMessage, lang, wifiPass, doorCode } = req.body ?? {};
      const validLangs = new Set(['ru', 'en', 'uz', 'zh']);
      if (typeof guestMessage !== 'string' || !guestMessage.trim() || !validLangs.has(lang)) {
        return res.status(400).json({ ok: false, error: 'Некорректные параметры запроса.' });
      }
      if (!isGeminiConfigured()) {
        return res.status(503).json({ ok: false, error: 'Gemini API не настроен' });
      }
      const reply = await draftGuestReplyWithGemini({
        guestMessage: guestMessage.slice(0, 1000),
        lang,
        wifiPass: typeof wifiPass === 'string' ? wifiPass.slice(0, 64) : '',
        doorCode: typeof doorCode === 'string' ? doorCode.slice(0, 32) : '',
      });
      if (!reply) {
        return res.status(503).json({ ok: false, error: 'Не удалось сформировать ответ.' });
      }
      return res.json({ ok: true, reply });
    })
  );

  // 6. Bnovo API v1 Bookings Sync (Asia/Tashkent default dates + HTTP 502 on upstream failure)
  app.get(
    '/api/bnovo/bookings',
    asyncHandler(async (req, res) => {
      const todayTashkent = getTashkentTodayServerIso();
      const dateRe = /^\d{4}-\d{2}-\d{2}$/;
      const rawFrom = typeof req.query.date_from === 'string' ? req.query.date_from.trim() : '';
      const rawTo = typeof req.query.date_to === 'string' ? req.query.date_to.trim() : '';
      const dateFrom = dateRe.test(rawFrom) ? rawFrom : todayTashkent;
      const dateTo = dateRe.test(rawTo) ? rawTo : todayTashkent;

      const result = await getBnovoBookings(dateFrom, dateTo);
      if (!result.ok) {
        return res.status(502).json(result);
      }
      return res.json(result);
    })
  );

  // 7. Yandex Mail IMAP Inbox & Manual Poll
  app.get('/api/mail/inbox', (_req, res) => {
    const snap = getMailInboxSnapshot();
    return res.json({ ok: true, ...snap });
  });

  app.post(
    '/api/mail/sync',
    asyncHandler(async (_req, res) => {
      const result = await pollYandexImapOnce((inquiry) => {
        if (isTelegramConfigured()) {
          void sendTelegramMessage(
            `📧 Новое письмо (${inquiry.folder}) · ${inquiry.category}\nОт: ${inquiry.from}\nТема: ${inquiry.subject}`
          );
        }
      });
      return res.json(result);
    })
  );

  // 8. Telegram Two-Way Snapshot Push & Webhook Callback Handler
  app.post('/api/telegram/snapshot', (req, res) => {
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({ ok: false, error: 'Некорректный снимок состояния.' });
    }
    const updated = updateLiveOpsSnapshot(req.body);
    return res.json({ ok: true, updatedAt: updated.updatedAt, auditCount: getTelegramAuditLog().length });
  });

  app.post(
    '/api/telegram/webhook',
    asyncHandler(async (req, res) => {
      const check = validateTelegramWebhookSecret({
        isProd: IS_PROD,
        expectedSecret: process.env.TELEGRAM_WEBHOOK_SECRET,
        providedSecret: String(req.headers['x-telegram-bot-api-secret-token'] ?? ''),
      });
      if (!check.ok) {
        return res.status(check.status).json({ ok: false, error: check.error });
      }
      const outcome = await handleTelegramWebhookUpdate(req.body ?? {});
      return res.status(outcome.reason === 'unauthorized' ? 403 : 200).json(outcome);
    })
  );

  // Global Express error-handling middleware (sanitized response, full server-side log)
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    console.error(`[Topchan API Error] ${req.method} ${req.path}:`, err);
    if (res.headersSent) return;
    res.status(500).json({
      ok: false,
      error: 'Внутренняя ошибка сервера.',
    });
  });

  // Start background Tashkent Telegram reminders & Yandex Mail IMAP watcher
  startTelegramScheduler();
  startMailWatcher((inquiry) => {
    if (isTelegramConfigured()) {
      void sendTelegramMessage(
        `📧 [${inquiry.folder}] Новое обращение (${inquiry.category})\nОт: ${inquiry.from}\nТема: ${inquiry.subject}`
      );
    }
  });

  // Mount Vite dev middleware in development or serve built static files in production
  if (!IS_PROD) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.join(ROOT_DIR, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(
      `[Topchan Ops] Server running on http://0.0.0.0:${PORT} (${IS_PROD ? 'production' : 'dev'})`
    );
  });
}

const isDirectEntry =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);

if (isDirectEntry && process.env.TOPCHAN_TEST_NO_LISTEN !== '1') {
  startServer().catch((err) => {
    console.error('[Topchan Ops] Fatal startup error:', err);
    process.exit(1);
  });
}
