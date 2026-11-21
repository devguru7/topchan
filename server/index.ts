import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { getBnovoBookings, isBnovoConfigured } from './bnovo.ts';
import {
  draftGuestReplyWithGemini,
  extractMrzWithGemini,
  isGeminiConfigured,
  parseCommandWithGemini,
} from './gemini.ts';
import { startTelegramScheduler } from './telegramBot.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const PORT = Number(process.env.PORT) || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

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
        date: usdRow?.Date ?? new Date().toISOString().slice(0, 10),
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
        date: new Date().toISOString().slice(0, 10),
        source: 'fallback' as const,
        cachedAt: Date.now(),
      }
    );
  }
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '7mb' }));

  // 1. Health check
  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'topchan-ops',
      timezone: 'Asia/Tashkent',
      geminiConfigured: isGeminiConfigured(),
      bnovoConfigured: isBnovoConfigured(),
      timestamp: new Date().toISOString(),
    });
  });

  // 2. Central Bank of Uzbekistan live exchange rates (1h cache)
  app.get('/api/rates/cbu', async (_req, res) => {
    const rates = await fetchCbuRates();
    res.json({
      ok: true,
      usd: rates.usd,
      eur: rates.eur,
      date: rates.date,
      source: rates.source,
    });
  });

  // 3. AI Smart Russian Reception Command Parser
  app.post('/api/ai/parse-command', async (req, res) => {
    try {
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
        return res.status(503).json({ ok: false, error: 'Пустой ответ Gemini' });
      }
      return res.json({ ok: true, result });
    } catch (err) {
      return res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Ошибка AI-разбора',
      });
    }
  });

  // 4. AI In-Memory Passport Photo MRZ OCR
  app.post('/api/ai/mrz-ocr', async (req, res) => {
    try {
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
    } catch (err) {
      return res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Ошибка OCR паспорта',
      });
    }
  });

  // 5. AI Multilingual Guest Reply Drafter (RU / EN / UZ / ZH)
  app.post('/api/ai/draft-reply', async (req, res) => {
    try {
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
    } catch (err) {
      return res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Ошибка генерации ответа',
      });
    }
  });

  // 6. Bnovo API v1 Bookings Sync
  app.get('/api/bnovo/bookings', async (req, res) => {
    const today = new Date().toISOString().slice(0, 10);
    const dateFrom = typeof req.query.date_from === 'string' ? req.query.date_from : today;
    const dateTo = typeof req.query.date_to === 'string' ? req.query.date_to : today;
    const result = await getBnovoBookings(dateFrom, dateTo);
    res.json(result);
  });

  // Start background Tashkent Telegram reminders
  startTelegramScheduler();

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
    console.log(`[Topchan Ops] Server running on http://0.0.0.0:${PORT} (${IS_PROD ? 'production' : 'dev'})`);
  });
}

startServer().catch((err) => {
  console.error('[Topchan Ops] Fatal startup error:', err);
  process.exit(1);
});
