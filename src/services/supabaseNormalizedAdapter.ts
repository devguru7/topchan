import type { AppState } from '../types/ops';

export type NormalizedTableName =
  | 'booking_groups'
  | 'stay_segments'
  | 'stay_guests'
  | 'ledger_entries'
  | 'cash_transactions'
  | 'housekeeping_tasks'
  | 'audit_log';

export interface OfflineMutationItem {
  id: string;
  table: NormalizedTableName;
  operation: 'upsert' | 'insert' | 'delete';
  rows: Array<Record<string, unknown>>;
  deleteIds?: string[];
  propertyId?: string;
  attempts?: number;
  lastError?: string;
  createdAt: string;
}

export interface OfflineSyncStatus {
  isOnline: boolean;
  pendingCount: number;
  failedCount: number;
  lastFlushedAt?: string;
  realtimeConnected: boolean;
}

interface PostTableOutcome {
  ok: boolean;
  status: number;
  permanentError: boolean;
  error?: string;
}

const OFFLINE_QUEUE_KEY = 'topchan_offline_queue_v1';
const FAILED_QUEUE_KEY = 'topchan_offline_failed_queue_v1';
const SYNCED_AUDIT_IDS_KEY = 'topchan_synced_audit_ids_v1';
const MAX_RETRY_ATTEMPTS = 5;
const MAX_TRACKED_AUDIT_IDS = 500;

function readStorageArray(key: string): OfflineMutationItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as OfflineMutationItem[]) : [];
  } catch {
    return [];
  }
}

function writeStorageArray(key: string, items: OfflineMutationItem[], maxItems = 200): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(items.slice(-maxItems)));
  } catch {
    // Ignore storage quota issues in restricted environments
  }
}

function readSyncedAuditIds(): Set<string> {
  if (typeof window === 'undefined') return new Set<string>();
  try {
    const raw = window.localStorage.getItem(SYNCED_AUDIT_IDS_KEY);
    if (!raw) return new Set<string>();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set<string>();
    return new Set(parsed.filter((v): v is string => typeof v === 'string').slice(-MAX_TRACKED_AUDIT_IDS));
  } catch {
    return new Set<string>();
  }
}

function writeSyncedAuditIds(ids: Set<string>): void {
  if (typeof window === 'undefined') return;
  try {
    const bounded = Array.from(ids).slice(-MAX_TRACKED_AUDIT_IDS);
    window.localStorage.setItem(SYNCED_AUDIT_IDS_KEY, JSON.stringify(bounded));
  } catch {
    // Ignore storage quota issues
  }
}

/**
 * Classifies an HTTP status code as a permanent client/RLS error (4xx except 408/429)
 * versus a transient retryable error (network error / 408 / 429 / 5xx).
 */
export function isPermanentHttpError(status: number): boolean {
  if (status === 408 || status === 429) return false;
  return status >= 400 && status < 500;
}

/**
 * Maps current in-memory AppState into normalized relational table rows matching supabase/schema.sql.
 */
