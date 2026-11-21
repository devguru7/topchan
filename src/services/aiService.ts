import type {
  CurrencySettings,
  GuestLang,
  ParsedCommand,
  PhysicalRoom,
  RoomCategory,
} from '../types/ops';
import { parseRussianReceptionCommand } from '../utils/commandParser';
import { calcChangeUzs, round2 } from '../utils/math';

export interface SmartCommandResult {
  parsed: ParsedCommand;
  engine: 'gemini' | 'local';
}

export interface MrzOcrResult {
  mrzRaw: string;
  engine: 'gemini' | 'fallback';
  note: string;
}

export interface GuestReplyDraftResult {
  reply: string;
  engine: 'gemini' | 'local';
}

/**
 * Calls server-side Gemini endpoint (/api/ai/parse-command) for complex Russian reception phrasing,
 * with instant 100% deterministic fallback to local parseRussianReceptionCommand.
 */
export async function parseReceptionCommandSmart(
  rawInput: string,
  rooms: PhysicalRoom[],
  categories: RoomCategory[],
  currency: CurrencySettings
): Promise<SmartCommandResult> {
  const localFallback = parseRussianReceptionCommand(rawInput, rooms, categories, currency);

  try {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 5000);
    const res = await fetch('/api/ai/parse-command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        text: rawInput,
        availableRooms: rooms
          .filter((r) => !r.archived)
          .map((r) => ({ id: r.id, code: r.code, categoryId: r.categoryId, status: r.status })),
        categories: categories.map((c) => ({
          id: c.id,
          name: c.name,
          basePriceUsd: c.pricesUsd[1] ?? 18,
          isDorm: c.isDorm,
        })),
      }),
    }).finally(() => window.clearTimeout(timer));

    if (!res.ok) {
      return { parsed: localFallback, engine: 'local' };
    }

    const data = (await res.json()) as {
      ok?: boolean;
      result?: {
        roomId?: string;
        guestName?: string;
        nights?: number;
        paidCurrency?: 'USD' | 'UZS' | 'EUR';
        paidAmount?: number;
        changeCurrency?: 'UZS' | 'USD';
        extras?: Array<'laundry_fast' | 'laundry_medium' | 'late_breakfast' | 'early_late'>;
      };
    };

    if (!data.ok || !data.result) {
      return { parsed: localFallback, engine: 'local' };
    }

    const ai = data.result;
    const matchedRoom =
      rooms.find((r) => r.id === ai.roomId && !r.archived) ??
      rooms.find((r) => r.id === localFallback.roomId);
    const matchedCat = categories.find((c) => c.id === matchedRoom?.categoryId);
    const nightlyRateUsd = matchedCat?.pricesUsd[1] ?? localFallback.nightlyRateUsd;
    const nights = Math.max(1, Number(ai.nights) || localFallback.nights);

    const extrasList: ParsedCommand['extras'] = (ai.extras ?? []).map((code) => {
      if (code === 'laundry_fast') return { type: code, label: 'Быстрая стирка (22 мин)', priceUsd: 2 };
      if (code === 'laundry_medium') return { type: code, label: 'Средняя стирка (55 мин)', priceUsd: 3 };
      if (code === 'late_breakfast') return { type: code, label: 'Поздний завтрак', priceUsd: 2 };
      return {
        type: 'early_late',
        label: 'Ранний заезд / Поздний выезд (+50%)',
        priceUsd: round2(nightlyRateUsd * 0.5),
      };
    });

    const finalExtras = extrasList.length > 0 ? extrasList : localFallback.extras;
    const totalUsd = round2(
      nights * nightlyRateUsd + finalExtras.reduce((s, e) => s + e.priceUsd, 0)
    );
    const paidCurrency = ai.paidCurrency ?? localFallback.paidCurrency;
    const paidAmount =
      typeof ai.paidAmount === 'number' && ai.paidAmount >= 0
        ? ai.paidAmount
        : localFallback.paidAmount;
    const changeCurrency = ai.changeCurrency ?? localFallback.changeCurrency;

    let paidUsdEq = paidAmount;
    if (paidCurrency === 'UZS') {
      paidUsdEq = currency.accRate > 0 ? round2(paidAmount / currency.accRate) : 0;
    } else if (paidCurrency === 'EUR') {
      const eurToUsd = currency.cbuUsd > 0 ? currency.cbuEur / currency.cbuUsd : 1.1;
      paidUsdEq = round2(paidAmount * eurToUsd);
    }

    const diffUsd = round2(paidUsdEq - totalUsd);
    const overpaidUsd = diffUsd > 0 ? diffUsd : 0;
    const debtUsd = diffUsd < 0 ? round2(Math.abs(diffUsd)) : 0;

    return {
      engine: 'gemini',
      parsed: {
        ...localFallback,
        roomId: matchedRoom?.id ?? localFallback.roomId,
        roomLabel: matchedRoom?.code ?? localFallback.roomLabel,
        guestName: ai.guestName?.trim() || localFallback.guestName,
        nights,
        nightlyRateUsd,
        paidCurrency,
        paidAmount,
        changeCurrency,
        extras: finalExtras,
        totalUsd,
        overpaidUsd,
        debtUsd,
        changeUzs:
          overpaidUsd > 0 && changeCurrency === 'UZS'
            ? calcChangeUzs(overpaidUsd, currency.exRate)
            : 0,
        changeUsd: overpaidUsd > 0 && changeCurrency === 'USD' ? overpaidUsd : 0,
        confidenceNote: `Распознано Gemini AI: ${matchedRoom?.code ?? localFallback.roomLabel}, ${nights} н. × $${nightlyRateUsd}`,
      },
    };
  } catch {
    return { parsed: localFallback, engine: 'local' };
  }
}

