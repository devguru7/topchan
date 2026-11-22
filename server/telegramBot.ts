/**
 * Server-Side Two-Way Telegram Bot Controller & Operational Scheduler (Asia/Tashkent UTC+5)
 *
 * Features:
 * 1. Scheduled reception reminders at 08:00, 10:00, 11:30, 12:00, 13:00, 14:00, 23:30.
 * 2. Two-way admin commands guarded strictly by TELEGRAM_ADMIN_IDS whitelist:
 *    /today, /debts, /cash, /checkout, /rooms, /emehmon, /luggage, /help
 * 3. Persistent interactive inline keyboard callbacks:
 *    - `close_debt:<bookingId>`
 *    - `hk_done:<roomId_or_roomId:bedId>`
 *    - `safe_confirm:<collectionId>` / `confirm_safe:<collectionId>`
 *    - `emehmon_export:<bookingId>` / `emehmon_card:<bookingId>`
 *    Persists mutations to Supabase (`property_snapshots` + normalized tables) when configured
 *    and to durable server-side JSON storage (`.topchan-data/telegram-state.json`) so changes
 *    survive restarts.
 */

import fs from 'node:fs';
import path from 'node:path';

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

const DATA_DIR = path.resolve(process.cwd(), '.topchan-data');
const TELEGRAM_STATE_FILE = path.resolve(DATA_DIR, 'telegram-state.json');

export interface LiveOpsSnapshot {
  propertyId?: string;
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
    bnovoId?: string;
    guestName: string;
    passportNo: string;
    citizenship: string;
    dob?: string;
    sex?: string;
    fromDate?: string;
    toDate?: string;
    roomLabel: string;
  }>;
  pockets: Array<{ id: string; name: string; display: string }>;
  pendingSafeCollections: Array<{ id: string; summary: string }>;
  confirmedSafeCollections?: Array<{ id: string; summary: string; confirmedAt: string; confirmedBy: string }>;
  storedLuggage: Array<{ tagCode: string; guestName: string; bagsCount: number; flightTime: string }>;
}