export function projectStateToNormalizedRows(
  state: AppState
): Record<NormalizedTableName, Array<Record<string, unknown>>> {
  const propertyId = state.propertyId;
  const opDate = state.operationalDate ?? new Date().toISOString().slice(0, 10);

  const booking_groups = state.bookings.map((b) => {
    const firstSeg = b.segments[0];
    const lastSeg = b.segments[b.segments.length - 1];
    const allRegistered = b.guests.every((g) => g.emehmonRegistered);
    return {
      id: b.id,
      property_id: propertyId,
      bnovo_id: b.bnovoId,
      source: b.source === 'QR Direct' || b.source === 'Telegram' ? 'Direct' : b.source,
      status: b.status,
      emehmon_status: allRegistered ? 'registered' : 'pending',
      check_in_date: firstSeg?.fromDate ?? opDate,
      check_out_date: lastSeg?.toDate ?? opDate,
      notes: b.notes ?? '',
    };
  });

  const stay_segments = state.bookings.flatMap((b) =>
    b.segments.map((s) => ({
      id: s.id,
      property_id: propertyId,
      booking_id: b.id,
      room_id: s.roomId,
      bed_id: s.bedId ?? null,
      from_date: s.fromDate,
      to_date: s.toDate,
      nightly_rate_usd: s.nightlyRateUsd,
    }))
  );

  const stay_guests = state.bookings.flatMap((b) =>
    b.guests.map((g, idx) => ({
      booking_id: b.id,
      guest_id: g.id,
      property_id: propertyId,
      is_primary: idx === 0,
    }))
  );

  const ledger_entries = state.bookings.flatMap((b) =>
    b.ledgerEntries.map((l) => ({
      id: l.id,
      property_id: propertyId,
      booking_id: b.id,
      kind: l.type,
      category: l.category,
      description: l.label,
      amount_usd: l.amountUsd,
      original_amount: l.originalAmount ?? null,
      original_currency: l.originalCurrency ?? null,
      pocket_id: l.pocketId ?? null,
      actor: l.actor,
    }))
  );

  const cash_transactions = state.transactions.slice(0, 60).map((t) => ({
    id: t.id,
    property_id: propertyId,
    pocket_id: t.pocketId,
    direction: t.direction,
    amount: t.amount,
    currency: t.currency,
    label: t.label,
    booking_id: t.bookingId ?? null,
    actor: t.actor,
  }));

  const housekeeping_tasks = state.housekeepingTasks.map((h) => ({
    id: h.id,
    property_id: propertyId,
    room_id: h.roomId,
    bed_id: h.bedId ?? null,
    room_label: h.roomLabel,
    status: h.status,
    maid_name: null,
    photo_attached: Boolean(h.photoAttached),
    notes: h.notes ?? '',
  }));

  const audit_log = state.auditLog.slice(0, 40).map((a) => ({
    id: a.id,
    property_id: propertyId,
    actor: a.actor,
    action: a.action,
    diff: a.diff,
    reason: a.reason,
  }));

  return {
    booking_groups,
    stay_segments,
    stay_guests,
    ledger_entries,
    cash_transactions,
    housekeeping_tasks,
    audit_log,
  };
}

/**
 * Normalized Supabase table synchronizer + persistent Offline Mutation Queue + real WebSocket Realtime channel
 * with 15-second REST polling strictly as fallback when WebSocket is disconnected.
 */
export class SupabaseNormalizedSync {
  private readonly baseUrl: string | null;
  private readonly anonKey: string | null;
  private readonly fetchImpl: typeof fetch;
  private accessToken: string | null = null;
  private queue: OfflineMutationItem[] = readStorageArray(OFFLINE_QUEUE_KEY);
  private failedQueue: OfflineMutationItem[] = readStorageArray(FAILED_QUEUE_KEY);
  private syncedAuditIds: Set<string> = readSyncedAuditIds();
  private isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
  private lastFlushedAt?: string;
  private realtimeConnected = false;
  private flushing = false;
  private readonly listeners = new Set<(status: OfflineSyncStatus) => void>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private ws: WebSocket | null = null;
  private onlineHandler: (() => void) | null = null;
  private offlineHandler: (() => void) | null = null;
  private seqCounter = 0;

  constructor(
    supabaseUrl?: string,
    anonKey?: string,
    options?: { fetchImpl?: typeof fetch; initialOnline?: boolean }
  ) {
    const cleanUrl = supabaseUrl?.trim();
    const cleanKey = anonKey?.trim();
    this.baseUrl = cleanUrl && cleanUrl.startsWith('https://') ? cleanUrl.replace(/\/+$/, '') : null;
    this.anonKey = cleanKey || null;
    this.fetchImpl = options?.fetchImpl ?? globalThis.fetch.bind(globalThis);
    if (typeof options?.initialOnline === 'boolean') {
      this.isOnline = options.initialOnline;
    }
    this.bindNetworkListeners();
  }

  get isConfigured(): boolean {
    return Boolean(this.baseUrl && this.anonKey);
  }

