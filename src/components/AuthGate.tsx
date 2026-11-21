import React, { useEffect, useState } from 'react';
import { Loader2, Lock, LogIn } from 'lucide-react';
import { TopchanMark } from './ui';
import { getStorageAdapter } from '../services/storageAdapter';
import { getNormalizedSupabaseSync } from '../services/supabaseNormalizedAdapter';
import { useUI } from '../context/UIContext';
import type { AppUserRole } from '../types/ops';

const SESSION_STORAGE_KEY = 'topchan_supabase_session_v1';

interface StoredSession {
  accessToken: string;
  email: string;
  role: AppUserRole;
}

function getSupabaseAuthConfig(): { url: string; anonKey: string } | null {
  const env =
    typeof import.meta !== 'undefined' && import.meta.env
      ? (import.meta.env as Record<string, string | undefined>)
      : {};
  const url = env.VITE_SUPABASE_URL?.trim();
  const anonKey = env.VITE_SUPABASE_ANON_KEY?.trim();
  if (url && anonKey && url.startsWith('https://')) {
    return { url: url.replace(/\/+$/, ''), anonKey };
  }
  return null;
}

function readStoredSession(): StoredSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredSession>;
    if (parsed.accessToken && parsed.email) {
      return {
        accessToken: parsed.accessToken,
        email: parsed.email,
        role:
          parsed.role === 'manager' || parsed.role === 'housekeeping'
            ? parsed.role
            : 'admin',
      };
    }
  } catch {
    // ignore
  }
  return null;
}

export const AuthGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const supabaseConfig = getSupabaseAuthConfig();
  const { setUserRole } = useUI();
  const [session, setSession] = useState<StoredSession | null>(() => readStoredSession());
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [selectedRole, setSelectedRole] = useState<AppUserRole>('admin');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    getStorageAdapter().setAccessToken?.(session.accessToken);
    getNormalizedSupabaseSync().setAccessToken(session.accessToken);
    setUserRole(session.role);
  }, [session, setUserRole]);

  // Demo Mode: non-blocking instant entry when Supabase env vars are not configured
  if (!supabaseConfig || session) {
    return <>{children}</>;
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`${supabaseConfig.url}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: {
          apikey: supabaseConfig.anonKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: email.trim(),
          password,
        }),
      });
      const data = (await res.json()) as {
        access_token?: string;
        user?: { email?: string; app_metadata?: { role?: string }; user_metadata?: { role?: string } };
        error_description?: string;
        msg?: string;
      };
      if (!res.ok || !data.access_token) {
        setError(data.error_description || data.msg || 'Неверный email или пароль сотрудника');
        return;
      }
      const metaRole = data.user?.app_metadata?.role || data.user?.user_metadata?.role;
      const resolvedRole: AppUserRole =
        metaRole === 'housekeeping' || metaRole === 'manager' || metaRole === 'admin'
          ? metaRole
          : selectedRole;
      const nextSession: StoredSession = {
        accessToken: data.access_token,
        email: data.user?.email || email.trim(),
        role: resolvedRole,
      };
      try {
        window.sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(nextSession));
      } catch {
        // ignore storage restrictions
      }
      setSession(nextSession);
    } catch {
      setError('Нет связи с сервером авторизации Supabase');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--bg-canvas)] text-[var(--text-primary)] flex items-center justify-center p-4">
      <div
        className="w-full max-w-md rounded-2xl border border-[var(--border-strong)] bg-[var(--bg-surface)] p-6 space-y-5"
        style={{ boxShadow: 'var(--shadow-popover)' }}
      >
        <div className="flex items-center gap-3">
          <TopchanMark size={36} />
          <div>
            <h1 className="text-lg font-bold tracking-tight text-[var(--text-primary)]">
              Topchan Ops
            </h1>
            <p className="text-xs text-[var(--text-muted)]">
              Вход в систему управления сменой · Ташкент
            </p>
          </div>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
              Рабочий Email
            </label>
            <input
              type="email"
              required
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="reception@topchanhostel.uz"
              className="ops-input w-full px-3 py-2.5 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
              Пароль
            </label>
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="ops-input w-full px-3 py-2.5 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
              Режим рабочего места
            </label>
            <select
              value={selectedRole}
              onChange={(e) => setSelectedRole(e.target.value as AppUserRole)}
              className="ops-input w-full px-3 py-2.5 text-sm"
            >
              <option value="admin">Администратор (полный доступ)</option>
              <option value="manager">Управляющий / Менеджер</option>
              <option value="housekeeping">Горничная (мобильная доска уборки)</option>
            </select>
          </div>

          {error && (
            <div
              className="p-3 rounded-xl border text-xs flex items-center gap-2"
              style={{
                backgroundColor: 'var(--tone-rose-bg)',
                borderColor: 'var(--tone-rose-border)',
                color: 'var(--tone-rose-fg)',
              }}
            >
              <Lock className="w-4 h-4 shrink-0" strokeWidth={1.75} />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="ops-brand-btn w-full py-2.5 rounded-xl text-sm font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" strokeWidth={2} />
            ) : (
              <LogIn className="w-4 h-4" strokeWidth={2} />
            )}
            Войти в Topchan Ops
          </button>
        </form>
      </div>
    </div>
  );
};