export interface TelegramActionAudit {
  id: string;
  timestamp: string;
  telegramUserId: string;
  action: string;
  targetId: string;
  note: string;
  persistedToSupabase?: boolean;
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

interface PersistedTelegramStore {
  liveSnapshot: LiveOpsSnapshot;
  actionAuditLog: TelegramActionAudit[];
}

function isConfinedPath(targetPath: string, baseDir: string): boolean {
  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(targetPath);
  return resolvedTarget.startsWith(resolvedBase + path.sep);
}

const DEFAULT_SNAPSHOT: LiveOpsSnapshot = {
  propertyId: process.env.VITE_PROPERTY_ID?.trim() || 'topchan-tashkent-01',
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
  confirmedSafeCollections: [],
  storedLuggage: [],
};

function loadPersistedStore(): PersistedTelegramStore {
  try {
    if (!isConfinedPath(TELEGRAM_STATE_FILE, DATA_DIR) || !fs.existsSync(TELEGRAM_STATE_FILE)) {
      return { liveSnapshot: { ...DEFAULT_SNAPSHOT }, actionAuditLog: [] };
    }
    const raw = fs.readFileSync(TELEGRAM_STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Partial<PersistedTelegramStore>;
    return {
      liveSnapshot: parsed.liveSnapshot
        ? { ...DEFAULT_SNAPSHOT, ...parsed.liveSnapshot }
        : { ...DEFAULT_SNAPSHOT },
      actionAuditLog: Array.isArray(parsed.actionAuditLog) ? parsed.actionAuditLog.slice(0, 100) : [],
    };
  } catch (err) {
    console.warn('[Topchan Telegram] Could not load persisted store:', err instanceof Error ? err.message : err);
    return { liveSnapshot: { ...DEFAULT_SNAPSHOT }, actionAuditLog: [] };
  }
}

function savePersistedStore(snapshot: LiveOpsSnapshot, audit: TelegramActionAudit[]): void {
  try {
    if (!isConfinedPath(TELEGRAM_STATE_FILE, DATA_DIR)) return;
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(
      TELEGRAM_STATE_FILE,
      JSON.stringify({ liveSnapshot: snapshot, actionAuditLog: audit.slice(0, 100) }, null, 2),
      'utf8'
    );
  } catch (err) {
    console.warn('[Topchan Telegram] Could not save persisted store:', err instanceof Error ? err.message : err);
  }
}

const initialStore = loadPersistedStore();
let schedulerHandle: ReturnType<typeof setInterval> | null = null;
const sentKeys = new Set<string>();
const inFlightKeys = new Set<string>();
const actionAuditLog: TelegramActionAudit[] = initialStore.actionAuditLog;
let liveSnapshot: LiveOpsSnapshot = initialStore.liveSnapshot;

/**
 * Safely splits `action:targetId` on the FIRST colon so targetIds containing colons
 * (e.g. `room-mix-dorm:mix-bed-4`) are never truncated.
 */
export function parseCallbackData(data: string): { action: string; targetId: string } {
  const idx = data.indexOf(':');
  if (idx === -1) {
    return { action: data.trim(), targetId: '' };
  }
  return {
    action: data.slice(0, idx).trim(),
    targetId: data.slice(idx + 1).trim(),
  };
}

function getSupabaseServerConfig(): { baseUrl: string; apiKey: string; propertyId: string } | null {
  const baseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const apiKey = (
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    ''
  ).trim();
  if (!baseUrl.startsWith('https://') || !apiKey) return null;
  const propertyId =
    liveSnapshot.propertyId || process.env.VITE_PROPERTY_ID?.trim() || 'topchan-tashkent-01';
  return { baseUrl, apiKey, propertyId };
}

/**
 * Persists a Telegram inline button mutation directly into Supabase (`property_snapshots` +
 * normalized tables `housekeeping_tasks` / `audit_log`) so state is durable across restarts
 * and synced back to the reception UI.
 */
async function persistMutationToSupabase(params: {
  action: 'close_debt' | 'hk_done' | 'safe_confirm';
  targetId: string;
  telegramUserId: string;
  note: string;
}): Promise<boolean> {
  const cfg = getSupabaseServerConfig();
  if (!cfg) return false;

  const headers = {
    apikey: cfg.apiKey,
    Authorization: `Bearer ${cfg.apiKey}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  try {
    // 1. Always append immutable audit entry to normalized `audit_log`
    await fetch(`${cfg.baseUrl}/rest/v1/audit_log`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: JSON.stringify([
        {
          id: `tg-aud-${Date.now()}`,
          property_id: cfg.propertyId,
          actor: `Telegram #${params.telegramUserId}`,
          action: `Telegram:${params.action}`,
          diff: params.targetId,
          reason: params.note,
        },
      ]),
    }).catch(() => {});

    // 2. Update normalized housekeeping_tasks when `hk_done`
    if (params.action === 'hk_done') {
      const [roomId, bedId] = params.targetId.includes(':')
        ? params.targetId.split(':')
        : [params.targetId, ''];
      const filter = bedId
        ? `property_id=eq.${encodeURIComponent(cfg.propertyId)}&room_id=eq.${encodeURIComponent(roomId)}&bed_id=eq.${encodeURIComponent(bedId)}`
        : `property_id=eq.${encodeURIComponent(cfg.propertyId)}&room_id=eq.${encodeURIComponent(roomId)}`;
      await fetch(`${cfg.baseUrl}/rest/v1/housekeeping_tasks?${filter}`, {
        method: 'PATCH',
        headers: { ...headers, Prefer: 'return=minimal' },
        body: JSON.stringify({ status: 'approved' }),
      }).catch(() => {});
    }

    // 3. Load latest property_snapshots row, apply authoritative mutation, and PATCH with incremented revision
    const getRes = await fetch(
      `${cfg.baseUrl}/rest/v1/property_snapshots?property_id=eq.${encodeURIComponent(
        cfg.propertyId
      )}&select=payload,revision,schema_version&limit=1`,
      { headers }
    );
    if (!getRes.ok) return false;
    const rows = (await getRes.json()) as Array<{
      payload?: Record<string, unknown>;
      revision?: number;
      schema_version?: number;
    }>;
    const row = rows[0];
    if (!row?.payload || typeof row.payload !== 'object') return false;

    const currentRev = typeof row.revision === 'number' ? row.revision : 1;
    const nextRev = currentRev + 1;
    const nowIso = new Date().toISOString();
    const payload = structuredClone(row.payload) as Record<string, unknown>;

    if (params.action === 'close_debt' && Array.isArray(payload.bookings)) {
      payload.bookings = (payload.bookings as Array<Record<string, unknown>>).map((b) => {
        if (b.id !== params.targetId) return b;
        const ledger = Array.isArray(b.ledgerEntries)
          ? (b.ledgerEntries as Array<Record<string, unknown>>)
          : [];
        const charges = ledger
          .filter((e) => e.type === 'charge')
          .reduce((s, e) => s + Number(e.amountUsd || 0), 0);
        const payments = ledger
          .filter((e) => e.type === 'payment')
          .reduce((s, e) => s + Number(e.amountUsd || 0), 0);
        const debt = Math.round((charges - payments) * 100) / 100;
        if (debt <= 0) return b;
        return {
          ...b,
          ledgerEntries: [
            ...ledger,
            {
              id: `led-tg-${Date.now()}`,
              timestamp: nowIso,
              type: 'payment',
              category: 'payment',
              label: `Оплата подтверждена через Telegram (#${params.telegramUserId})`,
              amountUsd: debt,
              originalCurrency: 'USD',
              originalAmount: debt,
              pocketId: 'cash_usd',
              actor: `Telegram #${params.telegramUserId}`,
            },
          ],
        };
      });
    } else if (params.action === 'hk_done') {
      const [roomId, bedId] = params.targetId.includes(':')
        ? params.targetId.split(':')
        : [params.targetId, ''];
      if (Array.isArray(payload.physicalRooms)) {
        payload.physicalRooms = (payload.physicalRooms as Array<Record<string, unknown>>).map((r) => {
          if (r.id !== roomId) return r;
          if (bedId && Array.isArray(r.beds)) {
            return {
              ...r,
              beds: (r.beds as Array<Record<string, unknown>>).map((bed) =>
                bed.id === bedId && bed.status === 'dirty' ? { ...bed, status: 'available' } : bed
              ),
            };
          }
          return r.status === 'dirty' ? { ...r, status: 'available' } : r;
        });
      }
      if (Array.isArray(payload.housekeepingTasks)) {
        payload.housekeepingTasks = (payload.housekeepingTasks as Array<Record<string, unknown>>).map((t) => {
          const matches = bedId ? t.roomId === roomId && t.bedId === bedId : t.roomId === roomId || t.id === params.targetId;
          return matches ? { ...t, status: 'approved' } : t;
        });
      }
    } else if (params.action === 'safe_confirm' && Array.isArray(payload.safeCollections)) {
      let confirmedCol: Record<string, unknown> | null = null;
      payload.safeCollections = (payload.safeCollections as Array<Record<string, unknown>>).map((c) => {
        if (c.id !== params.targetId || c.status === 'confirmed') return c;
        confirmedCol = c;
        return { ...c, status: 'confirmed', confirmedAt: nowIso };
      });
      if (confirmedCol && Array.isArray(payload.pockets)) {
        const col = confirmedCol as { amountUzs?: number; amountUsd?: number; amountEur?: number };
        payload.pockets = (payload.pockets as Array<Record<string, unknown>>).map((p) => {
          if (p.id !== 'safe') return p;
          const prev = (p.safeBalances as { UZS?: number; USD?: number; EUR?: number }) ?? {
            UZS: 0,
            USD: Number(p.balance || 0),
            EUR: 0,
          };
          const nextUsd = Math.round(((prev.USD ?? 0) + Number(col.amountUsd || 0)) * 100) / 100;
          return {
            ...p,
            balance: nextUsd,
            safeBalances: {
              UZS: Math.round((prev.UZS ?? 0) + Number(col.amountUzs || 0)),
              USD: nextUsd,
              EUR: Math.round(((prev.EUR ?? 0) + Number(col.amountEur || 0)) * 100) / 100,
            },
          };
        });
      }
    }

    if (Array.isArray(payload.auditLog)) {
      payload.auditLog = [
        {
          id: `aud-tg-${Date.now()}`,
          propertyId: cfg.propertyId,
          timestamp: nowIso,
          actor: `Telegram #${params.telegramUserId}`,
          action: `Telegram: ${params.action}`,
          diff: params.targetId,
          reason: params.note,
        },
        ...(payload.auditLog as Array<Record<string, unknown>>),
      ];
    }

    payload.revision = nextRev;

    const patchRes = await fetch(
      `${cfg.baseUrl}/rest/v1/property_snapshots?property_id=eq.${encodeURIComponent(
        cfg.propertyId
      )}&revision=eq.${currentRev}`,
      {
        method: 'PATCH',
        headers: { ...headers, Prefer: 'return=minimal' },
        body: JSON.stringify({
          schema_version: row.schema_version ?? 4,
          revision: nextRev,
          payload,
          updated_at: nowIso,
        }),
      }
    );

    return patchRes.ok;
  } catch (err) {
    console.error('[Topchan Telegram] Supabase persistence failed:', err instanceof Error ? err.message : err);
    return false;
  }
}

