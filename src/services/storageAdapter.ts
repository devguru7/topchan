import type { AppState } from '../types/ops';
import { createSeedState, SCHEMA_VERSION, STORAGE_KEY } from '../data/seed';
import { getTashkentTodayIso } from '../utils/time';

export type StorageAdapterKind = 'local' | 'supabase';
export type SyncStatus = 'local' | 'synced' | 'syncing' | 'error' | 'conflict';

export interface SyncStatusInfo {
  status: SyncStatus;
  lastSyncedAt?: string;
  errorMessage?: string;
  pendingRetries?: number;
}

export interface StorageAdapter {
  readonly kind: StorageAdapterKind;
  loadState(): AppState;
  loadStateAsync(): Promise<AppState>;
  saveState(state: AppState): void;
  subscribe(listener: (next: AppState) => void): () => void;
  subscribeSyncStatus?(listener: (info: SyncStatusInfo) => void): () => void;
  subscribeConflict?(listener: (latestRemote: AppState) => void): () => void;
  setAccessToken?(token: string | null): void;
  getSyncStatus(): SyncStatusInfo;
  clear(): void;
}

function isValidState(parsed: unknown): parsed is AppState {
  if (!parsed || typeof parsed !== 'object') return false;
  const s = parsed as Partial<AppState>;
  return (
    s.schemaVersion === SCHEMA_VERSION &&
    Array.isArray(s.physicalRooms) &&
    Array.isArray(s.pockets) &&
    Array.isArray(s.bookings)
  );
}

/**
 * Backward-compatible state migration & hydration helper.
 * Safely backfills any fields introduced in later releases (luggageItems, lostFoundItems,
 * shiftHistory, mailInbox, operationalDate, safeBalances, guestProfiles) without breaking
 * existing localStorage or Supabase snapshots.
 */
export function migrateAppState(raw: unknown): AppState | null {
  if (!isValidState(raw)) return null;
  const state = raw;
  const revision =
    typeof state.revision === 'number' && Number.isFinite(state.revision) && state.revision >= 1
      ? Math.floor(state.revision)
      : 1;
  const adminRole = state.adminRole ?? 'senior_admin';
  const pockets = state.pockets.map((p) => {
    if (p.id !== 'safe') return p;
    if (p.safeBalances) return p;
    return {
      ...p,
      safeBalances: {
        UZS: 0,
        USD: Number.isFinite(p.balance) ? p.balance : 0,
        EUR: 0,
      },
    };
  });
  return {
    ...state,
    revision,
    adminRole,
    operationalDate:
      typeof state.operationalDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(state.operationalDate)
        ? state.operationalDate
        : getTashkentTodayIso(),
    luggageItems: Array.isArray(state.luggageItems) ? state.luggageItems : [],
    lostFoundItems: Array.isArray(state.lostFoundItems) ? state.lostFoundItems : [],
    shiftHistory: Array.isArray(state.shiftHistory) ? state.shiftHistory : [],
    mailInbox: Array.isArray(state.mailInbox) ? state.mailInbox : [],
    guestProfiles: Array.isArray(state.guestProfiles) ? state.guestProfiles : [],
    pockets,
  };
}

function normalizeLoadedState(state: AppState): AppState {
  return migrateAppState(state) ?? state;
}

/**
 * Default zero-latency browser localStorage adapter with cross-tab StorageEvent sync
 * (also synchronizes Guest QR standalone mode with the Admin console in another tab).
 */
export class LocalStorageAdapter implements StorageAdapter {
  readonly kind = 'local' as const;