  setAccessToken(token: string | null): void {
    this.accessToken = token;
    if (token && this.isOnline && this.queue.length > 0) {
      void this.flushQueue();
    }
  }

  setOnlineStatus(online: boolean): void {
    this.isOnline = online;
    if (!online) {
      this.realtimeConnected = false;
    }
    this.emit();
  }

  getQueue(): OfflineMutationItem[] {
    return [...this.queue];
  }

  getFailedQueue(): OfflineMutationItem[] {
    return [...this.failedQueue];
  }

  clearFailedQueue(): void {
    this.failedQueue = [];
    writeStorageArray(FAILED_QUEUE_KEY, this.failedQueue, 100);
    this.emit();
  }

  getStatus(): OfflineSyncStatus {
    return {
      isOnline: this.isOnline,
      pendingCount: this.queue.length,
      failedCount: this.failedQueue.length,
      lastFlushedAt: this.lastFlushedAt,
      realtimeConnected: this.realtimeConnected,
    };
  }

  subscribeStatus(listener: (status: OfflineSyncStatus) => void): () => void {
    this.listeners.add(listener);
    listener(this.getStatus());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    const snapshot = this.getStatus();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }

  private bindNetworkListeners(): void {
    if (typeof window === 'undefined') return;
    this.onlineHandler = () => {
      this.isOnline = true;
      this.emit();
      void this.flushQueue();
    };
    this.offlineHandler = () => {
      this.isOnline = false;
      this.realtimeConnected = false;
      this.emit();
    };
    window.addEventListener('online', this.onlineHandler);
    window.addEventListener('offline', this.offlineHandler);
  }

  /**
   * Enqueues normalized relational table mutations and flushes immediately when online + configured.
   * NEVER overwrites/deduplicates `insert` operations or `audit_log` rows so audit history is never lost.
   */
  enqueueNormalizedSync(
    state: AppState,
    tables: NormalizedTableName[] = ['booking_groups', 'stay_segments', 'housekeeping_tasks']
  ): void {
    if (!this.isConfigured) return;
    const projected = projectStateToNormalizedRows(state);
    const now = new Date().toISOString();

    const queuedAuditIds = new Set<string>();
    if (tables.includes('audit_log')) {
      for (const item of this.queue) {
        if (item.table !== 'audit_log') continue;
        for (const r of item.rows) {
          if (typeof r.id === 'string') queuedAuditIds.add(r.id);
        }
      }
    }

    let enqueuedAny = false;
    for (const table of tables) {
      let rows = projected[table];
      if (!rows || rows.length === 0) continue;

      if (table === 'audit_log') {
        rows = rows.filter((r) => {
          const id = typeof r.id === 'string' ? r.id : '';
          if (!id) return false;
          if (this.syncedAuditIds.has(id) || queuedAuditIds.has(id)) return false;
          queuedAuditIds.add(id);
          return true;
        });
        if (rows.length === 0) continue;
      }

      const operation: OfflineMutationItem['operation'] = table === 'audit_log' ? 'insert' : 'upsert';

      // Only deduplicate idempotent upserts on non-audit tables; NEVER drop `insert` or `audit_log` entries
      if (operation === 'upsert' && table !== 'audit_log') {
        this.queue = this.queue.filter(
          (item) => !(item.table === table && item.operation === 'upsert')
        );
      }

      this.queue.push({
        id: `oq-${table}-${Date.now()}-${++this.seqCounter}`,
        table,
        operation,
        rows,
        propertyId: state.propertyId,
        attempts: 0,
        createdAt: now,
      });
      enqueuedAny = true;
    }

    if (!enqueuedAny) return;

    writeStorageArray(OFFLINE_QUEUE_KEY, this.queue);
    this.emit();

    if (this.isOnline) {
      void this.flushQueue();
    }
  }