/**
 * Formats a complete copy-paste E-mehmon registration block for a booking.
 */
export function buildEmehmonExportText(bookingId: string): string {
  const guests = liveSnapshot.unregisteredEmehmon.filter((g) => g.bookingId === bookingId);
  if (guests.length === 0) {
    return `📋 E-mehmon экспорт (${bookingId}): все гости по этой брони уже зарегистрированы или бронь не найдена.`;
  }

  const lines = [
    `📋 ГОТОВАЯ СВОДКА ДЛЯ E-MEHMON (лимит 72ч)`,
    `Объект: Topchan Hostel · г. Ташкент, ул. 8 Марта, 104`,
    `Бронь: ${guests[0].bnovoId || bookingId} · Комната: ${guests[0].roomLabel}`,
  ];
  if (guests[0].fromDate || guests[0].toDate) {
    lines.push(`Даты: ${guests[0].fromDate ?? liveSnapshot.operationalDate} → ${guests[0].toDate ?? '—'}`);
  }
  lines.push('—'.repeat(28));

  for (const g of guests) {
    lines.push(
      `ФИО: ${g.guestName}`,
      `Паспорт: ${g.passportNo}`,
      `Гражданство: ${g.citizenship}`,
      ...(g.dob ? [`Дата рождения: ${g.dob}`] : []),
      ...(g.sex ? [`Пол: ${g.sex}`] : []),
      '—'.repeat(28)
    );
  }
  lines.push('Скопируйте поля выше в кабинет emehmon.uz и отметьте регистрацию в Topchan Ops.');
  return lines.join('\n');
}

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
  savePersistedStore(liveSnapshot, actionAuditLog);
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
      { text: `🔐 Подтвердить инкассацию (${c.summary})`, callback_data: `safe_confirm:${c.id}` },
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
      { text: `📋 Выгрузить для E-mehmon: ${g.guestName}`, callback_data: `emehmon_export:${g.bookingId}` },
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
      '/emehmon — иностранцы без регистрации 72ч (+ выгрузка полей)',
      '/luggage — камера хранения багажа (#B..)',
    ].join('\n'),
  };
}

