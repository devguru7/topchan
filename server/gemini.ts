/**
 * Server-Side Gemini AI Gateway (@google/genai)
 * Runs strictly in Node.js so GEMINI_API_KEY is never exposed to the browser.
 * Supports:
 *   1. Smart Russian Reception Command Parsing
 *   2. In-Memory Passport Photo TD3 MRZ Extraction (strictly validated <= 5MB, never saved to disk)
 *   3. Multilingual Guest Reply Drafter (RU / EN / UZ / ZH)
 */

import { GoogleGenAI, Type } from '@google/genai';

const MODEL_NAME = 'gemini-2.5-flash';
const ALLOWED_IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB

function getClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export function isGeminiConfigured(): boolean {
  return getClient() !== null;
}

export interface GeminiParsedCommand {
  roomId?: string;
  guestName?: string;
  nights?: number;
  paidCurrency?: 'USD' | 'UZS' | 'EUR';
  paidAmount?: number;
  changeCurrency?: 'UZS' | 'USD';
  extras?: Array<'laundry_fast' | 'laundry_medium' | 'late_breakfast' | 'early_late'>;
}

export async function parseCommandWithGemini(input: {
  text: string;
  availableRooms: Array<{ id: string; code: string; categoryId: string; status: string }>;
  categories: Array<{ id: string; name: string; basePriceUsd: number; isDorm: boolean }>;
}): Promise<GeminiParsedCommand | null> {
  const ai = getClient();
  if (!ai) return null;

  const prompt = [
    'Ты парсер быстрых команд администратора хостела Topchan Hostel (Ташкент).',
    'Разбери короткую русскую фразу заселения/оплаты и верни строго JSON.',
    `Доступные комнаты: ${JSON.stringify(input.availableRooms)}`,
    `Категории: ${JSON.stringify(input.categories)}`,
    `Команда администратора: "${input.text}"`,
    'Правила: определи roomId из списка доступных комнат, имя гостя (guestName), количество ночей (nights >= 1), валюту оплаты (USD|UZS|EUR), сумму оплаты (paidAmount), валюту сдачи (UZS|USD), и массив допуслуг extras (laundry_fast, laundry_medium, late_breakfast, early_late).',
  ].join('\n');

  const response = await ai.models.generateContent({
    model: MODEL_NAME,
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          roomId: { type: Type.STRING },
          guestName: { type: Type.STRING },
          nights: { type: Type.INTEGER },
          paidCurrency: { type: Type.STRING },
          paidAmount: { type: Type.NUMBER },
          changeCurrency: { type: Type.STRING },
          extras: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
        },
      },
    },
  });

  const rawText = response.text?.trim();
  if (!rawText) return null;

  const parsed = JSON.parse(rawText) as GeminiParsedCommand;
  return parsed;
}

export async function extractMrzWithGemini(input: {
  imageBase64: string;
  mimeType: string;
}): Promise<{ ok: boolean; mrzRaw?: string; error?: string }> {
  if (!ALLOWED_IMAGE_MIME.has(input.mimeType)) {
    return { ok: false, error: 'Поддерживаются только изображения JPEG, PNG или WebP.' };
  }

  // Strip optional data URL prefix if client sent one
  const cleanBase64 = input.imageBase64.replace(/^data:image\/[a-z]+;base64,/i, '').trim();
  const estimatedBytes = Math.ceil((cleanBase64.length * 3) / 4);
  if (estimatedBytes === 0 || estimatedBytes > MAX_IMAGE_BYTES) {
    return { ok: false, error: 'Размер фото паспорта должен быть от 1 KB до 5 MB.' };
  }

  const ai = getClient();
  if (!ai) {
    return { ok: false, error: 'GEMINI_API_KEY не настроен на сервере.' };
  }

  const response = await ai.models.generateContent({
    model: MODEL_NAME,
    contents: [
      {
        inlineData: {
          data: cleanBase64,
          mimeType: input.mimeType,
        },
      },
      {
        text: 'Extract ONLY the 2-line ICAO TD3 Machine Readable Zone (MRZ) from this passport photo. Each line must be exactly 44 uppercase characters (A-Z, 0-9, <). Return ONLY the 2 lines separated by a single newline, with no markdown fences or extra commentary. If no MRZ is visible, return NO_MRZ.',
      },
    ],
  });

  const text = (response.text ?? '').replace(/```[a-z]*\n?/gi, '').replace(/```/g, '').trim();
  if (!text || text.includes('NO_MRZ')) {
    return { ok: false, error: 'На снимке не найдена читаемая зона MRZ (2 строки по 44 символа).' };
  }

  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, '').toUpperCase())
    .filter((l) => l.length >= 36);

  if (lines.length < 2) {
    return { ok: false, error: 'MRZ распознан не полностью — проверьте освещение или введите вручную.' };
  }

  return {
    ok: true,
    mrzRaw: `${lines[0].slice(0, 44)}\n${lines[1].slice(0, 44)}`,
  };
}

export async function draftGuestReplyWithGemini(input: {
  guestMessage: string;
  lang: 'ru' | 'en' | 'uz' | 'zh';
  wifiPass: string;
  doorCode: string;
}): Promise<string | null> {
  const ai = getClient();
  if (!ai) return null;

  const langLabel: Record<typeof input.lang, string> = {
    ru: 'Russian',
    en: 'English',
    uz: 'Uzbek (Latin)',
    zh: 'Simplified Chinese',
  };

  const prompt = [
    `You are the polite, concise front-desk reception autopilot for Topchan Hostel in Tashkent, Uzbekistan.`,
    `Write a helpful reply in ${langLabel[input.lang]} (2–4 concise sentences, no markdown).`,
    `Hostel facts you MUST respect:`,
    `- Check-in from 14:00, check-out until 12:00 (early check-in / late check-out is +50% subject to availability).`,
    `- Free breakfast 08:00–10:00, late breakfast $2, shared kitchen open until 00:00.`,
    `- Distance to Tashkent International Airport: 3 km, airport transfer $5 per car.`,
    `- Laundry: quick 22 min ($2), medium 55 min ($3).`,
    `- Wi-Fi password: ${input.wifiPass}, front door code: ${input.doorCode}.`,
    `Guest message / situation: "${input.guestMessage}"`,
  ].join('\n');

  const response = await ai.models.generateContent({
    model: MODEL_NAME,
    contents: prompt,
  });

  return response.text?.trim() || null;
}