  /**
   * Enqueues a normalized table DELETE mutation so removed bookings, guests, payments, or rooms
   * do not remain orphaned in Supabase.
   */
  enqueueDelete(table: NormalizedTableName, ids: string[], propertyId?: string): void {
    if (!this.isConfigured) return;
    const cleanIds = ids.map((id) => id.trim()).filter(Boolean);
    if (cleanIds.length === 0) return;

    this.queue.push({
      id: `oq-del-${table}-${Date.now()}-${++this.seqCounter}`,
      table,
      operation: 'delete',
      rows: [],
      deleteIds: cleanIds,
      propertyId,
      attempts: 0,
      createdAt: new Date().toISOString(),
    });

    writeStorageArray(OFFLINE_QUEUE_KEY, this.queue);
    this.emit();

    if (this.isOnline) {
      void this.flushQueue();
    }
  }

  async flushQueue(): Promise<number> {
    if (!this.isConfigured || !this.isOnline || this.flushing || this.queue.length === 0) {
      return 0;
    }
    this.flushing = true;
    let flushedCount = 0;

    try {
      const remaining: OfflineMutationItem[] = [];
      let failedChanged = false;

      let syncedAuditsChanged = false;
      for (const item of this.queue) {
        const outcome = await this.postNormalizedTable(item);
        if (outcome.ok) {
          flushedCount += 1;
          if (item.table === 'audit_log') {
            for (const r of item.rows) {
              if (typeof r.id === 'string' && r.id) {
                this.syncedAuditIds.add(r.id);
                syncedAuditsChanged = true;
              }
            }
          }
          continue;
        }

        const nextAttempts = (item.attempts ?? 0) + 1;
        const updatedItem: OfflineMutationItem = {
          ...item,
          attempts: nextAttempts,
          lastError: outcome.error ?? `HTTP ${outcome.status}`,
        };

        // Permanent 4xx validation/RLS error OR exceeded retry budget -> quarantine in failedQueue
        if (outcome.permanentError || nextAttempts >= MAX_RETRY_ATTEMPTS) {
          console.error(
            `[Topchan Sync] Quarantining ${item.operation} on ${item.table} (${item.id}) after ${nextAttempts} attempt(s): ${updatedItem.lastError}`
          );
          this.failedQueue.push(updatedItem);
          failedChanged = true;
        } else {
          // Transient network / 408 / 429 / 5xx error -> keep in queue for retry
          remaining.push(updatedItem);
        }
      }

      this.queue = remaining;
      writeStorageArray(OFFLINE_QUEUE_KEY, this.queue);
      if (syncedAuditsChanged) {
        if (this.syncedAuditIds.size > MAX_TRACKED_AUDIT_IDS) {
          const trimmed = Array.from(this.syncedAuditIds).slice(-MAX_TRACKED_AUDIT_IDS);
          this.syncedAuditIds = new Set(trimmed);
        }
        writeSyncedAuditIds(this.syncedAuditIds);
      }
      if (failedChanged) {
        writeStorageArray(FAILED_QUEUE_KEY, this.failedQueue, 100);
      }
      if (flushedCount > 0) {
        this.lastFlushedAt = new Date().toISOString();
      }
    } finally {
      this.flushing = false;
      this.emit();
    }

    return flushedCount;
  }

