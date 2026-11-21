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
  operation: 'upsert' | 'insert';
  rows: Array<Record<string, unknown>>;
  createdAt: string;
}

export interface OfflineSyncStatus {
  isOnline: boolean;
  pendingCount: number;
  lastFlushedAt?: string;
  realtimeConnected: boolean;
}

const OFFLINE_QUEUE_KEY = 'topchan_offline_queue_v1';

function readQueue(): OfflineMutationItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(OFFLINE_QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as OfflineMutationItem[]) : [];
  } catch {
    return [];
  }
}

function writeQueue(items: OfflineMutationItem[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(items.slice(-150)));
  } catch {
    // Ignore storage quota issues in restricted environments
  }
}

/**
 * Maps current in-memory AppState into normalized relational table rows matching supabase/schema.sql.
 */
export function projectStateToNormalizedRows(state: AppState): Record<NormalizedTableName, Array<Record<string, unknown>>> {
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
 * Normalized Supabase table synchronizer + persistent Offline Mutation Queue + Realtime poller.
 * Gracefully degrades to local offline-first queue when Supabase env vars are not configured.
 */
export class SupabaseNormalizedSync {
  private readonly baseUrl: string | null;
  private readonly anonKey: string | null;
  private accessToken: string | null = null;
  private queue: OfflineMutationItem[] = readQueue();
  private isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
  private lastFlushedAt?: string;
  private realtimeConnected = false;
  private flushing = false;
  private readonly listeners = new Set<(status: OfflineSyncStatus) => void>();
  private pollTimer: number | null = null;
  private onlineHandler: (() => void) | null = null;
  private offlineHandler: (() => void) | null = null;

  constructor(supabaseUrl?: string, anonKey?: string) {
    const cleanUrl = supabaseUrl?.trim();
    const cleanKey = anonKey?.trim();
    this.baseUrl = cleanUrl && cleanUrl.startsWith('https://') ? cleanUrl.replace(/\/+$/, '') : null;
    this.anonKey = cleanKey || null;
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

  getStatus(): OfflineSyncStatus {
    return {
      isOnline: this.isOnline,
      pendingCount: this.queue.length,
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
   */
  enqueueNormalizedSync(state: AppState, tables: NormalizedTableName[] = ['booking_groups', 'stay_segments', 'housekeeping_tasks']): void {
    if (!this.isConfigured) return;
    const projected = projectStateToNormalizedRows(state);
    const now = new Date().toISOString();

    for (const table of tables) {
      const rows = projected[table];
      if (!rows || rows.length === 0) continue;
      // Deduplicate pending upsert for the same table to avoid queue bloat
      this.queue = this.queue.filter((item) => item.table !== table);
      this.queue.push({
        id: `oq-${table}-${Date.now()}`,
        table,
        operation: table === 'audit_log' ? 'insert' : 'upsert',
        rows,
        createdAt: now,
      });
    }

    writeQueue(this.queue);
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
      for (const item of this.queue) {
        const ok = await this.postNormalizedTable(item);
        if (ok) {
          flushedCount += 1;
        } else {
          remaining.push(item);
        }
      }
      this.queue = remaining;
      writeQueue(this.queue);
      if (flushedCount > 0) {
        this.lastFlushedAt = new Date().toISOString();
      }
    } finally {
      this.flushing = false;
      this.emit();
    }

    return flushedCount;
  }

  private async postNormalizedTable(item: OfflineMutationItem): Promise<boolean> {
    if (!this.baseUrl || !this.anonKey) return false;
    const bearer = this.accessToken?.trim() || this.anonKey;
    const preferHeader =
      item.operation === 'upsert'
        ? 'resolution=merge-duplicates,return=minimal'
        : 'resolution=ignore-duplicates,return=minimal';

    try {
      const res = await fetch(`${this.baseUrl}/rest/v1/${item.table}`, {
        method: 'POST',
        headers: {
          apikey: this.anonKey,
          Authorization: `Bearer ${bearer}`,
          'Content-Type': 'application/json',
          Prefer: preferHeader,
        },
        body: JSON.stringify(item.rows),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Starts lightweight Realtime presence/polling channel `topchan-ops-live` when Supabase is configured.
   */
  startRealtimeChannel(propertyId: string, onRemoteChange: () => void): () => void {
    if (!this.isConfigured || typeof window === 'undefined') {
      return () => {};
    }
    let lastSeenUpdatedAt: string | null = null;
    this.realtimeConnected = true;
    this.emit();

    const poll = async () => {
      if (!this.isOnline || !this.baseUrl || !this.anonKey) return;
      try {
        const bearer = this.accessToken?.trim() || this.anonKey;
        const res = await fetch(
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

    this.pollTimer = window.setInterval(() => {
      void poll();
    }, 15_000);

    return () => {
      if (this.pollTimer !== null) {
        window.clearInterval(this.pollTimer);
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
    if (this.pollTimer !== null) {
      window.clearInterval(this.pollTimer);
      this.pollTimer = null;
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
