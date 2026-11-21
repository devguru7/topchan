import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Clock,
  Play,
  Sparkle,
  Wrench,
} from 'lucide-react';
import { useOps, useTimers } from '../context/OpsContext';
import { StatusPill } from './ui';
import { getTashkentTodayIso } from '../utils/time';

interface HousekeepingBoardProps {
  compact?: boolean;
}

function formatElapsed(startedAtIso: string | undefined, nowMs: number): string {
  if (!startedAtIso) return '00:00';
  const startedMs = Date.parse(startedAtIso);
  if (Number.isNaN(startedMs)) return '00:00';
  const diffSec = Math.max(0, Math.floor((nowMs - startedMs) / 1000));
  const m = Math.floor(diffSec / 60);
  const s = diffSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export const HousekeepingBoard: React.FC<HousekeepingBoardProps> = ({ compact = false }) => {
  const {
    state,
    startHousekeepingTask,
    finishHousekeepingTask,
    adminApproveHousekeeping,
    setRoomHousekeepingStatus,
  } = useOps();
  const { nowMs } = useTimers();
  const [maidName, setMaidName] = useState('Дилором');

  const today = getTashkentTodayIso();

  // Rooms with arrivals today get top priority
  const todayArrivalRoomIds = useMemo(() => {
    const ids = new Set<string>();
    for (const b of state.bookings) {
      if (b.status !== 'active') continue;
      for (const s of b.segments) {
        if (s.fromDate === today) ids.add(s.roomId);
      }
    }
    return ids;
  }, [state.bookings, today]);

  const sortedTasks = useMemo(() => {
    const active = state.housekeepingTasks.filter((t) => t.status !== 'approved');
    return [...active].sort((a, b) => {
      const aUrgent = todayArrivalRoomIds.has(a.roomId) ? 0 : 1;
      const bUrgent = todayArrivalRoomIds.has(b.roomId) ? 0 : 1;
      if (aUrgent !== bUrgent) return aUrgent - bUrgent;
      const statusWeight = (s: string) => (s === 'dirty' ? 0 : s === 'maid_done' ? 1 : 2);
      return statusWeight(a.status) - statusWeight(b.status);
    });
  }, [state.housekeepingTasks, todayArrivalRoomIds]);

  const maintenanceRooms = useMemo(
    () => state.physicalRooms.filter((r) => !r.archived && r.status === 'maintenance'),
    [state.physicalRooms]
  );

  const dirtyCount = sortedTasks.filter((t) => t.status === 'dirty').length;
  const inProgressCount = sortedTasks.filter((t) => t.status === 'dirty' && Boolean(t.cleaningStartedAt)).length;
  const awaitingApprovalCount = sortedTasks.filter((t) => t.status === 'maid_done').length;

  return (
    <div className="space-y-4">
      {/* Top summary bar */}
      <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">
            Живая доска горничных (Housekeeping)
          </h3>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            Нажатие «Чисто и готово» мгновенно открывает номер на Шахматке ресепшн.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone={dirtyCount > 0 ? 'amber' : 'emerald'}>
            К уборке: {dirtyCount}
          </StatusPill>
          {inProgressCount > 0 && (
            <StatusPill tone="cobalt">В работе: {inProgressCount}</StatusPill>
          )}
          {awaitingApprovalCount > 0 && (
            <StatusPill tone="amber">На приёмке: {awaitingApprovalCount}</StatusPill>
          )}
          <select
            aria-label="Дежурная горничная"
            value={maidName}
            onChange={(e) => setMaidName(e.target.value)}
            className="ops-input px-2.5 py-1.5 text-xs"
          >
            <option value="Дилором">Горничная: Дилором</option>
            <option value="Малика">Горничная: Малика</option>
            <option value="Нодира">Горничная: Нодира</option>
          </select>
        </div>
      </div>

      {/* Priority Queue */}
      {sortedTasks.length === 0 ? (
        <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-8 text-center space-y-2">
          <CheckCircle2
            className="w-8 h-8 mx-auto"
            strokeWidth={1.75}
            style={{ color: 'var(--tone-emerald-fg)' }}
          />
          <p className="text-sm font-semibold text-[var(--text-primary)]">
            Все номера и койки убраны!
          </p>
          <p className="text-xs text-[var(--text-muted)]">
            Как только гость выедет (12:00) или ресепшн отметит номер грязным, карточка появится здесь автоматически.
          </p>
        </div>
      ) : (
        <div className={`grid grid-cols-1 ${compact ? 'md:grid-cols-2' : 'md:grid-cols-2 xl:grid-cols-3'} gap-3`}>
          {sortedTasks.map((task) => {
            const isUrgent = todayArrivalRoomIds.has(task.roomId);
            const isCleaning = task.status === 'dirty' && Boolean(task.cleaningStartedAt);
            const isMaidDone = task.status === 'maid_done';

            return (
              <div
                key={task.id}
                className="rounded-2xl border bg-[var(--bg-surface)] p-4 flex flex-col justify-between gap-3.5"
                style={{
                  borderColor: isUrgent
                    ? 'var(--brand-primary-border)'
                    : isCleaning
                      ? 'var(--tone-cobalt-border)'
                      : 'var(--border-subtle)',
                  boxShadow: 'var(--shadow-card)',
                }}
              >
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-base font-bold text-[var(--text-primary)]">
                          {task.roomLabel}
                        </span>
                        {isUrgent && (
                          <span
                            className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider"
                            style={{
                              backgroundColor: 'var(--brand-primary-soft)',
                              color: 'var(--brand-primary)',
                            }}
                          >
                            Срочно · заезд сегодня
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-[var(--text-muted)] mt-0.5">{task.notes}</p>
                    </div>
                    <StatusPill tone={isMaidDone ? 'emerald' : isCleaning ? 'cobalt' : 'amber'}>
                      {isMaidDone ? 'Убрано' : isCleaning ? 'В уборке' : 'Грязный'}
                    </StatusPill>
                  </div>

                  {isCleaning && (
                    <div
                      className="flex items-center justify-between px-3 py-2 rounded-xl text-xs font-mono"
                      style={{
                        backgroundColor: 'var(--tone-cobalt-bg)',
                        color: 'var(--tone-cobalt-fg)',
                      }}
                    >
                      <span className="inline-flex items-center gap-1.5 font-sans font-medium">
                        <Clock className="w-3.5 h-3.5" strokeWidth={1.75} />
                        {maidName} убирает
                      </span>
                      <span className="font-bold tabular-nums">
                        {formatElapsed(task.cleaningStartedAt, nowMs)}
                      </span>
                    </div>
                  )}
                </div>

                {/* Big touch-friendly actions (min-h-[48px]) */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {!isMaidDone && !isCleaning && (
                    <button
                      type="button"
                      onClick={() => startHousekeepingTask(task.id, maidName)}
                      className="min-h-[48px] px-3.5 py-2.5 rounded-xl border border-[var(--border-strong)] bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] text-xs font-semibold text-[var(--text-primary)] inline-flex items-center justify-center gap-2 transition-colors"
                    >
                      <Play className="w-4 h-4" strokeWidth={2} />
                      Начала уборку
                    </button>
                  )}

                  {!isMaidDone ? (
                    <button
                      type="button"
                      onClick={() => finishHousekeepingTask(task.id, maidName)}
                      className={`min-h-[48px] px-3.5 py-2.5 rounded-xl text-xs font-semibold inline-flex items-center justify-center gap-2 transition-colors ${
                        isCleaning ? 'sm:col-span-2' : ''
                      }`}
                      style={{
                        backgroundColor: 'var(--tone-emerald-fg)',
                        color: '#FFFFFF',
                      }}
                    >
                      <Sparkle className="w-4 h-4" strokeWidth={2} />
                      Чисто и готово
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => adminApproveHousekeeping(task.id)}
                      className="sm:col-span-2 min-h-[48px] px-3.5 py-2.5 rounded-xl text-xs font-semibold inline-flex items-center justify-center gap-2 transition-colors"
                      style={{
                        backgroundColor: 'var(--tone-emerald-fg)',
                        color: '#FFFFFF',
                      }}
                    >
                      <CheckCircle2 className="w-4 h-4" strokeWidth={2} />
                      Принять и открыть на Шахматке
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Out of order / maintenance rooms */}
      {maintenanceRooms.length > 0 && (
        <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 space-y-2.5">
          <div className="flex items-center gap-2 text-xs font-semibold text-[var(--text-primary)]">
            <Wrench className="w-4 h-4" strokeWidth={1.75} style={{ color: 'var(--tone-rose-fg)' }} />
            <span>Номера на ремонте / обслуживании ({maintenanceRooms.length})</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {maintenanceRooms.map((r) => (
              <div
                key={r.id}
                className="flex items-center gap-2.5 px-3 py-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-xs"
              >
                <span className="font-semibold text-[var(--text-primary)]">{r.code}</span>
                <button
                  type="button"
                  onClick={() => setRoomHousekeepingStatus(r.id, 'available')}
                  className="text-xs font-semibold underline"
                  style={{ color: 'var(--tone-emerald-fg)' }}
                >
                  Вернуть в продажу
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
