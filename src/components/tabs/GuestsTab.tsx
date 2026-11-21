import React, { useMemo, useState } from 'react';
import {
  Ban,
  Crown,
  Repeat,
  Search,
  UserCheck,
  UserPlus,
} from 'lucide-react';
import { useOps } from '../../context/OpsContext';
import type { GuestProfile } from '../../types/ops';
import { getTashkentTodayIso } from '../../utils/time';
import { StatusPill } from '../ui';

interface MergedGuestRow {
  key: string;
  id: string;
  fullName: string;
  passportNo: string;
  citizenship: string;
  phone: string;
  visitsCount: number;
  lastVisitDate: string;
  tag: GuestProfile['tag'];
  notes: string;
  activeBookingId?: string;
}

export const GuestsTab: React.FC = () => {
  const {
    state,
    upsertGuestProfile,
    openCheckInModal,
    openBookingFolio,
  } = useOps();

  const [query, setQuery] = useState('');
  const [tagFilter, setTagFilter] = useState<'all' | 'vip' | 'regular' | 'blacklist' | 'loop'>('all');
  const [editingGuest, setEditingGuest] = useState<MergedGuestRow | null>(null);
  const [editTag, setEditTag] = useState<GuestProfile['tag']>('regular');
  const [editPhone, setEditPhone] = useState('');
  const [editNotes, setEditNotes] = useState('');

  const mergedGuests = useMemo<MergedGuestRow[]>(() => {
    const map = new Map<string, MergedGuestRow>();

    for (const p of state.guestProfiles) {
      const k = (p.passportNo || p.fullName).toUpperCase();
      map.set(k, {
        key: k,
        id: p.id,
        fullName: p.fullName,
        passportNo: p.passportNo,
        citizenship: p.citizenship,
        phone: p.phone ?? '',
        visitsCount: p.visitsCount,
        lastVisitDate: p.lastVisitDate,
        tag: p.tag,
        notes: p.notes,
      });
    }

    const fallbackDate = state.operationalDate ?? getTashkentTodayIso();
    // Merge guests from bookings so every guest ever checked in appears in CRM
    for (const b of state.bookings) {
      if (b.status === 'cancelled') continue;
      const lastSeg = b.segments[b.segments.length - 1];
      const visitDate = lastSeg?.fromDate ?? fallbackDate;
      for (const g of b.guests) {
        const k = (g.passportNo || g.fullName).toUpperCase();
        const existing = map.get(k);
        if (existing) {
          existing.visitsCount = Math.max(existing.visitsCount, 1);
          if (visitDate > existing.lastVisitDate) existing.lastVisitDate = visitDate;
          if (b.status === 'active') existing.activeBookingId = b.id;
        } else {
          map.set(k, {
            key: k,
            id: g.id,
            fullName: g.fullName,
            passportNo: g.passportNo,
            citizenship: g.citizenship,
            phone: '',
            visitsCount: 1,
            lastVisitDate: visitDate,
            tag: 'regular',
            notes: '',
            activeBookingId: b.status === 'active' ? b.id : undefined,
          });
        }
      }
    }

    return Array.from(map.values()).sort((a, b) => {
      if (b.visitsCount !== a.visitsCount) return b.visitsCount - a.visitsCount;
      return b.lastVisitDate.localeCompare(a.lastVisitDate);
    });
  }, [state.guestProfiles, state.bookings, state.operationalDate]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return mergedGuests.filter((g) => {
      if (tagFilter === 'loop' && g.visitsCount < 2) return false;
      if (tagFilter !== 'all' && tagFilter !== 'loop' && g.tag !== tagFilter) return false;
      if (!q) return true;
      return (
        g.fullName.toLowerCase().includes(q) ||
        g.passportNo.toLowerCase().includes(q) ||
        g.citizenship.toLowerCase().includes(q) ||
        g.notes.toLowerCase().includes(q)
      );
    });
  }, [mergedGuests, query, tagFilter]);

  const vipCount = mergedGuests.filter((g) => g.tag === 'vip').length;
  const loopCount = mergedGuests.filter((g) => g.visitsCount >= 2).length;
  const blacklistCount = mergedGuests.filter((g) => g.tag === 'blacklist').length;

  const openEditor = (row: MergedGuestRow) => {
    setEditingGuest(row);
    setEditTag(row.tag);
    setEditPhone(row.phone);
    setEditNotes(row.notes);
  };

  const handleSaveProfile = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingGuest) return;
    upsertGuestProfile({
      fullName: editingGuest.fullName,
      passportNo: editingGuest.passportNo,
      citizenship: editingGuest.citizenship,
      phone: editPhone.trim() || undefined,
      tag: editTag,
      notes: editNotes.trim(),
    });
    setEditingGuest(null);
  };

  return (
    <div className="space-y-4">
      {/* Header & KPI Strip */}
      <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-[var(--text-primary)]">
              База гостей и CRM («Узбекская петля»)
            </h2>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              История визитов, возвраты после Самарканда / Бухары / Хивы, VIP-метки и стоп-лист
            </p>
          </div>
          <button
            type="button"
            onClick={() => openCheckInModal({})}
            className="ops-brand-btn px-3.5 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5"
          >
            <UserPlus className="w-3.5 h-3.5" strokeWidth={1.75} />
            Новое заселение
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3">
            <div className="text-[var(--text-muted)]">Всего гостей в базе</div>
            <div className="font-mono text-lg font-bold tabular-nums text-[var(--text-primary)] mt-0.5">
              {mergedGuests.length}
            </div>
          </div>
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3">
            <div className="text-[var(--text-muted)]">Узбекская петля (2+ визита)</div>
            <div className="font-mono text-lg font-bold tabular-nums mt-0.5" style={{ color: 'var(--brand-primary)' }}>
              {loopCount}
            </div>
          </div>
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3">
            <div className="text-[var(--text-muted)]">VIP-гости</div>
            <div className="font-mono text-lg font-bold tabular-nums mt-0.5" style={{ color: 'var(--tone-emerald-fg)' }}>
              {vipCount}
            </div>
          </div>
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3">
            <div className="text-[var(--text-muted)]">Стоп-лист (Blacklist)</div>
            <div className="font-mono text-lg font-bold tabular-nums mt-0.5" style={{ color: 'var(--tone-rose-fg)' }}>
              {blacklistCount}
            </div>
          </div>
        </div>

        {/* Search & Filter */}
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative flex-1 min-w-[220px]">
            <Search
              className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
              strokeWidth={1.75}
            />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Поиск по ФИО, паспорту, гражданству или заметке..."
              className="ops-input w-full pl-9 pr-3 py-2 text-xs"
            />
          </div>
          <div className="inline-flex rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-0.5 text-xs">
            {(
              [
                ['all', 'Все'],
                ['loop', 'Петля 2+'],
                ['vip', 'VIP'],
                ['regular', 'Обычные'],
                ['blacklist', 'Стоп-лист'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setTagFilter(id)}
                className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
                  tagFilter === id
                    ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] font-semibold'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Inline Editor Drawer Card */}
      {editingGuest && (
        <form
          onSubmit={handleSaveProfile}
          className="rounded-2xl border border-[var(--brand-primary-border)] bg-[var(--bg-surface)] p-4 space-y-3"
          style={{ boxShadow: 'var(--shadow-card)' }}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-semibold text-[var(--text-primary)]">
              Редактировать профиль: {editingGuest.fullName}{' '}
              <span className="font-mono text-xs text-[var(--text-muted)]">
                ({editingGuest.passportNo})
              </span>
            </div>
            <button
              type="button"
              onClick={() => setEditingGuest(null)}
              className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            >
              Отмена
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">Статус CRM</label>
              <select
                value={editTag}
                onChange={(e) => setEditTag(e.target.value as GuestProfile['tag'])}
                className="ops-input w-full px-3 py-2 text-xs"
              >
                <option value="regular">Обычный гость</option>
                <option value="vip">VIP / постоянный гость</option>
                <option value="blacklist">Стоп-лист (Blacklist)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">Телефон / WhatsApp</label>
              <input
                type="text"
                value={editPhone}
                onChange={(e) => setEditPhone(e.target.value)}
                placeholder="+998 / +49..."
                className="ops-input w-full px-3 py-2 font-mono text-xs"
              />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">Заметка для смены</label>
              <input
                type="text"
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                placeholder="Любит нижнюю койку, ранний кофе..."
                className="ops-input w-full px-3 py-2 text-xs"
              />
            </div>
          </div>
          <div className="flex justify-end">
            <button
              type="submit"
              className="ops-brand-btn px-4 py-2 rounded-xl text-xs font-semibold"
            >
              Сохранить карточку
            </button>
          </div>
        </form>
      )}

      {/* Guests Table */}
      <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-muted)]">
                <th className="py-3 px-4 font-medium">Гость</th>
                <th className="py-3 px-3 font-medium">Паспорт / Страна</th>
                <th className="py-3 px-3 font-medium">Визиты</th>
                <th className="py-3 px-3 font-medium">Статус</th>
                <th className="py-3 px-3 font-medium">Заметка</th>
                <th className="py-3 px-4 font-medium text-right">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)]">
              {filtered.map((g) => (
                <tr key={g.key} className="hover:bg-[var(--bg-hover)] transition-colors">
                  <td className="py-3 px-4">
                    <div className="font-semibold text-[var(--text-primary)]">{g.fullName}</div>
                    {g.phone && (
                      <div className="font-mono text-[11px] text-[var(--text-muted)]">{g.phone}</div>
                    )}
                  </td>
                  <td className="py-3 px-3 font-mono text-[var(--text-secondary)]">
                    {g.passportNo || '—'} · {g.citizenship}
                  </td>
                  <td className="py-3 px-3">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono font-semibold tabular-nums text-[var(--text-primary)]">
                        {g.visitsCount}×
                      </span>
                      {g.visitsCount >= 2 && (
                        <span
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold"
                          style={{
                            backgroundColor: 'var(--brand-primary-soft)',
                            color: 'var(--brand-primary)',
                          }}
                        >
                          <Repeat className="w-2.5 h-2.5" strokeWidth={2} />
                          Петля
                        </span>
                      )}
                    </div>
                    <div className="font-mono text-[10px] text-[var(--text-muted)]">
                      {g.lastVisitDate}
                    </div>
                  </td>
                  <td className="py-3 px-3">
                    {g.tag === 'vip' ? (
                      <StatusPill tone="emerald">
                        <Crown className="w-3 h-3 mr-1 inline" strokeWidth={2} />
                        VIP
                      </StatusPill>
                    ) : g.tag === 'blacklist' ? (
                      <StatusPill tone="rose">
                        <Ban className="w-3 h-3 mr-1 inline" strokeWidth={2} />
                        Стоп-лист
                      </StatusPill>
                    ) : (
                      <StatusPill tone="neutral">
                        <UserCheck className="w-3 h-3 mr-1 inline" strokeWidth={2} />
                        Обычный
                      </StatusPill>
                    )}
                  </td>
                  <td className="py-3 px-3 text-[var(--text-secondary)] max-w-[260px] truncate">
                    {g.notes || '—'}
                  </td>
                  <td className="py-3 px-4 text-right whitespace-nowrap space-x-1.5">
                    {g.activeBookingId ? (
                      <button
                        type="button"
                        onClick={() => openBookingFolio(g.activeBookingId!)}
                        className="px-2.5 py-1 rounded-lg border border-[var(--tone-emerald-border)] bg-[var(--tone-emerald-bg)] font-semibold"
                        style={{ color: 'var(--tone-emerald-fg)' }}
                      >
                        В хостеле · Фолио
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => openCheckInModal({})}
                        className="px-2.5 py-1 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] font-semibold text-[var(--text-primary)]"
                      >
                        Повторный заезд
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => openEditor(g)}
                      className="px-2.5 py-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)]"
                    >
                      Изменить
                    </button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-[var(--text-muted)]">
                    Гости по запросу «{query}» не найдены.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
