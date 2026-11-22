/**
 * Yandex Mail IMAP Watcher (INBOX + dynamic \Junk/Spam) using native Node `tls` sockets.
 * Zero extra npm dependencies required.
 *
 * Security & Resilience:
 * - Reads credentials strictly from process.env:
 *   YANDEX_IMAP_HOST (default imap.yandex.ru), YANDEX_IMAP_USER, YANDEX_IMAP_PASS
 * - Gracefully stays idle with zero errors when credentials are unset
 * - Unfolds multi-line MIME headers before parsing and validates Date: safely (never throws RangeError)
 * - Dynamically discovers the Spam/Junk folder via IMAP `LIST "" "*"` (`\Junk` attribute + fallbacks)
 * - Persists `seenKeys` to disk (`.topchan-data/mail-seen.json`) so server restarts never duplicate Telegram alerts
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import tls from 'node:tls';

export interface ServerMailInquiry {
  id: string;
  folder: 'INBOX' | 'Spam';
  from: string;
  subject: string;
  receivedAt: string;
  category: 'booking' | 'transfer' | 'group' | 'question';
  snippet: string;
  draftReplyRu: string;
  draftReplyEn: string;
  handled: boolean;
}

const MAX_ITEMS = 40;
const MAX_SEEN_KEYS = 1000;
const IMAP_TIMEOUT_MS = 9000;
const POLL_INTERVAL_MS = 5 * 60 * 1000;

const DATA_DIR = path.resolve(process.cwd(), '.topchan-data');
const SEEN_FILE = path.resolve(DATA_DIR, 'mail-seen.json');

let mailCache: ServerMailInquiry[] = [];
let seenKeys = loadPersistedSeenKeys();
let watcherTimer: ReturnType<typeof setInterval> | null = null;
let lastSyncAt: string | null = null;
let lastError: string | null = null;

function isConfinedPath(targetPath: string, baseDir: string): boolean {
  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(targetPath);
  return resolvedTarget.startsWith(resolvedBase + path.sep);
}

function loadPersistedSeenKeys(): Set<string> {
  try {
    if (!isConfinedPath(SEEN_FILE, DATA_DIR) || !fs.existsSync(SEEN_FILE)) {
      return new Set<string>();
    }
    const raw = fs.readFileSync(SEEN_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return new Set<string>(parsed.filter((x): x is string => typeof x === 'string').slice(-MAX_SEEN_KEYS));
    }
  } catch (err) {
    console.warn('[Topchan MailWatcher] Could not load persisted seenKeys:', err instanceof Error ? err.message : err);
  }
  return new Set<string>();
}

function savePersistedSeenKeys(keys: Set<string>): void {
  try {
    if (!isConfinedPath(SEEN_FILE, DATA_DIR)) return;
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const bounded = Array.from(keys).slice(-MAX_SEEN_KEYS);
    fs.writeFileSync(SEEN_FILE, JSON.stringify(bounded, null, 2), 'utf8');
  } catch (err) {
    console.warn('[Topchan MailWatcher] Could not persist seenKeys:', err instanceof Error ? err.message : err);
  }
}

export function isMailWatcherConfigured(): boolean {
  return Boolean(process.env.YANDEX_IMAP_USER?.trim() && process.env.YANDEX_IMAP_PASS?.trim());
}

export function getMailInboxSnapshot(): {
  configured: boolean;
  lastSyncAt: string | null;
  lastError: string | null;
  items: ServerMailInquiry[];
} {
  return {
    configured: isMailWatcherConfigured(),
    lastSyncAt,
    lastError,
    items: mailCache.slice(0, MAX_ITEMS),
  };
}

/**
 * Unfolds multi-line RFC 5322 folded MIME headers before header regex extraction.
 */
export function unfoldMimeHeaders(raw: string): string {
  return raw.replace(/\r?\n[ \t]+/g, ' ');
}

/**
 * Safely parses an email `Date:` header without ever throwing `RangeError: Invalid time value`.
 */
export function parseSafeEmailDate(
  rawDate: string | undefined,
  fallbackNow = new Date()
): { iso: string; valid: boolean } {
  if (rawDate && rawDate.trim()) {
    const ts = Date.parse(rawDate.trim());
    if (Number.isFinite(ts)) {
      return { iso: new Date(ts).toISOString(), valid: true };
    }
  }
  return { iso: fallbackNow.toISOString(), valid: false };
}

/**
 * Discovers the real Spam/Junk mailbox name from an IMAP `LIST "" "*"` response.
 * Prioritizes the RFC 6154 `\Junk` special-use attribute, falling back to Spam / Спам / Junk.
 */