  private async postNormalizedTable(item: OfflineMutationItem): Promise<PostTableOutcome> {
    if (!this.baseUrl || !this.anonKey) {
      return { ok: false, status: 0, permanentError: false, error: 'Supabase not configured' };
    }
    const bearer = this.accessToken?.trim() || this.anonKey;

    try {
      if (item.operation === 'delete') {
        const ids = item.deleteIds ?? [];
        if (ids.length === 0) {
          return { ok: true, status: 204, permanentError: false };
        }
        const encodedIds = ids.map((id) => encodeURIComponent(id)).join(',');
        const propFilter = item.propertyId
          ? `&property_id=eq.${encodeURIComponent(item.propertyId)}`
          : '';
        const res = await this.fetchImpl(
          `${this.baseUrl}/rest/v1/${item.table}?id=in.(${encodedIds})${propFilter}`,
          {
            method: 'DELETE',
            headers: {
              apikey: this.anonKey,
              Authorization: `Bearer ${bearer}`,
              Prefer: 'return=minimal',
            },
          }
        );
        if (res.ok) {
          return { ok: true, status: res.status, permanentError: false };
        }
        const errText = await res.text().catch(() => '');
        return {
          ok: false,
          status: res.status,
          permanentError: isPermanentHttpError(res.status),
          error: `HTTP ${res.status}: ${errText.slice(0, 180)}`,
        };
      }

      const preferHeader =
        item.operation === 'upsert'
          ? 'resolution=merge-duplicates,return=minimal'
          : 'resolution=ignore-duplicates,return=minimal';

      const res = await this.fetchImpl(`${this.baseUrl}/rest/v1/${item.table}`, {
        method: 'POST',
        headers: {
          apikey: this.anonKey,
          Authorization: `Bearer ${bearer}`,
          'Content-Type': 'application/json',
          Prefer: preferHeader,
        },
        body: JSON.stringify(item.rows),
      });

      if (res.ok) {
        return { ok: true, status: res.status, permanentError: false };
      }

      const errText = await res.text().catch(() => '');
      return {
        ok: false,
        status: res.status,
        permanentError: isPermanentHttpError(res.status),
        error: `HTTP ${res.status}: ${errText.slice(0, 180)}`,
      };
    } catch (err) {
      return {
        ok: false,
        status: 0,
        permanentError: false,
        error: err instanceof Error ? err.message : 'Network error',
      };
    }
  }

