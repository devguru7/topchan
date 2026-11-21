import type { AppState } from '../types/ops';
import { createSeedState, SCHEMA_VERSION, STORAGE_KEY } from '../data/seed';

export type StorageAdapterKind = 'local' | 'supabase';

export interface StorageAdapter {
  readonly kind: StorageAdapterKind;
  loadState(): AppState;
  loadStateAsync(): Promise<AppState>;
  saveState(state: AppState): void;
  subscribe(listener: (next: AppState) => void): () => void;
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
      return isValidState(parsed) ? parsed : createSeedState();
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
          listener(parsed);
        }
      } catch {
        // Ignore malformed cross-tab payload
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
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
 * Production Supabase REST adapter with automatic local offline queue fallback.
 * Activates automatically when VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are configured.
 */
export class SupabaseStorageAdapter implements StorageAdapter {
  readonly kind = 'supabase' as const;
  private readonly local = new LocalStorageAdapter();
  private readonly baseUrl: string;
  private readonly anonKey: string;
  private syncTimer: number | null = null;
  private pendingState: AppState | null = null;

  constructor(supabaseUrl: string, anonKey: string) {
    this.baseUrl = supabaseUrl.replace(/\/+$/, '');
    this.anonKey = anonKey;
  }

  loadState(): AppState {
    return this.local.loadState();
  }

  async loadStateAsync(): Promise<AppState> {
    const localSnapshot = this.local.loadState();
    try {
      const res = await fetch(
        `${this.baseUrl}/rest/v1/property_snapshots?property_id=eq.${encodeURIComponent(localSnapshot.propertyId)}&select=payload&limit=1`,
        {
          headers: {
            apikey: this.anonKey,
            Authorization: `Bearer ${this.anonKey}`,
            Accept: 'application/json',
          },
        }
      );
      if (!res.ok) return localSnapshot;
      const rows = (await res.json()) as Array<{ payload?: unknown }>;
      const remote = rows[0]?.payload;
      if (isValidState(remote)) {
        this.local.saveState(remote);
        return remote;
      }
      return localSnapshot;
    } catch {
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
      this.flushToRemote().catch(() => {
        // Offline queue stays intact in localStorage until next mutation
      });
    }, 600);
  }

  private async flushToRemote(): Promise<void> {
    const state = this.pendingState;
    if (!state) return;
    await fetch(`${this.baseUrl}/rest/v1/property_snapshots?on_conflict=property_id`, {
      method: 'POST',
      headers: {
        apikey: this.anonKey,
        Authorization: `Bearer ${this.anonKey}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify({
        property_id: state.propertyId,
        schema_version: state.schemaVersion,
        payload: state,
        updated_at: new Date().toISOString(),
      }),
    });
  }

  subscribe(listener: (next: AppState) => void): () => void {
    return this.local.subscribe(listener);
  }

  clear(): void {
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

  if (url && key && url.startsWith('https://')) {
    return new SupabaseStorageAdapter(url, key);
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