  loadState(): AppState {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return createSeedState();
      const parsed: unknown = JSON.parse(raw);
      return isValidState(parsed) ? normalizeLoadedState(parsed) : createSeedState();
    } catch {
      return createSeedState();
    }
  }

  async loadStateAsync(): Promise<AppState> {
    return this.loadState();
  }

  saveState(state: AppState): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Ignore storage quota errors in restricted sandboxes
    }
  }

  subscribe(listener: (next: AppState) => void): () => void {
    if (typeof window === 'undefined') return () => {};
    const onStorage = (ev: StorageEvent) => {
      if (ev.key !== STORAGE_KEY || !ev.newValue) return;
      try {
        const parsed: unknown = JSON.parse(ev.newValue);
        if (isValidState(parsed)) {
          listener(normalizeLoadedState(parsed));
        }
      } catch {
        // Ignore malformed cross-tab payload
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }

  getSyncStatus(): SyncStatusInfo {
    return { status: 'local' };
  }

  clear(): void {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }
}

/**
 * Production Supabase REST adapter with:
 * - Optimistic concurrency control via `revision` column (prevents silent last-write-wins overwrites)
 * - Automatic exponential backoff retries on network/HTTP failures
 * - `beforeunload` / `visibilitychange` keepalive flush to prevent lost writes on tab close
 * - Optional authenticated user JWT (`accessToken`) for strict RLS compliance
 */
export class SupabaseStorageAdapter implements StorageAdapter {
  readonly kind = 'supabase' as const;
  private readonly local = new LocalStorageAdapter();
  private readonly baseUrl: string;
  private readonly anonKey: string;
  private accessToken: string | null = null;
  private syncTimer: number | null = null;
  private retryTimer: number | null = null;
  private retryCount = 0;
  private readonly maxRetries = 5;
  private pendingState: AppState | null = null;
  private inFlight = false;
  private lastKnownRevision = 1;
  private syncStatus: SyncStatusInfo = { status: 'synced' };
  private readonly statusListeners = new Set<(info: SyncStatusInfo) => void>();
  private readonly conflictListeners = new Set<(latest: AppState) => void>();
  private unloadBound = false;

  constructor(supabaseUrl: string, anonKey: string, accessToken?: string | null) {
    this.baseUrl = supabaseUrl.replace(/\/+$/, '');
    this.anonKey = anonKey;
    this.accessToken = accessToken ?? null;
    this.bindUnloadFlush();
  }

  private getAuthHeaders(): Record<string, string> {
    const bearer = this.accessToken?.trim() || this.anonKey;
    return {
      apikey: this.anonKey,
      Authorization: `Bearer ${bearer}`,
    };
  }

  private emitStatus(next: SyncStatusInfo): void {
    this.syncStatus = next;
    for (const listener of this.statusListeners) {
      listener(next);
    }
  }

  private emitConflict(remoteState: AppState): void {
    for (const listener of this.conflictListeners) {
      listener(remoteState);
    }
  }

  private bindUnloadFlush(): void {
    if (this.unloadBound || typeof window === 'undefined') return;
    this.unloadBound = true;

    const flushKeepalive = () => {
      if (!this.pendingState) return;
      const state = this.pendingState;
      const expectedRevision = this.lastKnownRevision;
      const nextRevision = expectedRevision + 1;
      const url = `${this.baseUrl}/rest/v1/property_snapshots?property_id=eq.${encodeURIComponent(
        state.propertyId
      )}&revision=eq.${expectedRevision}`;
      try {
        fetch(url, {
          method: 'PATCH',
          keepalive: true,
          headers: {
            ...this.getAuthHeaders(),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            schema_version: state.schemaVersion,
            revision: nextRevision,
            payload: { ...state, revision: nextRevision },
            updated_at: new Date().toISOString(),
          }),
        }).catch(() => {});
      } catch {
        // Best-effort unload flush; localStorage still retains latest state
      }
    };

    window.addEventListener('beforeunload', flushKeepalive);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
          flushKeepalive();
        }
      });
    }
  }

  setAccessToken(token: string | null): void {
    this.accessToken = token;
  }

  getSyncStatus(): SyncStatusInfo {
    return this.syncStatus;
  }

  subscribeSyncStatus(listener: (info: SyncStatusInfo) => void): () => void {
    this.statusListeners.add(listener);
    listener(this.syncStatus);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  subscribeConflict(listener: (latestRemote: AppState) => void): () => void {
    this.conflictListeners.add(listener);
    return () => {
      this.conflictListeners.delete(listener);
    };
  }

  loadState(): AppState {
    const loaded = this.local.loadState();
    this.lastKnownRevision = loaded.revision ?? 1;
    return loaded;
  }

  async loadStateAsync(): Promise<AppState> {
    const localSnapshot = this.local.loadState();
    try {
      const res = await fetch(
        `${this.baseUrl}/rest/v1/property_snapshots?property_id=eq.${encodeURIComponent(
          localSnapshot.propertyId
        )}&select=payload,revision&limit=1`,
        {
          headers: {
            ...this.getAuthHeaders(),
            Accept: 'application/json',
          },
        }
      );
      if (!res.ok) {
        this.emitStatus({
          status: 'error',
          errorMessage: `HTTP ${res.status} при загрузке снимка`,
        });
        return localSnapshot;
      }
      const rows = (await res.json()) as Array<{ payload?: unknown; revision?: number }>;
      const row = rows[0];
      const remote = row?.payload;
      if (isValidState(remote)) {
        const rev =
          typeof row.revision === 'number' && Number.isFinite(row.revision)
            ? row.revision
            : (remote.revision ?? 1);
        const normalized: AppState = {
          ...normalizeLoadedState(remote),
          revision: rev,
        };
        this.lastKnownRevision = rev;
        this.local.saveState(normalized);
        this.emitStatus({ status: 'synced', lastSyncedAt: new Date().toISOString() });
        return normalized;
      }
      this.emitStatus({ status: 'synced', lastSyncedAt: new Date().toISOString() });
      return localSnapshot;
    } catch {
      this.emitStatus({
        status: 'error',
        errorMessage: 'Нет связи с сервером — работаем офлайн',
      });
      return localSnapshot;
    }
  }

  saveState(state: AppState): void {
    // Always persist locally first for instant offline-first durability
    this.local.saveState(state);
    this.pendingState = state;
    if (typeof window === 'undefined') return;
    if (this.syncTimer !== null) {
      window.clearTimeout(this.syncTimer);
    }
    this.syncTimer = window.setTimeout(() => {
      this.syncTimer = null;
      this.flushToRemote().catch(() => {
        // Error state & retry handled inside flushToRemote
      });
    }, 600);
  }

  private scheduleRetry(): void {
    if (typeof window === 'undefined') return;
    if (this.retryCount >= this.maxRetries) {
      this.emitStatus({
        status: 'error',
        errorMessage: 'Синхронизация не удалась после 5 попыток (данные сохранены локально)',
        pendingRetries: this.retryCount,
      });
      return;
    }
    this.retryCount += 1;
    const delayMs = Math.min(16_000, 1000 * 2 ** (this.retryCount - 1));
    this.emitStatus({
      status: 'error',
      errorMessage: `Повторная синхронизация #${this.retryCount} через ${Math.round(delayMs / 1000)}с`,
      pendingRetries: this.retryCount,
    });
    if (this.retryTimer !== null) {
      window.clearTimeout(this.retryTimer);
    }
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = null;
      this.flushToRemote().catch(() => {});
    }, delayMs);
  }

  private async flushToRemote(): Promise<void> {
    if (this.inFlight) return;
    const state = this.pendingState;
    if (!state) return;

    this.inFlight = true;
    this.emitStatus({ status: 'syncing' });

    const expectedRevision = this.lastKnownRevision;
    const nextRevision = expectedRevision + 1;
    const payloadToWrite: AppState = { ...state, revision: nextRevision };

    try {
      // Optimistic concurrency PATCH: succeeds only if DB revision matches expectedRevision
      const patchRes = await fetch(
        `${this.baseUrl}/rest/v1/property_snapshots?property_id=eq.${encodeURIComponent(
          state.propertyId
        )}&revision=eq.${expectedRevision}`,
        {
          method: 'PATCH',
          headers: {
            ...this.getAuthHeaders(),
            'Content-Type': 'application/json',
            Prefer: 'return=representation',
          },
          body: JSON.stringify({
            schema_version: state.schemaVersion,
            revision: nextRevision,
            payload: payloadToWrite,
            updated_at: new Date().toISOString(),
          }),
        }
      );

      if (!patchRes.ok) {
        this.inFlight = false;
        this.scheduleRetry();
        return;
      }

      const updatedRows = (await patchRes.json()) as Array<{ revision?: number }>;

      if (Array.isArray(updatedRows) && updatedRows.length > 0) {
        // Optimistic lock succeeded
        this.lastKnownRevision = updatedRows[0]?.revision ?? nextRevision;
        this.retryCount = 0;
        if (this.pendingState === state) {
          this.pendingState = null;
        }
        this.emitStatus({ status: 'synced', lastSyncedAt: new Date().toISOString() });
        this.inFlight = false;
        // If another mutation arrived while in flight, flush it next
        if (this.pendingState) {
          void this.flushToRemote();
        }
        return;
      }

      // 0 rows matched: either initial row doesn't exist yet OR another device advanced revision
      const checkRes = await fetch(
        `${this.baseUrl}/rest/v1/property_snapshots?property_id=eq.${encodeURIComponent(
          state.propertyId
        )}&select=payload,revision&limit=1`,
        {
          headers: {
            ...this.getAuthHeaders(),
            Accept: 'application/json',
          },
        }
      );

      if (!checkRes.ok) {
        this.inFlight = false;
        this.scheduleRetry();
        return;
      }

      const existingRows = (await checkRes.json()) as Array<{ payload?: unknown; revision?: number }>;

      if (existingRows.length === 0) {
        // First snapshot insert for this property
        const insertRes = await fetch(`${this.baseUrl}/rest/v1/property_snapshots`, {
          method: 'POST',
          headers: {
            ...this.getAuthHeaders(),
            'Content-Type': 'application/json',
            Prefer: 'return=representation',
          },
          body: JSON.stringify({
            property_id: state.propertyId,
            schema_version: state.schemaVersion,
            revision: 1,
            payload: { ...state, revision: 1 },
            updated_at: new Date().toISOString(),
          }),
        });
        if (!insertRes.ok) {
          this.inFlight = false;
          this.scheduleRetry();
          return;
        }
        this.lastKnownRevision = 1;
        this.retryCount = 0;
        if (this.pendingState === state) {
          this.pendingState = null;
        }
        this.emitStatus({ status: 'synced', lastSyncedAt: new Date().toISOString() });
        this.inFlight = false;
        return;
      }

      // Conflict detected: another shift terminal saved a newer revision
      const latestRow = existingRows[0];
      const latestRev =
        typeof latestRow.revision === 'number' && Number.isFinite(latestRow.revision)
          ? latestRow.revision
          : expectedRevision + 1;
      this.lastKnownRevision = latestRev;
      this.pendingState = null;
      this.retryCount = 0;

      if (isValidState(latestRow.payload)) {
        const mergedRemote: AppState = {
          ...normalizeLoadedState(latestRow.payload),
          revision: latestRev,
        };
        this.local.saveState(mergedRemote);
        this.emitStatus({
          status: 'conflict',
          errorMessage: `Обнаружен конфликт версий (rev ${latestRev}) — загружены актуальные данные`,
        });
        this.emitConflict(mergedRemote);
      } else {
        this.emitStatus({
          status: 'conflict',
          errorMessage: 'Конфликт синхронизации с другим устройством',
        });
      }
      this.inFlight = false;
    } catch {
      this.inFlight = false;
      this.scheduleRetry();
    }
  }

  subscribe(listener: (next: AppState) => void): () => void {
    return this.local.subscribe(listener);
  }

  clear(): void {
    this.pendingState = null;
    this.local.clear();
  }
}

export function createStorageAdapter(): StorageAdapter {
  const env =
    typeof import.meta !== 'undefined' && import.meta.env
      ? (import.meta.env as Record<string, string | undefined>)
      : {};
  const url = env.VITE_SUPABASE_URL?.trim();
  const key = env.VITE_SUPABASE_ANON_KEY?.trim();
  const userJwt = env.VITE_SUPABASE_ACCESS_TOKEN?.trim() || null;

  if (url && key && url.startsWith('https://')) {
    return new SupabaseStorageAdapter(url, key, userJwt);
  }
  return new LocalStorageAdapter();
}

let sharedAdapter: StorageAdapter | null = null;

export function getStorageAdapter(): StorageAdapter {
  if (!sharedAdapter) {
    sharedAdapter = createStorageAdapter();
  }
  return sharedAdapter;
}
