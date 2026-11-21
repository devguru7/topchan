/**
 * Server-Side Telegram Bot Operational Scheduler (Asia/Tashkent UTC+5)
 * Sends scheduled reception reminders at 08:00, 10:00, 11:30, 12:00, 13:00, 14:00, 23:30
 * when TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are configured.
 *
 * Reliability guarantees:
 * - 8000ms AbortController timeout per HTTP attempt
 * - Up to 3 attempts with exponential backoff on transient failures
 * - Logs non-OK / network errors via console.error
 * - Marks dedupe key as sent ONLY AFTER sendTelegramMessage() returns true
 */

const SCHEDULED_REMINDERS: Record<string, string> = {
  '08:00': '🌅 08:00 Ташкент — Приёмка утренней смены: сверка 6 карманов кассы, проверка завтрака (08:00–10:00) и списка выездов.',
  '10:00': '🍳 10:00 Ташкент — Завершение бесплатного завтрака. Поздний завтрак после 10:00 — $2 в фолио.',
  '11:30': '⏰ 11:30 Ташкент — За 30 минут до чек-аута (12:00): напомните гостям о выезде и проверьте открытые долги.',
  '12:00': '🧹 12:00 Ташкент — Расчётный час выезда! Передайте освободившиеся комнаты в очередь уборки горничным.',
  '13:00': '✅ 13:00 Ташкент — Контроль готовности номеров к заезду 14:00 и сверка квитков E-mehmon.',
  '14:00': '🔑 14:00 Ташкент — Старт заселений (Check-in). Проверьте входящие брони Bnovo и статус трансферов из аэропорта.',
  '23:30': '🌙 23:30 Ташкент — Закрытие общей кухни в 00:00, ночная тишина и проверка входного кода двери.',
};

const REQUEST_TIMEOUT_MS = 8000;
const MAX_ATTEMPTS = 3;

let schedulerHandle: ReturnType<typeof setInterval> | null = null;
const sentKeys = new Set<string>();
const inFlightKeys = new Set<string>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getTashkentDateAndHm(): { dateIso: string; hm: string } {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tashkent',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = dtf.formatToParts(new Date());
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '00';
  return {
    dateIso: `${pick('year')}-${pick('month')}-${pick('day')}`,
    hm: `${pick('hour')}:${pick('minute')}`,
  };
}

export async function sendTelegramMessage(text: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = process.env.TELEGRAM_CHAT_ID?.trim();
  if (!token || !chatId) return false;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          disable_web_page_preview: true,
        }),
      });
      if (res.ok) {
        return true;
      }
      const errBody = await res.text().catch(() => '');
      console.error(
        `[Topchan Telegram] Attempt ${attempt}/${MAX_ATTEMPTS} failed with HTTP ${res.status}: ${errBody.slice(0, 160)}`
      );
    } catch (err) {
      console.error(
        `[Topchan Telegram] Attempt ${attempt}/${MAX_ATTEMPTS} network/timeout error:`,
        err instanceof Error ? err.message : err
      );
    } finally {
      clearTimeout(timer);
    }

    if (attempt < MAX_ATTEMPTS) {
      await sleep(500 * Math.pow(3, attempt - 1));
    }
  }

  return false;
}

export function startTelegramScheduler(): void {
  if (schedulerHandle) return;

  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = process.env.TELEGRAM_CHAT_ID?.trim();
  if (!token || !chatId) {
    console.log(
      '[Topchan Telegram] TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID не заданы — планировщик в режиме ожидания.'
    );
    return;
  }

  console.log(
    '[Topchan Telegram] Планировщик Asia/Tashkent активен (08:00, 10:00, 11:30, 12:00, 13:00, 14:00, 23:30).'
  );

  schedulerHandle = setInterval(() => {
    const { dateIso, hm } = getTashkentDateAndHm();
    const message = SCHEDULED_REMINDERS[hm];
    if (!message) return;

    const dedupeKey = `${dateIso}_${hm}`;
    if (sentKeys.has(dedupeKey) || inFlightKeys.has(dedupeKey)) return;
    inFlightKeys.add(dedupeKey);

    sendTelegramMessage(message)
      .then((delivered) => {
        if (delivered) {
          sentKeys.add(dedupeKey);
          // Keep dedupe set bounded across long uptimes
          if (sentKeys.size > 64) {
            const oldest = sentKeys.values().next().value;
            if (oldest) sentKeys.delete(oldest);
          }
        } else {
          console.error(
            `[Topchan Telegram] Delivery failed for ${dedupeKey}; will retry on next eligible tick.`
          );
        }
      })
      .catch((err) => {
        console.error(`[Topchan Telegram] Unexpected error for ${dedupeKey}:`, err);
      })
      .finally(() => {
        inFlightKeys.delete(dedupeKey);
      });
  }, 30_000);
}
