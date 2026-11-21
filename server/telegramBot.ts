/**
 * Server-Side Two-Way Telegram Bot Controller & Operational Scheduler (Asia/Tashkent UTC+5)
 *
 * Features:
 * 1. Scheduled reception reminders at 08:00, 10:00, 11:30, 12:00, 13:00, 14:00, 23:30.
 * 2. Two-way admin commands guarded strictly by TELEGRAM_ADMIN_IDS whitelist:
 *    /today, /debts, /cash, /checkout, /rooms, /emehmon, /luggage, /help
 * 3. Interactive inline keyboard callbacks (debt close, housekeeping done, safe confirm, E-mehmon export)
 *    with immutable server-side audit log and live operational snapshot updates.
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

export interface LiveOpsSnapshot {
  updatedAt: string;
  operationalDate: string;
  adminName: string;
  occupiedUnits: number;
  totalUnits: number;
  freeUnits: number;
  dirtyRooms: Array<{ id: string; label: string }>;
  checkoutsToday: Array<{ bookingId: string; roomLabel: string; guestName: string; debtUsd: number }>;
  debts: Array<{ bookingId: string; roomLabel: string; guestName: string; debtUsd: number }>;
  unregisteredEmehmon: Array<{
    bookingId: string;
    guestName: string;
    passportNo: string;
    citizenship: string;
    roomLabel: string;
  }>;
  pockets: Array<{ id: string; name: string; display: string }>;
  pendingSafeCollections: Array<{ id: string; summary: string }>;
  storedLuggage: Array<{ tagCode: string; guestName: string; bagsCount: number; flightTime: string }>;
}

export interface TelegramActionAudit {
  id: string;
  timestamp: string;
  telegramUserId: string;
  action: string;
  targetId: string;
  note: string;
}

interface TelegramInlineButton {
  text: string;
  callback_data: string;
}

interface TelegramUpdate {
  update_id?: number;
  message?: {
    chat?: { id: number | string };
    from?: { id: number | string; first_name?: string; username?: string };
    text?: string;
  };
  callback_query?: {
    id: string;
    from?: { id: number | string; first_name?: string; username?: string };
    message?: { chat?: { id: number | string } };
    data?: string;
  };
}

let schedulerHandle: ReturnType<typeof setInterval> | null = null;
const sentKeys = new Set<string>();
const inFlightKeys = new Set<string>();
const actionAuditLog: TelegramActionAudit[] = [];

let liveSnapshot: LiveOpsSnapshot = {
  updatedAt: new Date().toISOString(),
  operationalDate: new Date().toISOString().slice(0, 10),
  adminName: 'Дежурный Topchan',
  occupiedUnits: 0,
  totalUnits: 37,
  freeUnits: 37,
  dirtyRooms: [],
  checkoutsToday: [],
  debts: [],
  unregisteredEmehmon: [],
  pockets: [
    { id: 'cash_uzs', name: 'Нал UZS стол', display: '0 сум' },
    { id: 'cash_usd', name: 'Нал USD стол', display: '$0' },
    { id: 'cash_eur', name: 'Нал EUR стол', display: '€0' },
    { id: 'terminal', name: 'Терминал', display: '0 сум' },
    { id: 'transfer', name: 'Click / Payme', display: '0 сум' },
    { id: 'safe', name: 'Сейф владельца', display: '$0 · 0 сум' },
  ],
  pendingSafeCollections: [],
  storedLuggage: [],
};

export function isTelegramConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN?.trim() && process.env.TELEGRAM_CHAT_ID?.trim());
}

export function getWhitelistedAdminIds(): Set<string> {
  const raw = process.env.TELEGRAM_ADMIN_IDS?.trim() ?? '';
  const set = new Set<string>();
  for (const part of raw.split(',')) {
    const cleaned = part.trim();
    if (cleaned) set.add(cleaned);
  }
  return set;
}

export function isTelegramAdminAuthorized(userId: string | number | undefined): boolean {
  if (userId === undefined || userId === null) return false;
  const whitelist = getWhitelistedAdminIds();
  if (whitelist.size === 0) return false;
  return whitelist.has(String(userId));
}

export function updateLiveOpsSnapshot(partial: Partial<LiveOpsSnapshot>): LiveOpsSnapshot {
  liveSnapshot = {
    ...liveSnapshot,
    ...partial,
    updatedAt: new Date().toISOString(),
  };
  return liveSnapshot;
}

export function getLiveOpsSnapshot(): LiveOpsSnapshot {
  return liveSnapshot;
}

export function getTelegramAuditLog(): TelegramActionAudit[] {
  return actionAuditLog.slice(0, 50);
}

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

export async function sendTelegramMessage(
  text: string,
  options?: {
    chatId?: string | number;
    inlineKeyboard?: TelegramInlineButton[][];
  }
): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = options?.chatId ? String(options.chatId) : process.env.TELEGRAM_CHAT_ID?.trim();
  if (!token || !chatId) return false;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const payload: Record<string, unknown> = {
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
      };
      if (options?.inlineKeyboard && options.inlineKeyboard.length > 0) {
        payload.reply_markup = { inline_keyboard: options.inlineKeyboard };
      }

      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
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

async function answerCallbackQuery(callbackQueryId: string, text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: callbackQueryId, text }),
    });
  } catch {
    // ignore transient callback ack error
  }
}

export function buildTelegramCommandReply(commandText: string): {
  text: string;
  inlineKeyboard?: TelegramInlineButton[][];
} {
  const cmd = commandText.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
  const snap = liveSnapshot;

  if (cmd === '/today') {
    const pct = snap.totalUnits > 0 ? Math.round((snap.occupiedUnits / snap.totalUnits) * 100) : 0;
    return {
      text: [
        `🏨 TOPCHAN HOSTEL · Сводка на ${snap.operationalDate}`,
        `Загрузка: ${snap.occupiedUnits}/${snap.totalUnits} мест (${pct}%) · Свободно: ${snap.freeUnits}`,
        `Выезды сегодня 12:00: ${snap.checkoutsToday.length}`,
        `Открытые долги: ${snap.debts.length}`,
        `E-mehmon (без рег.): ${snap.unregisteredEmehmon.length}`,
        `Комнаты на уборке: ${snap.dirtyRooms.length}`,
        `Багаж на хранении: ${snap.storedLuggage.length}`,
      ].join('\n'),
    };
  }

  if (cmd === '/debts') {
    if (snap.debts.length === 0) {
      return { text: '✅ Открытых долгов по проживающим гостям нет.' };
    }
    const lines = snap.debts.map(
      (d) => `• ${d.roomLabel} · ${d.guestName}: $${d.debtUsd}`
    );
    const buttons: TelegramInlineButton[][] = snap.debts.slice(0, 5).map((d) => [
      { text: `✅ Закрыть долг ${d.roomLabel} ($${d.debtUsd})`, callback_data: `close_debt:${d.bookingId}` },
    ]);
    return {
      text: `💳 Открытые долги (${snap.debts.length}):\n${lines.join('\n')}`,
      inlineKeyboard: buttons,
    };
  }

  if (cmd === '/cash') {
    const lines = snap.pockets.map((p) => `• ${p.name}: ${p.display}`);
    const buttons: TelegramInlineButton[][] = snap.pendingSafeCollections.slice(0, 3).map((c) => [
      { text: `🔐 Подтвердить инкассацию (${c.summary})`, callback_data: `confirm_safe:${c.id}` },
    ]);
    return {
      text: `💰 6 карманов кассы Topchan:\n${lines.join('\n')}`,
      inlineKeyboard: buttons.length > 0 ? buttons : undefined,
    };
  }

  if (cmd === '/checkout') {
    if (snap.checkoutsToday.length === 0) {
      return { text: '🟢 На сегодня выездов до 12:00 не осталось.' };
    }
    const lines = snap.checkoutsToday.map(
      (c) => `• ${c.roomLabel} · ${c.guestName}${c.debtUsd > 0 ? ` (долг $${c.debtUsd})` : ' (оплачено)'}`
    );
    return { text: `🚪 Выезды сегодня до 12:00:\n${lines.join('\n')}` };
  }

  if (cmd === '/rooms') {
    if (snap.dirtyRooms.length === 0) {
      return {
        text: `🛏 Номерной фонд: ${snap.freeUnits} свободно, ${snap.occupiedUnits} занято. Грязных комнат нет.`,
      };
    }
    const lines = snap.dirtyRooms.map((r) => `• ${r.label} — требуется уборка`);
    const buttons: TelegramInlineButton[][] = snap.dirtyRooms.slice(0, 5).map((r) => [
      { text: `✨ Уборка готова: ${r.label}`, callback_data: `hk_done:${r.id}` },
    ]);
    return {
      text: `🧹 Комнаты на уборке (${snap.dirtyRooms.length}):\n${lines.join('\n')}`,
      inlineKeyboard: buttons,
    };
  }

  if (cmd === '/emehmon') {
    if (snap.unregisteredEmehmon.length === 0) {
      return { text: '🛡️ Все иностранные гости зарегистрированы в E-mehmon.' };
    }
    const lines = snap.unregisteredEmehmon.map(
      (g) => `• ${g.roomLabel} · ${g.guestName} (${g.citizenship}, ${g.passportNo})`
    );
    const buttons: TelegramInlineButton[][] = snap.unregisteredEmehmon.slice(0, 5).map((g) => [
      { text: `📋 Данные E-mehmon: ${g.guestName}`, callback_data: `emehmon_card:${g.bookingId}` },
    ]);
    return {
      text: `⚠️ Требуется регистрация E-mehmon (лимит 72ч):\n${lines.join('\n')}`,
      inlineKeyboard: buttons,
    };
  }

  if (cmd === '/luggage') {
    if (snap.storedLuggage.length === 0) {
      return { text: '🧳 Камера хранения багажа пуста.' };
    }
    const lines = snap.storedLuggage.map(
      (l) => `• ${l.tagCode} · ${l.guestName} (${l.bagsCount} мест, рейс ${l.flightTime})`
    );
    return { text: `🧳 Камера хранения (${snap.storedLuggage.length}):\n${lines.join('\n')}` };
  }

  return {
    text: [
      'Команды Topchan Ops Bot:',
      '/today — сводка загрузки и сменных задач',
      '/debts — открытые долги (+ кнопка закрытия)',
      '/cash — балансы 6 карманов и инкассация',
      '/checkout — выезды сегодня к 12:00',
      '/rooms — статус уборки (+ кнопка «Уборка готова»)',
      '/emehmon — иностранцы без регистрации 72ч',
      '/luggage — камера хранения багажа (#B..)',
    ].join('\n'),
  };
}

export async function handleTelegramWebhookUpdate(update: TelegramUpdate): Promise<{
  ok: boolean;
  handled: boolean;
  reason?: string;
}> {
  // 1. Handle inline button callbacks
  if (update.callback_query) {
    const cb = update.callback_query;
    const fromId = cb.from?.id;
    const chatId = cb.message?.chat?.id;
    if (!isTelegramAdminAuthorized(fromId)) {
      await answerCallbackQuery(cb.id, 'Доступ запрещён (нет в TELEGRAM_ADMIN_IDS).');
      return { ok: false, handled: false, reason: 'unauthorized' };
    }

    const data = cb.data ?? '';
    const [action, targetId] = data.split(':');
    let replyText = 'Операция зафиксирована.';

    if (action === 'close_debt' && targetId) {
      const target = liveSnapshot.debts.find((d) => d.bookingId === targetId);
      liveSnapshot = {
        ...liveSnapshot,
        debts: liveSnapshot.debts.filter((d) => d.bookingId !== targetId),
      };
      replyText = target
        ? `✅ Долг ${target.roomLabel} (${target.guestName}, $${target.debtUsd}) отмечен закрытым через Telegram.`
        : '✅ Долг уже закрыт.';
    } else if (action === 'hk_done' && targetId) {
      const target = liveSnapshot.dirtyRooms.find((r) => r.id === targetId);
      liveSnapshot = {
        ...liveSnapshot,
        dirtyRooms: liveSnapshot.dirtyRooms.filter((r) => r.id !== targetId),
      };
      replyText = target
        ? `✨ Уборка ${target.label} подтверждена через Telegram — номер открыт в продажу.`
        : '✨ Комната уже чистая.';
    } else if (action === 'confirm_safe' && targetId) {
      const target = liveSnapshot.pendingSafeCollections.find((c) => c.id === targetId);
      liveSnapshot = {
        ...liveSnapshot,
        pendingSafeCollections: liveSnapshot.pendingSafeCollections.filter((c) => c.id !== targetId),
      };
      replyText = target
        ? `🔐 Инкассация (${target.summary}) подтверждена владельцем.`
        : '🔐 Инкассация уже подтверждена.';
    } else if (action === 'emehmon_card' && targetId) {
      const target = liveSnapshot.unregisteredEmehmon.find((g) => g.bookingId === targetId);
      replyText = target
        ? `📋 E-mehmon карточка:\nГость: ${target.guestName}\nПаспорт: ${target.passportNo}\nГражданство: ${target.citizenship}\nКомната: ${target.roomLabel}`
        : 'Карточка E-mehmon не найдена.';
    }

    actionAuditLog.unshift({
      id: `tg-act-${Date.now()}`,
      timestamp: new Date().toISOString(),
      telegramUserId: String(fromId),
      action: action || 'unknown',
      targetId: targetId || '',
      note: replyText,
    });

    await answerCallbackQuery(cb.id, 'Выполнено');
    if (chatId) {
      await sendTelegramMessage(replyText, { chatId });
    }
    return { ok: true, handled: true };
  }

  // 2. Handle incoming slash commands
  if (update.message?.text) {
    const fromId = update.message.from?.id;
    const chatId = update.message.chat?.id;
    if (!isTelegramAdminAuthorized(fromId)) {
      return { ok: false, handled: false, reason: 'unauthorized' };
    }
    if (!update.message.text.trim().startsWith('/')) {
      return { ok: true, handled: false };
    }
    const reply = buildTelegramCommandReply(update.message.text);
    if (chatId) {
      await sendTelegramMessage(reply.text, {
        chatId,
        inlineKeyboard: reply.inlineKeyboard,
      });
    }
    return { ok: true, handled: true };
  }

  return { ok: true, handled: false };
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
    '[Topchan Telegram] Планировщик Asia/Tashkent и двухсторонний бот активны (08:00–23:30).'
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