export function findJunkFolderFromList(listResponse: string): string {
  const lines = listResponse.split(/\r?\n/);
  let fallbackName: string | null = null;

  for (const line of lines) {
    const match = line.match(/^\*\s+LIST\s+\(([^)]*)\)\s+(?:"[^"]*"|NIL)\s+(.+)$/i);
    if (!match) continue;
    const attrs = match[1] ?? '';
    let mailbox = (match[2] ?? '').trim();
    if (mailbox.startsWith('"') && mailbox.endsWith('"') && mailbox.length >= 2) {
      mailbox = mailbox.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }
    if (!mailbox) continue;

    if (/\\Junk\b/i.test(attrs)) {
      return mailbox;
    }

    if (!fallbackName && /^(spam|junk|спам|&BCEEPwQwBDw-)$/i.test(mailbox)) {
      fallbackName = mailbox;
    }
  }

  return fallbackName ?? 'Spam';
}

function classifyEmail(subject: string, snippet: string): ServerMailInquiry['category'] {
  const text = `${subject} ${snippet}`.toLowerCase();
  if (/transfer|airport|flight|taxi|трансфер|аэропорт|рейс|встрет/i.test(text)) {
    return 'transfer';
  }
  if (/group|team|10 people|8 guests|групп|команд|человек/i.test(text)) {
    return 'group';
  }
  if (/book|reserv|room|bed|night|avail|брон|номер|койк|заезд|ноч/i.test(text)) {
    return 'booking';
  }
  return 'question';
}

function buildDraftReplies(
  category: ServerMailInquiry['category'],
  subject: string
): { ru: string; en: string } {
  if (category === 'transfer') {
    return {
      ru: `Здравствуйте! По вашему письму «${subject}»: Topchan Hostel находится в 3 км от аэропорта Ташкента (ул. 8 Марта, 104). Мы организуем встречу с табличкой за $5. Пришлите, пожалуйста, номер рейса и время прилёта.`,
      en: `Hello! Regarding "${subject}": Topchan Hostel is just 3 km from Tashkent Airport (104, 8-Mart st.). We can arrange an airport pickup for $5. Please share your flight number and arrival time.`,
    };
  }
  if (category === 'group') {
    return {
      ru: `Здравствуйте! Спасибо за групповой запрос «${subject}». В Topchan Hostel 20 комнат (17 отдельных номеров + 3 дорма на 20 коек, включая женский Fem Dorm). Пришлите даты и количество гостей — подготовим лучшее предложение без комиссии OTA.`,
      en: `Hello! Thank you for your group inquiry "${subject}". Topchan Hostel has 20 rooms (17 private rooms + 3 dorms / 20 beds, including female-only Fem Dorm). Share your dates and guest count and we will send our best direct rate.`,
    };
  }
  if (category === 'booking') {
    return {
      ru: `Здравствуйте! По запросу «${subject}»: заезд с 14:00, выезд до 12:00, бесплатный завтрак 08:00–10:00, бесплатная камера хранения багажа и регистрация E-mehmon. Подтвердите даты и тип комнаты (Small / Yellow / Green / Dorm), и мы закрепим бронь напрямую.`,
      en: `Hello! Regarding "${subject}": check-in is from 14:00, check-out until 12:00, free breakfast 08:00–10:00, free luggage storage, and E-mehmon registration included. Confirm your dates and preferred room type and we will hold your direct booking.`,
    };
  }
  return {
    ru: `Здравствуйте! Спасибо за обращение в Topchan Hostel («${subject}»). Мы на связи 24/7 по адресу ул. 8 Марта, 104 (Ташкент). Уточните, пожалуйста, детали — поможем в течение 10 минут.`,
    en: `Hello! Thank you for contacting Topchan Hostel ("${subject}"). Our reception at 104, 8-Mart st., Tashkent is open 24/7. Please let us know any extra details and we will assist right away.`,
  };
}

function decodeMimeWords(input: string): string {
  return unfoldMimeHeaders(input)
    .replace(/=\?UTF-8\?B\?([^?]+)\?=/gi, (_m, b64: string) => {
      try {
        return Buffer.from(b64, 'base64').toString('utf8');
      } catch {
        return b64;
      }
    })
    .replace(/=\?UTF-8\?Q\?([^?]+)\?=/gi, (_m, q: string) => {
      try {
        return q
          .replace(/_/g, ' ')
          .replace(/=([0-9A-Fa-f]{2})/g, (_h, hex: string) =>
            String.fromCharCode(Number.parseInt(hex, 16))
          );
      } catch {
        return q;
      }
    })
    .trim();
}