/**
 * Extracts 2-line ICAO TD3 MRZ from a passport photo via server-side Gemini Vision.
 * Image is processed strictly in memory and never stored.
 */
export async function extractPassportMrzFromPhoto(
  base64Data: string,
  mimeType: string
): Promise<MrzOcrResult> {
  try {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 12000);
    const res = await fetch('/api/ai/mrz-ocr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({ imageBase64: base64Data, mimeType }),
    }).finally(() => window.clearTimeout(timer));

    if (!res.ok) {
      return {
        mrzRaw: '',
        engine: 'fallback',
        note: 'Gemini Vision недоступен (офлайн или нет ключа на сервере) — вставьте 2 строки MRZ вручную или используйте образец ниже.',
      };
    }

    const data = (await res.json()) as { ok?: boolean; mrzRaw?: string; error?: string };
    if (data.ok && data.mrzRaw) {
      return {
        mrzRaw: data.mrzRaw.trim(),
        engine: 'gemini',
        note: 'MRZ извлечён с фото через Gemini Vision (снимок удалён из памяти).',
      };
    }

    return {
      mrzRaw: '',
      engine: 'fallback',
      note: data.error || 'Не удалось найти MRZ на фото — вставьте строки вручную.',
    };
  } catch {
    return {
      mrzRaw: '',
      engine: 'fallback',
      note: 'Нет связи с сервером OCR — используйте ручной ввод MRZ или тестовый образец.',
    };
  }
}

/**
 * Deterministic multilingual guest reply templates aligned with Topchan Hostel Tashkent rules.
 */
export function buildDeterministicGuestReply(
  lang: GuestLang,
  context: {
    guestMessage: string;
    wifiPass: string;
    doorCode: string;
  }
): string {
  const { wifiPass, doorCode } = context;
  switch (lang) {
    case 'en':
      return `Hello from Topchan Hostel Tashkent! Thank you for your message. Check-in is from 14:00, check-out is until 12:00 (early check-in / late check-out is +50% subject to availability). Free breakfast is served 08:00–10:00 (late breakfast $2), kitchen is open until 00:00. We are 3 km from Tashkent Airport and can arrange a $5 transfer. Wi-Fi password: ${wifiPass}, front door code: ${doorCode}. Would you like us to confirm your direct booking?`;
    case 'uz':
      return `Assalomu alaykum! Topchan Hostel (Toshkent) sizga yordam berishdan mamnun. Kirish (Check-in) 14:00 dan, chiqish (Check-out) 12:00 gacha (erta kirish +50%). Bepul nonushta 08:00–10:00 (kechki nonushta $2), oshxona 00:00 gacha ochiq. Toshkent aeroportigacha 3 km (transfer $5). Wi-Fi paroli: ${wifiPass}, eshik kodi: ${doorCode}. Bronni tasdiqlaymizmi?`;
    case 'zh':
      return `您好！欢迎联系塔什干 Topchan Hostel。入住时间为 14:00 起，退房时间为 12:00 前（提前入住/延迟退房加收 50%）。免费早餐 08:00–10:00（延迟早餐 $2），厨房开放至 00:00。我们距离塔什干机场仅 3 公里，可安排 $5 接送机。Wi-Fi 密码：${wifiPass}，大门密码：${doorCode}。需要为您直接确认预订吗？`;
    case 'ru':
    default:
      return `Здравствуйте! На связи Topchan Hostel (Ташкент). Заезд с 14:00, выезд до 12:00 (ранний заезд / поздний выезд +50% при наличии мест). Бесплатный завтрак с 08:00 до 10:00 (поздний $2), кухня открыта до 00:00. Мы в 3 км от аэропорта Ташкент, можем организовать трансфер ($5/машина). Wi-Fi: ${wifiPass}, код двери: ${doorCode}. Подтвердить прямую бронь без комиссии?`;
  }
}

/**
 * Generates a multilingual guest reply (RU / EN / UZ / ZH) via server-side Gemini,
 * with instant deterministic fallback using Topchan Hostel's exact policies.
 */
export async function generateGuestReplySmart(params: {
  guestMessage: string;
  lang: GuestLang;
  wifiPass: string;
  doorCode: string;
}): Promise<GuestReplyDraftResult> {
  const localReply = buildDeterministicGuestReply(params.lang, params);
  try {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 7000);
    const res = await fetch('/api/ai/draft-reply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify(params),
    }).finally(() => window.clearTimeout(timer));

    if (!res.ok) return { reply: localReply, engine: 'local' };
    const data = (await res.json()) as { ok?: boolean; reply?: string };
    if (data.ok && data.reply?.trim()) {
      return { reply: data.reply.trim(), engine: 'gemini' };
    }
    return { reply: localReply, engine: 'local' };
  } catch {
    return { reply: localReply, engine: 'local' };
  }
}
