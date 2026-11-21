import React, { useState } from 'react';
import {
  Briefcase,
  CheckCircle2,
  PackageSearch,
  Plus,
} from 'lucide-react';
import { useOps } from '../context/OpsContext';
import { StatusPill } from './ui';

export const LuggageTracker: React.FC = () => {
  const {
    state,
    addLuggageItem,
    releaseLuggageItem,
    addLostFoundItem,
    resolveLostFoundItem,
  } = useOps();

  const [section, setSection] = useState<'luggage' | 'lost_found'>('luggage');

  // Luggage form
  const [guestName, setGuestName] = useState('');
  const [bagsCount, setBagsCount] = useState(1);
  const [pickupTime, setPickupTime] = useState('18:00');
  const [luggageNotes, setLuggageNotes] = useState('');

  // Lost & Found form
  const [lfItem, setLfItem] = useState('');
  const [lfLocation, setLfLocation] = useState('');
  const [lfGuest, setLfGuest] = useState('');
  const [lfNotes, setLfNotes] = useState('');

  const storedLuggage = state.luggageItems.filter((l) => l.status === 'stored');
  const releasedLuggage = state.luggageItems.filter((l) => l.status === 'released').slice(0, 5);
  const lostFoundList = state.lostFoundItems ?? [];
  const openLostFound = lostFoundList.filter((i) => i.status === 'stored');
  const returnedLostFound = lostFoundList.filter((i) => i.status === 'returned').slice(0, 5);

  const handleAddLuggage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!guestName.trim()) return;
    addLuggageItem({
      guestName: guestName.trim(),
      bagsCount: Math.max(1, bagsCount),
      flightTime: pickupTime.trim() || '18:00',
      notes: luggageNotes.trim() || 'Ресепшн · камера хранения',
    });
    setGuestName('');
    setBagsCount(1);
    setPickupTime('18:00');
    setLuggageNotes('');
  };

  const handleAddLostFound = (e: React.FormEvent) => {
    e.preventDefault();
    if (!lfItem.trim() || !lfLocation.trim()) return;
    addLostFoundItem({
      itemName: lfItem.trim(),
      foundLocation: lfLocation.trim(),
      guestName: lfGuest.trim() || undefined,
      notes: lfNotes.trim() || 'Хранится в ящике ресепшн',
    });
    setLfItem('');
    setLfLocation('');
    setLfGuest('');
    setLfNotes('');
  };

  return (
    <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5 space-y-4">
      {/* Header + Segmented Switch */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">
            Камера хранения багажа и Бюро находок
          </h3>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            Ранние заезды с ночных рейсов (04:00), хранение после выезда 12:00 и учёт забытых вещей
          </p>
        </div>

        <div className="inline-flex rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-0.5 text-xs">
          <button
            type="button"
            onClick={() => setSection('luggage')}
            className={`px-3 py-1.5 rounded-lg font-semibold inline-flex items-center gap-1.5 transition-colors ${
              section === 'luggage'
                ? 'bg-[var(--bg-surface)] text-[var(--text-primary)]'
                : 'text-[var(--text-muted)]'
            }`}
          >
            <Briefcase className="w-3.5 h-3.5" strokeWidth={1.75} />
            Багаж ({storedLuggage.length})
          </button>
          <button
            type="button"
            onClick={() => setSection('lost_found')}
            className={`px-3 py-1.5 rounded-lg font-semibold inline-flex items-center gap-1.5 transition-colors ${
              section === 'lost_found'
                ? 'bg-[var(--bg-surface)] text-[var(--text-primary)]'
                : 'text-[var(--text-muted)]'
            }`}
          >
            <PackageSearch className="w-3.5 h-3.5" strokeWidth={1.75} />
            Находки ({openLostFound.length})
          </button>
        </div>
      </div>

      {section === 'luggage' ? (
        <div className="space-y-4">
          <form
            onSubmit={handleAddLuggage}
            className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 p-3.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]"
          >
            <input
              type="text"
              required
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
              placeholder="ФИО гостя"
              className="ops-input sm:col-span-4 px-3 py-2 text-xs"
            />
            <input
              type="number"
              min={1}
              max={15}
              value={bagsCount}
              onChange={(e) => setBagsCount(Math.max(1, parseInt(e.target.value, 10) || 1))}
              placeholder="Мест"
              className="ops-input sm:col-span-2 px-3 py-2 font-mono text-xs tabular-nums"
            />
            <input
              type="text"
              value={pickupTime}
              onChange={(e) => setPickupTime(e.target.value)}
              placeholder="Заберёт в (напр. 19:30)"
              className="ops-input sm:col-span-2 px-3 py-2 font-mono text-xs"
            />
            <input
              type="text"
              value={luggageNotes}
              onChange={(e) => setLuggageNotes(e.target.value)}
              placeholder="Заметка (рейс / полка)"
              className="ops-input sm:col-span-2 px-3 py-2 text-xs"
            />
            <button
              type="submit"
              className="ops-brand-btn sm:col-span-2 px-3 py-2 rounded-xl text-xs font-semibold inline-flex items-center justify-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" strokeWidth={2} />
              Принять
            </button>
          </form>

          {storedLuggage.length === 0 ? (
            <p className="text-xs text-[var(--text-muted)] text-center py-4">
              В камере хранения сейчас нет активных сумок.
            </p>
          ) : (
            <div className="space-y-2">
              {storedLuggage.map((item) => (
                <div
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span
                      className="px-2.5 py-1 rounded-lg font-mono text-xs font-bold border"
                      style={{
                        backgroundColor: 'var(--brand-primary-soft)',
                        borderColor: 'var(--brand-primary-border)',
                        color: 'var(--brand-primary)',
                      }}
                    >
                      {item.tagCode}
                    </span>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-[var(--text-primary)] truncate">
                        {item.guestName}{' '}
                        <span className="font-mono text-xs text-[var(--text-muted)]">
                          · {item.bagsCount} шт.
                        </span>
                      </div>
                      <div className="text-xs text-[var(--text-muted)]">
                        Принят: {item.createdAt.slice(11, 16) || 'сегодня'} · Вылет / выдача:{' '}
                        <span className="font-mono">{item.flightTime}</span> · {item.notes}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => releaseLuggageItem(item.id)}
                    className="px-3 py-1.5 rounded-lg border border-[var(--tone-emerald-border)] bg-[var(--tone-emerald-bg)] text-xs font-semibold transition-colors"
                    style={{ color: 'var(--tone-emerald-fg)' }}
                  >
                    Выдать багаж
                  </button>
                </div>
              ))}
            </div>
          )}

          {releasedLuggage.length > 0 && (
            <div className="pt-2 border-t border-[var(--border-subtle)] space-y-1.5">
              <div className="text-[11px] font-medium text-[var(--text-muted)]">
                Недавно выдано ({releasedLuggage.length})
              </div>
              <div className="flex flex-wrap gap-2">
                {releasedLuggage.map((item) => (
                  <span
                    key={item.id}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-xs text-[var(--text-muted)]"
                  >
                    <CheckCircle2 className="w-3 h-3" strokeWidth={1.75} style={{ color: 'var(--tone-emerald-fg)' }} />
                    <span className="font-mono">{item.tagCode}</span> {item.guestName}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <form
            onSubmit={handleAddLostFound}
            className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 p-3.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]"
          >
            <input
              type="text"
              required
              value={lfItem}
              onChange={(e) => setLfItem(e.target.value)}
              placeholder="Что найдено (зарядка, очки...)"
              className="ops-input sm:col-span-3 px-3 py-2 text-xs"
            />
            <input
              type="text"
              required
              value={lfLocation}
              onChange={(e) => setLfLocation(e.target.value)}
              placeholder="Где найдено (Yellow-2, кухня)"
              className="ops-input sm:col-span-3 px-3 py-2 text-xs"
            />
            <input
              type="text"
              value={lfGuest}
              onChange={(e) => setLfGuest(e.target.value)}
              placeholder="Гость (если известен)"
              className="ops-input sm:col-span-2 px-3 py-2 text-xs"
            />
            <input
              type="text"
              value={lfNotes}
              onChange={(e) => setLfNotes(e.target.value)}
              placeholder="Контакт / заметка"
              className="ops-input sm:col-span-2 px-3 py-2 text-xs"
            />
            <button
              type="submit"
              className="ops-brand-btn sm:col-span-2 px-3 py-2 rounded-xl text-xs font-semibold inline-flex items-center justify-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" strokeWidth={2} />
              Записать
            </button>
          </form>

          {openLostFound.length === 0 ? (
            <p className="text-xs text-[var(--text-muted)] text-center py-4">
              Невостребованных находок нет.
            </p>
          ) : (
            <div className="space-y-2">
              {openLostFound.map((lf) => (
                <div
                  key={lf.id}
                  className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-[var(--text-primary)]">
                        {lf.itemName}
                      </span>
                      <StatusPill tone="amber">{lf.foundLocation}</StatusPill>
                    </div>
                    <div className="text-xs text-[var(--text-muted)] mt-0.5">
                      Найдено: <span className="font-mono">{lf.foundDate}</span>
                      {lf.guestName ? ` · Гость: ${lf.guestName}` : ''} · {lf.notes}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => resolveLostFoundItem(lf.id)}
                    className="px-3 py-1.5 rounded-lg border border-[var(--tone-emerald-border)] bg-[var(--tone-emerald-bg)] text-xs font-semibold transition-colors"
                    style={{ color: 'var(--tone-emerald-fg)' }}
                  >
                    Возвращено владельцу
                  </button>
                </div>
              ))}
            </div>
          )}

          {returnedLostFound.length > 0 && (
            <div className="pt-2 border-t border-[var(--border-subtle)] space-y-1.5">
              <div className="text-[11px] font-medium text-[var(--text-muted)]">
                Возвращено владельцам ({returnedLostFound.length})
              </div>
              <div className="flex flex-wrap gap-2">
                {returnedLostFound.map((lf) => (
                  <span
                    key={lf.id}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-xs text-[var(--text-muted)]"
                  >
                    <CheckCircle2 className="w-3 h-3" strokeWidth={1.75} style={{ color: 'var(--tone-emerald-fg)' }} />
                    {lf.itemName} ({lf.foundLocation})
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