export async function handleTelegramWebhookUpdate(update: TelegramUpdate): Promise<{
  ok: boolean;
  handled: boolean;
  reason?: string;
  replyText?: string;
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

    const { action, targetId } = parseCallbackData(cb.data ?? '');
    let replyText = 'Операция зафиксирована.';
    let persistedToSupabase = false;

    if (action === 'close_debt' && targetId) {
      const target = liveSnapshot.debts.find((d) => d.bookingId === targetId);
      liveSnapshot = {
        ...liveSnapshot,
        debts: liveSnapshot.debts.filter((d) => d.bookingId !== targetId),
        checkoutsToday: liveSnapshot.checkoutsToday.map((c) =>
          c.bookingId === targetId ? { ...c, debtUsd: 0 } : c
        ),
        updatedAt: new Date().toISOString(),
      };
      replyText = target
        ? `✅ Долг ${target.roomLabel} (${target.guestName}, $${target.debtUsd}) закрыт через Telegram и сохранён.`
        : '✅ Долг уже закрыт.';
      persistedToSupabase = await persistMutationToSupabase({
        action: 'close_debt',
        targetId,
        telegramUserId: String(fromId),
        note: replyText,
      });
    } else if (action === 'hk_done' && targetId) {
      const target = liveSnapshot.dirtyRooms.find((r) => r.id === targetId);
      liveSnapshot = {
        ...liveSnapshot,
        dirtyRooms: liveSnapshot.dirtyRooms.filter((r) => r.id !== targetId),
        freeUnits: target
          ? Math.min(liveSnapshot.totalUnits, liveSnapshot.freeUnits + 1)
          : liveSnapshot.freeUnits,
        updatedAt: new Date().toISOString(),
      };
      replyText = target
        ? `✨ Уборка ${target.label} подтверждена через Telegram — номер открыт в продажу и сохранён.`
        : '✨ Комната уже чистая.';
      persistedToSupabase = await persistMutationToSupabase({
        action: 'hk_done',
        targetId,
        telegramUserId: String(fromId),
        note: replyText,
      });
    } else if ((action === 'safe_confirm' || action === 'confirm_safe') && targetId) {
      const target = liveSnapshot.pendingSafeCollections.find((c) => c.id === targetId);
      const confirmedAt = new Date().toISOString();
      liveSnapshot = {
        ...liveSnapshot,
        pendingSafeCollections: liveSnapshot.pendingSafeCollections.filter((c) => c.id !== targetId),
        confirmedSafeCollections: target
          ? [
              {
                id: target.id,
                summary: target.summary,
                confirmedAt,
                confirmedBy: String(fromId),
              },
              ...(liveSnapshot.confirmedSafeCollections ?? []),
            ].slice(0, 50)
          : liveSnapshot.confirmedSafeCollections,
        updatedAt: confirmedAt,
      };
      replyText = target
        ? `🔐 Инкассация (${target.summary}) подтверждена и зафиксирована в сейфе.`
        : '🔐 Инкассация уже подтверждена.';
      persistedToSupabase = await persistMutationToSupabase({
        action: 'safe_confirm',
        targetId,
        telegramUserId: String(fromId),
        note: replyText,
      });
    } else if ((action === 'emehmon_export' || action === 'emehmon_card') && targetId) {
      replyText = buildEmehmonExportText(targetId);
    }

    actionAuditLog.unshift({
      id: `tg-act-${Date.now()}`,
      timestamp: new Date().toISOString(),
      telegramUserId: String(fromId),
      action: action || 'unknown',
      targetId: targetId || '',
      note: replyText,
      persistedToSupabase,
    });

    savePersistedStore(liveSnapshot, actionAuditLog);

    await answerCallbackQuery(cb.id, 'Выполнено');
    if (chatId) {
      await sendTelegramMessage(replyText, { chatId });
    }
    return { ok: true, handled: true, replyText };
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
    return { ok: true, handled: true, replyText: reply.text };
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