function imapQuote(val: string): string {
  return `"${val.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * Pure parser for IMAP FETCH header blocks.
 * Unfolds multi-line MIME headers, parses dates safely without throwing,
 * and computes deterministic SHA-256 fallback IDs instead of Math.random().
 */
export function parseImapFetchBlocks(
  fetchResp: string,
  folder: 'INBOX' | 'Spam',
  fallbackNow = new Date()
): ServerMailInquiry[] {
  const parsed: ServerMailInquiry[] = [];
  const blocks = fetchResp.split(/\*\s+\d+\s+FETCH\s+/i).slice(1);

  for (const rawBlock of blocks) {
    const unfolded = unfoldMimeHeaders(rawBlock);
    const uidMatch = unfolded.match(/UID\s+(\d+)/i);
    const fromMatch = unfolded.match(/^From:\s*(.+)$/im);
    const subjMatch = unfolded.match(/^Subject:\s*(.+)$/im);
    const dateMatch = unfolded.match(/^Date:\s*(.+)$/im);

    const from = decodeMimeWords(fromMatch?.[1] ?? 'guest@mail.com');
    const subject = decodeMimeWords(subjMatch?.[1] ?? 'Запрос в Topchan Hostel');
    const rawDate = dateMatch?.[1]?.trim();
    const dateParsed = parseSafeEmailDate(rawDate, fallbackNow);

    const deterministicUid =
      uidMatch?.[1] ??
      crypto
        .createHash('sha256')
        .update(`${folder}|${from}|${subject}|${rawDate ?? ''}`)
        .digest('hex')
        .slice(0, 12);

    const category = classifyEmail(subject, from);
    const drafts = buildDraftReplies(category, subject);
    const dateNote = dateParsed.valid ? '' : ' · дата письма не распознана';

    parsed.push({
      id: `mail-${folder.toLowerCase()}-${deterministicUid}`,
      folder,
      from,
      subject,
      receivedAt: dateParsed.iso,
      category,
      snippet: `Письмо из папки ${folder} от ${from} (${subject})${dateNote}`,
      draftReplyRu: drafts.ru,
      draftReplyEn: drafts.en,
      handled: false,
    });
  }

  return parsed.reverse();
}

/**
 * Single-session TLS IMAP runner: authenticates once, discovers the real \Junk mailbox via LIST "" "*",
 * and fetches recent headers from both INBOX and Spam/Junk without external packages.
 */
async function fetchInboxAndJunkOverTls(
  host: string,
  user: string,
  pass: string
): Promise<ServerMailInquiry[]> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({
      host,
      port: 993,
      servername: host,
      rejectUnauthorized: true,
    });

    let buffer = '';
    let settled = false;
    let tagSeq = 0;

    const finish = (err: Error | null, items: ServerMailInquiry[] = []) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try {
        socket.end();
      } catch {
        // ignore close error
      }
      if (err) reject(err);
      else resolve(items);
    };

    const timeout = setTimeout(() => {
      finish(new Error('IMAP timeout (INBOX + Junk)'));
    }, IMAP_TIMEOUT_MS);

    const waiters: Array<{
      tag: string;
      resolve: (chunk: string) => void;
      reject: (err: Error) => void;
    }> = [];

    const sendCmd = (cmd: string): Promise<string> => {
      const tag = `A${++tagSeq}`;
      return new Promise((res, rej) => {
        waiters.push({ tag, resolve: res, reject: rej });
        socket.write(`${tag} ${cmd}\r\n`);
      });
    };

    let greeted = false;
    let greetResolve: (() => void) | null = null;
    const waitGreeting = () =>
      new Promise<void>((res) => {
        if (greeted) res();
        else greetResolve = res;
      });

    socket.setEncoding('utf8');
    socket.on('error', (err) => finish(err));
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      if (!greeted && buffer.includes('\r\n')) {
        greeted = true;
        buffer = buffer.slice(buffer.indexOf('\r\n') + 2);
        greetResolve?.();
      }
      if (waiters.length > 0) {
        const current = waiters[0];
        const okPattern = new RegExp(`(?:^|\\r\\n)${current.tag} (OK|NO|BAD)[^\\r\\n]*\\r\\n`);
        const match = buffer.match(okPattern);
        if (match && match.index !== undefined) {
          const endIdx = match.index + match[0].length;
          const response = buffer.slice(0, endIdx);
          buffer = buffer.slice(endIdx);
          waiters.shift();
          if (match[1] === 'OK') current.resolve(response);
          else current.reject(new Error(`IMAP ${match[1]}: ${match[0].trim()}`));
        }
      }
    });

    const examineAndFetch = async (
      mailboxName: string,
      logicalFolder: 'INBOX' | 'Spam'
    ): Promise<ServerMailInquiry[]> => {
      const selectResp = await sendCmd(`EXAMINE ${imapQuote(mailboxName)}`);
      const existsMatch = selectResp.match(/\*\s+(\d+)\s+EXISTS/i);
      const total = existsMatch ? Number.parseInt(existsMatch[1], 10) : 0;
      if (!Number.isFinite(total) || total <= 0) {
        return [];
      }
      const start = Math.max(1, total - 7);
      const fetchResp = await sendCmd(
        `FETCH ${start}:${total} (UID BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE)])`
      );
      return parseImapFetchBlocks(fetchResp, logicalFolder);
    };

    socket.once('secureConnect', async () => {
      try {
        await waitGreeting();
        await sendCmd(`LOGIN ${imapQuote(user)} ${imapQuote(pass)}`);

        let junkMailbox = 'Spam';
        try {
          const listResp = await sendCmd('LIST "" "*"');
          junkMailbox = findJunkFolderFromList(listResp);
        } catch (listErr) {
          console.warn(
            '[Topchan MailWatcher] IMAP LIST failed; falling back to Spam folder:',
            listErr instanceof Error ? listErr.message : listErr
          );
        }

        const collected: ServerMailInquiry[] = [];

        const inboxRows = await examineAndFetch('INBOX', 'INBOX');
        collected.push(...inboxRows);

        const junkCandidates = Array.from(new Set([junkMailbox, 'Spam', 'Спам']));
        let junkReadOk = false;
        let lastJunkErr: unknown = null;
        for (const candidate of junkCandidates) {
          try {
            const spamRows = await examineAndFetch(candidate, 'Spam');
            collected.push(...spamRows);
            junkReadOk = true;
            break;
          } catch (folderErr) {
            lastJunkErr = folderErr;
          }
        }
        if (!junkReadOk && lastJunkErr) {
          console.warn(
            `[Topchan MailWatcher] Unable to read Spam/Junk folder (${junkCandidates.join(', ')}):`,
            lastJunkErr instanceof Error ? lastJunkErr.message : lastJunkErr
          );
        }

        await sendCmd('LOGOUT').catch(() => {});
        finish(null, collected);
      } catch (err) {
        finish(err instanceof Error ? err : new Error(String(err)));
      }
    });
  });
}

export async function pollYandexImapOnce(
  onNewInquiry?: (inquiry: ServerMailInquiry) => void
): Promise<{ ok: boolean; configured: boolean; added: number; items: ServerMailInquiry[]; error?: string }> {
  if (!isMailWatcherConfigured()) {
    return {
      ok: true,
      configured: false,
      added: 0,
      items: mailCache,
    };
  }

  const host = process.env.YANDEX_IMAP_HOST?.trim() || 'imap.yandex.ru';
  const user = process.env.YANDEX_IMAP_USER!.trim();
  const pass = process.env.YANDEX_IMAP_PASS!.trim();

  try {
    const collected = await fetchInboxAndJunkOverTls(host, user, pass);

    let added = 0;
    for (const item of collected) {
      if (!seenKeys.has(item.id)) {
        seenKeys.add(item.id);
        mailCache = [item, ...mailCache.filter((x) => x.id !== item.id)].slice(0, MAX_ITEMS);
        added += 1;
        onNewInquiry?.(item);
      }
    }

    if (added > 0) {
      savePersistedSeenKeys(seenKeys);
    }

    lastSyncAt = new Date().toISOString();
    lastError = null;
    return {
      ok: true,
      configured: true,
      added,
      items: mailCache,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'IMAP sync error';
    lastError = message;
    console.error('[Topchan MailWatcher] IMAP poll failed:', message);
    return {
      ok: false,
      configured: true,
      added: 0,
      items: mailCache,
      error: message,
    };
  }
}

export function startMailWatcher(onNewInquiry?: (inquiry: ServerMailInquiry) => void): void {
  if (watcherTimer) return;
  if (!isMailWatcherConfigured()) {
    console.log(
      '[Topchan MailWatcher] YANDEX_IMAP_USER / YANDEX_IMAP_PASS не заданы — IMAP-контроллер в режиме ожидания.'
    );
    return;
  }

  console.log('[Topchan MailWatcher] Яндекс IMAP-контроллер (INBOX + \\Junk) запущен (интервал 5 мин).');
  void pollYandexImapOnce(onNewInquiry);
  watcherTimer = setInterval(() => {
    void pollYandexImapOnce(onNewInquiry);
  }, POLL_INTERVAL_MS);
}
