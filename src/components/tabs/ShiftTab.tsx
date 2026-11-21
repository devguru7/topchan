import React, { useMemo, useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Circle,
  Clock,
  DoorOpen,
  Loader2,
  Mic,
  MicOff,
  ScanLine,
  Sparkles,
  UserPlus,
} from 'lucide-react';
import { useOps } from '../../context/OpsContext';
import type { ParsedCommand } from '../../types/ops';
import { COMMAND_PRESETS, parseRussianReceptionCommand } from '../../utils/commandParser';
import { calcBookingTotals, formatUsd, formatUzs } from '../../utils/math';
import { getTashkentParts } from '../../utils/time';
import { useVoiceDictation } from '../../hooks/useVoiceDictation';
import { parseReceptionCommandSmart } from '../../services/aiService';
import { EmptyState, StatusPill } from '../ui';

function parseScheduleMinutes(timeStr: string): number {
  const [hStr, mStr] = timeStr.split(':');
  const h = parseInt(hStr, 10) || 0;
  const m = parseInt(mStr, 10) || 0;
  // Treat 00:00–07:59 as end-of-shift (24:00–31:59) so 08:00 → 00:00 sorts chronologically
  const shiftedHour = h < 8 ? h + 24 : h;
  return shiftedHour * 60 + m;
}