  /**
   * Connects to Supabase Realtime WebSocket (`topchan-ops-live` / Phoenix channel on property_snapshots).
   * Sets `realtimeConnected = true` ONLY when the Realtime server confirms `SUBSCRIBED` (`phx_reply` ok).
   * Runs 15-second REST polling strictly as a resilient fallback whenever WebSocket is disconnected.
   */
  startRealtimeChannel(propertyId: string, onRemoteChange: () => void): () => void {
    if (!this.isConfigured || typeof window === 'undefined') {
      this.realtimeConnected = false;
      this.emit();
      return () => {};
    }

    let disposed = false;
    let lastSeenUpdatedAt: string | null = null;
    let phxRef = 0;

    // Start strictly disconnected until Realtime confirms SUBSCRIBED
    this.realtimeConnected = false;
    this.emit();

    const clearSocketTimers = () => {
      if (this.heartbeatTimer !== null) {
        clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = null;
      }
      if (this.reconnectTimer !== null) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
    };

    const connectRealtimeWs = () => {
      if (disposed || !this.baseUrl || !this.anonKey || typeof WebSocket === 'undefined') {
        return;
      }
      try {
        const wsBase = this.baseUrl.replace(/^https:\/\//i, 'wss://');
        const wsUrl = `${wsBase}/realtime/v1/websocket?apikey=${encodeURIComponent(this.anonKey)}&vsn=1.0.0`;
        const socket = new WebSocket(wsUrl);
        this.ws = socket;

        const topic = 'realtime:topchan-ops-live';
        let joinRef = '';

        socket.addEventListener('open', () => {
          if (disposed) {
            socket.close();
            return;
          }
          joinRef = String(++phxRef);
          const jwt = this.accessToken?.trim() || this.anonKey;
          socket.send(
            JSON.stringify({
              topic,
              event: 'phx_join',
              payload: {
                config: {
                  broadcast: { ack: false, self: false },
                  presence: { key: propertyId },
                  postgres_changes: [
                    {
                      event: '*',
                      schema: 'public',
                      table: 'property_snapshots',
                      filter: `property_id=eq.${propertyId}`,
                    },
                  ],
                },
                access_token: jwt,
              },
              ref: joinRef,
            })
          );

          if (this.heartbeatTimer !== null) clearInterval(this.heartbeatTimer);
          this.heartbeatTimer = setInterval(() => {
            if (socket.readyState === WebSocket.OPEN) {
              socket.send(
                JSON.stringify({
                  topic: 'phoenix',
                  event: 'heartbeat',
                  payload: {},
                  ref: String(++phxRef),
                })
              );
            }
          }, 25_000);
        });

        socket.addEventListener('message', (event) => {
          if (disposed) return;
          try {
            const msg = JSON.parse(String(event.data)) as {
              topic?: string;
              event?: string;
              ref?: string;
              payload?: { status?: string; data?: { record?: { updated_at?: string } } };
            };
            if (msg.topic === topic && msg.event === 'phx_reply' && msg.ref === joinRef) {
              const subscribed = msg.payload?.status === 'ok';
              this.realtimeConnected = subscribed;
              this.emit();
              return;
            }
            if (msg.topic === topic && (msg.event === 'postgres_changes' || msg.event === 'UPDATE' || msg.event === 'INSERT')) {
              const ts = msg.payload?.data?.record?.updated_at;
              if (ts) lastSeenUpdatedAt = ts;
              onRemoteChange();
            }
            if (msg.topic === topic && (msg.event === 'phx_error' || msg.event === 'phx_close')) {
              this.realtimeConnected = false;
              this.emit();
            }
          } catch {
            // Ignore non-JSON frames
          }
        });

        const handleDisconnect = () => {
          if (this.ws === socket) {
            this.ws = null;
          }
          if (this.heartbeatTimer !== null) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
          }
          if (this.realtimeConnected) {
            this.realtimeConnected = false;
            this.emit();
          }
          if (!disposed && this.isOnline) {
            this.reconnectTimer = setTimeout(() => {
              this.reconnectTimer = null;
              connectRealtimeWs();
            }, 10_000);
          }
        };

        socket.addEventListener('close', handleDisconnect);
        socket.addEventListener('error', handleDisconnect);
      } catch {
        this.realtimeConnected = false;
        this.emit();
      }
    };

    const pollFallback = async () => {
      // Strictly fallback: skip REST polling while WebSocket Realtime is actively SUBSCRIBED
      if (disposed || this.realtimeConnected || !this.isOnline || !this.baseUrl || !this.anonKey) {
        return;
      }
      try {
        const bearer = this.accessToken?.trim() || this.anonKey;
        const res = await this.fetchImpl(
          `${this.baseUrl}/rest/v1/property_snapshots?property_id=eq.${encodeURIComponent(
            propertyId
          )}&select=updated_at&limit=1`,
          {
            headers: {
              apikey: this.anonKey,
              Authorization: `Bearer ${bearer}`,
              Accept: 'application/json',
            },
          }
        );
        if (!res.ok) return;
        const rows = (await res.json()) as Array<{ updated_at?: string }>;
        const ts = rows[0]?.updated_at;
        if (ts && lastSeenUpdatedAt && ts !== lastSeenUpdatedAt) {
          onRemoteChange();
        }
        if (ts) lastSeenUpdatedAt = ts;
      } catch {
        // Ignore transient offline polls
      }
    };

    connectRealtimeWs();
    this.pollTimer = setInterval(() => {
      void pollFallback();
    }, 15_000);

    return () => {
      disposed = true;
      clearSocketTimers();
      if (this.ws) {
        try {
          this.ws.close();
        } catch {
          // ignore close error
        }
        this.ws = null;
      }
      if (this.pollTimer !== null) {
        clearInterval(this.pollTimer);
        this.pollTimer = null;
      }
      this.realtimeConnected = false;
      this.emit();
    };
  }

  destroy(): void {
    if (typeof window !== 'undefined') {
      if (this.onlineHandler) window.removeEventListener('online', this.onlineHandler);
      if (this.offlineHandler) window.removeEventListener('offline', this.offlineHandler);
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}

let sharedNormalizedSync: SupabaseNormalizedSync | null = null;

export function getNormalizedSupabaseSync(): SupabaseNormalizedSync {
  if (!sharedNormalizedSync) {
    const env =
      typeof import.meta !== 'undefined' && import.meta.env
        ? (import.meta.env as Record<string, string | undefined>)
        : {};
    sharedNormalizedSync = new SupabaseNormalizedSync(
      env.VITE_SUPABASE_URL,
      env.VITE_SUPABASE_ANON_KEY
    );
  }
  return sharedNormalizedSync;
}