export const ShiftTab: React.FC = () => {
  const {
    state,
    commitParsedCommand,
    toggleChecklistItem,
    openCheckInModal,
    openCheckOutModal,
    openBookingFolio,
    pushToast,
  } = useOps();

  const [commandText, setCommandText] = useState('');
  const [aiParsedOverride, setAiParsedOverride] = useState<ParsedCommand | null>(null);
  const [aiEngine, setAiEngine] = useState<'local' | 'gemini'>('local');
  const [aiLoading, setAiLoading] = useState(false);
  const [showCompletedChecklist, setShowCompletedChecklist] = useState(false);

  const voice = useVoiceDictation({
    onTranscript: (text) => {
      setCommandText(text);
      setAiParsedOverride(null);
      setAiEngine('local');
    },
    onStatusMessage: (msg, tone) => pushToast('Голосовой ввод', msg, tone),
  });

  const localParsed = useMemo(() => {
    if (commandText.trim().length < 4) return null;
    return parseRussianReceptionCommand(
      commandText,
      state.physicalRooms,
      state.roomCategories,
      state.currency
    );
  }, [commandText, state.physicalRooms, state.roomCategories, state.currency]);

  const parsed = aiParsedOverride ?? localParsed;

  const { nowMinutes, completedItems, pendingItems, currentSlotId } = useMemo(() => {
    const parts = getTashkentParts();
    const shiftedHour = parts.hour < 8 ? parts.hour + 24 : parts.hour;
    const nowMin = shiftedHour * 60 + parts.minute;
    const completed = state.shiftChecklist.filter((c) => c.done);
    const pending = state.shiftChecklist.filter((c) => !c.done);

    // Highlight the closest upcoming or currently active pending task
    let activeId: string | null = null;
    if (pending.length > 0) {
      const nextOrCurrent =
        pending.find((item) => parseScheduleMinutes(item.time) >= nowMin - 45) ?? pending[0];
      activeId = nextOrCurrent.id;
    }

    return {
      nowMinutes: nowMin,
      completedItems: completed,
      pendingItems: pending,
      currentSlotId: activeId,
    };
  }, [state.shiftChecklist]);

  const checkoutsToday = useMemo(
    () => state.bookings.filter((b) => b.status === 'active' && b.checkingOutToday),
    [state.bookings]
  );

  const handleAiEnhance = async () => {
    if (commandText.trim().length < 4) return;
    setAiLoading(true);
    try {
      const res = await parseReceptionCommandSmart(
        commandText,
        state.physicalRooms,
        state.roomCategories,
        state.currency
      );
      setAiParsedOverride(res.parsed);
      setAiEngine(res.engine);
      pushToast(
        res.engine === 'gemini' ? 'Разобрано через Gemini AI' : 'Разобрано локальным парсером',
        res.parsed.confidenceNote,
        res.engine === 'gemini' ? 'emerald' : 'cobalt'
      );
    } finally {
      setAiLoading(false);
    }
  };

  const handleCommit = () => {
    if (!parsed) return;
    const ok = commitParsedCommand(parsed);
    if (ok) {
      setCommandText('');
      setAiParsedOverride(null);
      setAiEngine('local');
    }
  };

  const progressPct =
    state.shiftChecklist.length > 0
      ? Math.round((completedItems.length / state.shiftChecklist.length) * 100)
      : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[var(--text-primary)]">
            Смена и Автопилот ресепшна
          </h1>
          <p className="text-xs sm:text-sm text-[var(--text-muted)] mt-0.5">
            Голосовые команды в 1 клик · живой регламент 08:00–00:00 · контроль выездов до 12:00
          </p>
        </div>
        <button
          type="button"
          onClick={() => openCheckInModal()}
          className="px-4 py-2.5 rounded-xl bg-[#059669] hover:bg-[#047857] text-white text-xs sm:text-sm font-semibold inline-flex items-center gap-2 whitespace-nowrap shrink-0 transition-colors"
        >
          <ScanLine className="w-4 h-4 shrink-0" strokeWidth={1.75} />
          Заселение + MRZ
        </button>
      </div>

      {/* Hero Voice & Text Quick Command Bar */}
      <section className="ops-card p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Sparkles
              className="w-4 h-4 shrink-0"
              strokeWidth={1.75}
              style={{ color: 'var(--tone-cobalt-fg)' }}
            />
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">
              Быстрая командная строка ресепшна
            </h2>
          </div>
          <span className="text-xs text-[var(--text-muted)] font-mono tabular-nums">
            Авторасчёт комнаты, ночей, сдачи (Ex {state.currency.exRate}) и стирки
          </span>
        </div>

        <div className="flex flex-col sm:flex-row gap-2.5">
          <input
            type="text"
            aria-label="Командная строка автопилота"
            value={commandText}
            onChange={(e) => {
              setCommandText(e.target.value);
              setAiParsedOverride(null);
              setAiEngine('local');
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && parsed) {
                e.preventDefault();
                handleCommit();
              }
            }}
            placeholder="Например: Смолл 3, Алекс Ким, 2 ночи, дал $50, сдача сумами, быстрая стирка"
            className="ops-input flex-1 px-4 py-3 text-sm"
          />
          <button
            type="button"
            onClick={voice.toggle}
            className="px-4 py-3 rounded-xl text-xs sm:text-sm font-semibold inline-flex items-center justify-center gap-2 whitespace-nowrap shrink-0 transition-colors border"
            style={
              voice.isListening
                ? {
                    backgroundColor: 'var(--tone-rose-bg)',
                    borderColor: 'var(--tone-rose-border)',
                    color: 'var(--tone-rose-fg)',
                  }
                : {
                    backgroundColor: 'var(--bg-elevated)',
                    borderColor: 'var(--border-subtle)',
                    color: 'var(--text-primary)',
                  }
            }
          >
            {voice.isListening ? (
              <MicOff className="w-4 h-4" strokeWidth={1.75} />
            ) : (
              <Mic className="w-4 h-4" strokeWidth={1.75} />
            )}
            {voice.isListening ? 'Стоп (RU)' : 'Диктовка (RU)'}
          </button>
          <button
            type="button"
            disabled={aiLoading || commandText.trim().length < 4}
            onClick={handleAiEnhance}
            className="px-4 py-3 rounded-xl text-xs sm:text-sm font-semibold inline-flex items-center justify-center gap-2 whitespace-nowrap shrink-0 transition-colors border disabled:opacity-45"
            style={{
              backgroundColor: 'var(--tone-cobalt-bg)',
              borderColor: 'var(--tone-cobalt-border)',
              color: 'var(--tone-cobalt-fg)',
            }}
          >
            {aiLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" strokeWidth={1.75} />
            ) : (
              <Sparkles className="w-4 h-4" strokeWidth={1.75} />
            )}
            AI-разбор
          </button>
        </div>

        {voice.isListening && (
          <div
            className="flex items-center gap-2.5 text-xs font-medium rounded-xl px-3.5 py-2.5 border"
            style={{
              backgroundColor: 'var(--tone-rose-bg)',
              borderColor: 'var(--tone-rose-border)',
              color: 'var(--tone-rose-fg)',
            }}
          >
            <span className="relative flex h-2.5 w-2.5 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#F43F5E] opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#E11D48]" />
            </span>
            <span>
              Слушаю микрофон (ru-RU){voice.interimText ? `: «${voice.interimText}»` : '...'}
            </span>
          </div>
        )}

        {/* 3 Clickable Realistic Presets */}
        <div className="flex flex-wrap gap-2">
          {COMMAND_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => {
                setCommandText(preset);
                setAiParsedOverride(null);
                setAiEngine('local');
              }}
              className="text-left px-3 py-1.5 rounded-xl bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            >
              {preset}
            </button>
          ))}
        </div>

        {/* Interactive 1-Click Confirmation Card */}
        {parsed && (
          <div
            className="rounded-2xl border p-4 space-y-4 bg-[var(--bg-elevated)]"
            style={{ borderColor: 'var(--tone-cobalt-border)' }}
          >
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[var(--border-subtle)]">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <span
                    className="text-xs font-semibold"
                    style={{ color: 'var(--tone-cobalt-fg)' }}
                  >
                    Карточка подтверждения в 1 клик
                  </span>
                  <StatusPill tone={aiEngine === 'gemini' ? 'emerald' : 'cobalt'}>
                    {aiEngine === 'gemini' ? 'Gemini AI' : 'Локальный движок'}
                  </StatusPill>
                </div>
                <div className="text-xs text-[var(--text-muted)]">{parsed.confidenceNote}</div>
              </div>
              <span className="text-xs font-mono tabular-nums text-[var(--text-secondary)]">
                Курс сдачи Ex: {state.currency.exRate.toLocaleString('ru-RU')} сум
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
              <div>
                <div className="text-[var(--text-muted)]">Комната и гость</div>
                <div className="text-sm font-semibold text-[var(--text-primary)] mt-1">
                  {parsed.roomLabel}
                </div>
                <div className="text-[var(--text-secondary)] mt-0.5">{parsed.guestName}</div>
              </div>
              <div>
                <div className="text-[var(--text-muted)]">Проживание и услуги</div>
                <div className="text-sm font-semibold font-mono tabular-nums text-[var(--text-primary)] mt-1">
                  {parsed.nights} н. × {formatUsd(parsed.nightlyRateUsd)} ={' '}
                  {formatUsd(parsed.totalUsd)}
                </div>
                <div className="text-[var(--text-secondary)] mt-0.5">
                  {parsed.extras.length > 0
                    ? parsed.extras.map((e) => `${e.label} ($${e.priceUsd})`).join(', ')
                    : 'Без доп. услуг'}
                </div>
              </div>
              <div>
                <div className="text-[var(--text-muted)]">Принято в кассу</div>
                <div
                  className="text-sm font-semibold font-mono tabular-nums mt-1"
                  style={{ color: 'var(--tone-emerald-fg)' }}
                >
                  {parsed.paidAmount > 0
                    ? `${parsed.paidAmount} ${parsed.paidCurrency}`
                    : 'Без оплаты'}
                </div>
                <div className="text-[var(--text-muted)] mt-0.5">
                  Карман: Нал {parsed.paidCurrency}
                </div>
              </div>
              <div>
                <div className="text-[var(--text-muted)]">
                  {parsed.debtUsd > 0 ? 'Останется долг' : 'Выдать сдачу'}
                </div>
                <div
                  className="text-sm font-semibold font-mono tabular-nums mt-1"
                  style={{
                    color:
                      parsed.debtUsd > 0 ? 'var(--tone-rose-fg)' : 'var(--tone-amber-fg)',
                  }}
                >
                  {parsed.debtUsd > 0
                    ? formatUsd(parsed.debtUsd)
                    : parsed.changeUzs > 0
                      ? formatUzs(parsed.changeUzs)
                      : parsed.changeUsd > 0
                        ? formatUsd(parsed.changeUsd)
                        : 'Без сдачи (0)'}
                </div>
                <div className="text-[var(--text-muted)] mt-0.5">
                  {parsed.changeUzs > 0
                    ? `Переплата ${formatUsd(parsed.overpaidUsd)}`
                    : 'Точный расчёт'}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setCommandText('')}
                className="px-4 py-2 rounded-xl bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-xs font-semibold text-[var(--text-secondary)] transition-colors"
              >
                Очистить
              </button>
              <button
                type="button"
                onClick={handleCommit}
                className="px-5 py-2.5 rounded-xl bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-xs sm:text-sm font-semibold inline-flex items-center gap-2 transition-colors"
              >
                Подтвердить и провести
                <ArrowRight className="w-4 h-4" strokeWidth={1.75} />
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Main 2-Column Split: Vertical 24-Hour Shift Progress Rail + 12:00 Check-outs */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* 24-Hour Vertical Progress Rail */}
        <section className="lg:col-span-7 ops-card p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                Регламент смены Topchan (08:00 → 00:00)
              </h2>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">
                Кликните по задаче, чтобы отметить выполнение в журнале смены
              </p>
            </div>
            <StatusPill
              tone={completedItems.length === state.shiftChecklist.length ? 'emerald' : 'cobalt'}
              mono
            >
              {completedItems.length} / {state.shiftChecklist.length} ({progressPct}%)
            </StatusPill>
          </div>

          {/* Slim Shift Progress Bar */}
          <div className="w-full h-1.5 rounded-full bg-[var(--bg-elevated)] overflow-hidden">
            <div
              className="h-full rounded-full bg-[#059669] transition-all duration-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>

          {/* Pending Tasks Vertical Timeline */}
          {pendingItems.length === 0 ? (
            <EmptyState
              icon={CheckCircle2}
              title="Все задачи смены выполнены"
              description="Регламент с 08:00 до 00:00 полностью закрыт. Можно переходить к сдаче смены в разделе «Касса»."
            />
          ) : (
            <div className="relative pl-4 space-y-2.5 before:content-[''] before:absolute before:left-[7px] before:top-3 before:bottom-3 before:w-[2px] before:bg-[var(--border-subtle)]">
              {pendingItems.map((item) => {
                const isCurrent = item.id === currentSlotId;
                const isOverdue = parseScheduleMinutes(item.time) < nowMinutes - 45;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => toggleChecklistItem(item.id)}
                    className="relative w-full text-left rounded-2xl border p-3.5 transition-colors flex items-start gap-3.5 hover:bg-[var(--bg-hover)]/60"
                    style={
                      isCurrent
                        ? {
                            backgroundColor: 'var(--tone-cobalt-bg)',
                            borderColor: 'var(--tone-cobalt-border)',
                          }
                        : {
                            backgroundColor: 'var(--bg-elevated)',
                            borderColor: 'var(--border-subtle)',
                          }
                    }
                  >
                    {/* Timeline Rail Dot */}
                    <span
                      aria-hidden="true"
                      className="absolute -left-[15px] top-4 w-3 h-3 rounded-full border-2 border-[var(--bg-surface)]"
                      style={{
                        backgroundColor: isCurrent
                          ? '#2563EB'
                          : isOverdue
                            ? '#D97706'
                            : 'var(--border-strong)',
                      }}
                    />

                    <span
                      className="font-mono tabular-nums text-xs font-bold w-12 shrink-0 pt-0.5"
                      style={{
                        color: isCurrent
                          ? 'var(--tone-cobalt-fg)'
                          : isOverdue
                            ? 'var(--tone-amber-fg)'
                            : 'var(--text-muted)',
                      }}
                    >
                      {item.time}
                    </span>

                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-[var(--text-primary)]">
                          {item.title}
                        </span>
                        {isCurrent && <StatusPill tone="cobalt">Сейчас</StatusPill>}
                        {!isCurrent && isOverdue && <StatusPill tone="amber">Проверить</StatusPill>}
                      </div>
                      <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                        {item.description}
                      </p>
                    </div>

                    <Circle
                      className="w-5 h-5 text-[var(--text-muted)] shrink-0 mt-0.5"
                      strokeWidth={1.75}
                    />
                  </button>
                );
              })}
            </div>
          )}

          {/* Collapsible Completed Items */}
          {completedItems.length > 0 && (
            <div className="pt-2 border-t border-[var(--border-subtle)] space-y-2">
              <button
                type="button"
                onClick={() => setShowCompletedChecklist((v) => !v)}
                className="w-full flex items-center justify-between px-3 py-2 rounded-xl bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] text-xs font-semibold text-[var(--text-secondary)] transition-colors"
              >
                <span>
                  {showCompletedChecklist ? 'Скрыть выполненные' : 'Показать выполненные'} (
                  {completedItems.length})
                </span>
                {showCompletedChecklist ? (
                  <ChevronUp className="w-4 h-4" strokeWidth={1.75} />
                ) : (
                  <ChevronDown className="w-4 h-4" strokeWidth={1.75} />
                )}
              </button>

              {showCompletedChecklist && (
                <div className="divide-y divide-[var(--border-subtle)] border border-[var(--border-subtle)] rounded-2xl bg-[var(--bg-elevated)] overflow-hidden">
                  {completedItems.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => toggleChecklistItem(item.id)}
                      className="w-full text-left px-3.5 py-2.5 hover:bg-[var(--bg-hover)] transition-colors flex items-center justify-between gap-3 text-xs"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="font-mono tabular-nums text-[var(--text-muted)] w-11 shrink-0">
                          {item.time}
                        </span>
                        <span className="line-through text-[var(--text-muted)] truncate">
                          {item.title}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {item.doneAt && (
                          <span className="font-mono tabular-nums text-[var(--text-muted)]">
                            {item.doneAt}
                          </span>
                        )}
                        <CheckCircle2
                          className="w-4 h-4 shrink-0"
                          strokeWidth={1.75}
                          style={{ color: 'var(--tone-emerald-fg)' }}
                        />
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>

        {/* Right Column: 12:00 Pre-Checkout Watch & Quick Launch */}
        <section className="lg:col-span-5 space-y-5">
          <div className="ops-card p-5 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Clock
                  className="w-4 h-4 shrink-0"
                  strokeWidth={1.75}
                  style={{ color: 'var(--tone-amber-fg)' }}
                />
                <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                  Выезды сегодня в 12:00
                </h2>
              </div>
              <StatusPill tone={checkoutsToday.length > 0 ? 'amber' : 'emerald'} mono>
                {checkoutsToday.length}
              </StatusPill>
            </div>

            {checkoutsToday.length === 0 ? (
              <EmptyState
                icon={CheckCircle2}
                title="Все гости на 12:00 выселены"
                description="На текущую смену больше нет запланированных выездов."
              />
            ) : (
              <div className="space-y-3">
                {checkoutsToday.map((b) => {
                  const lastSeg = b.segments[b.segments.length - 1];
                  const room = state.physicalRooms.find((r) => r.id === lastSeg?.roomId);
                  const bed = room?.beds?.find((bd) => bd.id === lastSeg?.bedId);
                  const roomLabel = room
                    ? bed
                      ? `${room.code} ${bed.label}`
                      : room.code
                    : 'Номер';
                  const fin = calcBookingTotals(b);
                  const foreigner = b.guests.some((g) => g.isForeigner);

                  return (
                    <div
                      key={b.id}
                      className="p-3.5 rounded-2xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] space-y-2.5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-[var(--text-primary)] truncate">
                            {roomLabel}
                          </div>
                          <div className="text-xs text-[var(--text-secondary)] truncate">
                            {b.guests.map((g) => `${g.fullName} (${g.citizenship})`).join(', ')}
                          </div>
                        </div>
                        <StatusPill tone={fin.debtUsd > 0 ? 'rose' : 'emerald'} mono>
                          {fin.debtUsd > 0 ? `Долг ${formatUsd(fin.debtUsd)}` : 'Оплачено'}
                        </StatusPill>
                      </div>
                      {foreigner && (
                        <div
                          className="text-xs font-medium"
                          style={{ color: 'var(--tone-amber-fg)' }}
                        >
                          Иностранец — распечатать квиток E-mehmon при выезде
                        </div>
                      )}
                      <div className="flex items-center gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => openBookingFolio(b.id)}
                          className="flex-1 py-2 px-3 rounded-xl bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-xs font-semibold text-[var(--text-primary)] transition-colors"
                        >
                          Счёт гостя
                        </button>
                        <button
                          type="button"
                          onClick={() => openCheckOutModal(b.id)}
                          className="flex-1 py-2 px-3 rounded-xl bg-[#D97706] hover:bg-[#B45309] text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors"
                        >
                          <DoorOpen className="w-3.5 h-3.5" strokeWidth={1.75} />
                          Выселение
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="ops-card p-5 space-y-3">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">
              Быстрый запуск заселения
            </h2>
            <p className="text-xs text-[var(--text-muted)] leading-relaxed">
              Форма заселения со сканером паспорта (MRZ / фото), расчётом турсбора и готовой
              памяткой гостю (Wi-Fi:{' '}
              <span className="font-mono text-[var(--text-primary)]">
                {state.integrations.wifiPass}
              </span>
              , дверь:{' '}
              <span className="font-mono text-[var(--text-primary)]">
                {state.integrations.doorCode}
              </span>
              ).
            </p>
            <button
              type="button"
              onClick={() => openCheckInModal()}
              className="w-full py-2.5 px-4 rounded-xl bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] text-xs sm:text-sm font-semibold text-[var(--text-primary)] border border-[var(--border-strong)] inline-flex items-center justify-center gap-2 transition-colors"
            >
              <UserPlus
                className="w-4 h-4 shrink-0"
                strokeWidth={1.75}
                style={{ color: 'var(--tone-emerald-fg)' }}
              />
              Открыть форму заселения (клавиша N)
            </button>
          </div>
        </section>
      </div>
    </div>
  );
};
