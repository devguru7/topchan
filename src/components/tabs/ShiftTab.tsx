import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Circle,
  Clock,
  Copy,
  DoorOpen,
  ExternalLink,
  FileCheck2,
  FileText,
  Loader2,
  Mic,
  MicOff,
  Search,
  ShieldCheck,
  Terminal,
  UserPlus,
  Users,
} from 'lucide-react';
import { useOps } from '../../context/OpsContext';
import type { ShiftSubTab } from '../../context/UIContext';
import type { ParsedCommand } from '../../types/ops';
import { COMMAND_PRESETS, parseRussianReceptionCommand } from '../../utils/commandParser';
import { calcBookingTotals, formatUsd, formatUzs } from '../../utils/math';
import { getTopchanRoomColor } from '../../utils/roomColors';
import { getTashkentParts } from '../../utils/time';
import { useVoiceDictation } from '../../hooks/useVoiceDictation';
import { parseReceptionCommandSmart } from '../../services/aiService';
import { EmptyState, SegmentedControl, StatusPill } from '../ui';

type EmehmonFilterId = 'all' | 'unregistered_foreigners' | 'checkout_today' | 'debtors';

function parseScheduleMinutes(timeStr: string): number {
  const [hStr, mStr] = timeStr.split(':');
  const h = parseInt(hStr, 10) || 0;
  const m = parseInt(mStr, 10) || 0;
  const shiftedHour = h < 8 ? h + 24 : h;
  return shiftedHour * 60 + m;
}

export const ShiftTab: React.FC = () => {
  const {
    state,
    shiftSubTab,
    setShiftSubTab,
    commitParsedCommand,
    toggleChecklistItem,
    markGuestEmehmonRegistered,
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

  // E-mehmon registry filters
  const [emehmonFilter, setEmehmonFilter] = useState<EmehmonFilterId>('all');
  const [registrySearch, setRegistrySearch] = useState('');

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

  // Flat guest rows for "Реестр гостей и E-mehmon" table
  const registryRows = useMemo(() => {
    const activeBookings = state.bookings.filter((b) => b.status === 'active');
    const rows: Array<{
      key: string;
      bookingId: string;
      guestId: string;
      roomLabel: string;
      roomColorHex: string;
      fullName: string;
      citizenship: string;
      passportNo: string;
      dob: string;
      age: number;
      isForeigner: boolean;
      fromDate: string;
      toDate: string;
      checkingOutToday: boolean;
      emehmonRegistered: boolean;
      registrationSlipPrinted: boolean;
      debtUsd: number;
      overpaidUsd: number;
      bnovoId: string;
    }> = [];

    for (const b of activeBookings) {
      const firstSeg = b.segments[0];
      const lastSeg = b.segments[b.segments.length - 1];
      const room = state.physicalRooms.find((r) => r.id === lastSeg?.roomId);
      const bed = room?.beds?.find((bd) => bd.id === lastSeg?.bedId);
      const cat = state.roomCategories.find((c) => c.id === room?.categoryId);
      const roomLabel = room ? (bed ? `${room.code} · ${bed.label}` : room.code) : 'Номер';
      const roomColorHex = cat ? getTopchanRoomColor(cat.id, cat.colorHex) : '#64748B';
      const fin = calcBookingTotals(b);

      for (const g of b.guests) {
        rows.push({
          key: `${b.id}:${g.id}`,
          bookingId: b.id,
          guestId: g.id,
          roomLabel,
          roomColorHex,
          fullName: g.fullName,
          citizenship: g.citizenship,
          passportNo: g.passportNo,
          dob: g.dob,
          age: g.age,
          isForeigner: g.isForeigner,
          fromDate: firstSeg?.fromDate ?? '—',
          toDate: lastSeg?.toDate ?? '—',
          checkingOutToday: b.checkingOutToday,
          emehmonRegistered: g.emehmonRegistered,
          registrationSlipPrinted: g.registrationSlipPrinted,
          debtUsd: fin.debtUsd,
          overpaidUsd: fin.overpaidUsd,
          bnovoId: b.bnovoId,
        });
      }
    }

    return rows;
  }, [state.bookings, state.physicalRooms, state.roomCategories]);

  const registryCounts = useMemo(
    () => ({
      all: registryRows.length,
      unregistered_foreigners: registryRows.filter(
        (r) => r.isForeigner && !r.emehmonRegistered
      ).length,
      checkout_today: registryRows.filter((r) => r.checkingOutToday).length,
      debtors: registryRows.filter((r) => r.debtUsd > 0).length,
    }),
    [registryRows]
  );

  const filteredRegistryRows = useMemo(() => {
    const q = registrySearch.trim().toLowerCase();
    return registryRows.filter((row) => {
      if (
        emehmonFilter === 'unregistered_foreigners' &&
        (!row.isForeigner || row.emehmonRegistered)
      ) {
        return false;
      }
      if (emehmonFilter === 'checkout_today' && !row.checkingOutToday) return false;
      if (emehmonFilter === 'debtors' && row.debtUsd <= 0) return false;

      if (!q) return true;
      return (
        row.fullName.toLowerCase().includes(q) ||
        row.passportNo.toLowerCase().includes(q) ||
        row.citizenship.toLowerCase().includes(q) ||
        row.roomLabel.toLowerCase().includes(q) ||
        row.bnovoId.toLowerCase().includes(q)
      );
    });
  }, [registryRows, emehmonFilter, registrySearch]);

  const subTabOptions = useMemo<
    Array<{
      id: ShiftSubTab;
      label: string;
      badge?: number;
      icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
    }>
  >(
    () => [
      { id: 'autopilot', label: 'Автопилот и регламент', icon: Clock },
      {
        id: 'emehmon',
        label: 'Реестр гостей и E-mehmon',
        badge: registryCounts.unregistered_foreigners,
        icon: FileCheck2,
      },
    ],
    [registryCounts.unregistered_foreigners]
  );

  const emehmonFilterOptions = useMemo<
    Array<{ id: EmehmonFilterId; label: string; badge?: number }>
  >(
    () => [
      { id: 'all', label: 'Все проживающие', badge: registryCounts.all },
      {
        id: 'unregistered_foreigners',
        label: 'Иностранцы без E-mehmon',
        badge: registryCounts.unregistered_foreigners,
      },
      {
        id: 'checkout_today',
        label: 'Выезд сегодня 12:00',
        badge: registryCounts.checkout_today,
      },
      { id: 'debtors', label: 'Должники', badge: registryCounts.debtors },
    ],
    [registryCounts]
  );

  const handleCopyForEmehmon = (row: (typeof registryRows)[number]) => {
    const text = [
      `ФИО: ${row.fullName}`,
      `Гражданство: ${row.citizenship}`,
      `Паспорт: ${row.passportNo}`,
      `Дата рождения: ${row.dob}`,
      `Номер/койка: ${row.roomLabel}`,
      `Проживание: ${row.fromDate} — ${row.toDate}`,
      `Bnovo ID: ${row.bnovoId}`,
    ].join('\n');
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
    pushToast(
      'Скопировано для E-mehmon',
      `${row.fullName} (${row.passportNo}, ${row.citizenship})`,
      'cobalt'
    );
  };

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
        res.engine === 'gemini' ? 'Строка разобрана' : 'Разобрано локальным парсером',
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
    <div className="space-y-5">
      {/* Header + Sub-Tab Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg sm:text-xl font-bold tracking-tight text-[var(--text-primary)]">
            Смена, Регламент и E-mehmon
          </h1>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            Голосовой автопилот, чек-лист смены 08:00–00:00 и единый реестр регистрации гостей РУз
          </p>
        </div>

        <SegmentedControl
          options={subTabOptions}
          value={shiftSubTab}
          onChange={setShiftSubTab}
          layoutId="shiftSubTab"
          ariaLabel="Разделы смены"
        />
      </div>

      {/* ====================================================================
       * SUB-TAB 2: GUEST REGISTRY & E-MEHMON TABLE
       * ==================================================================== */}
      {shiftSubTab === 'emehmon' && (
        <div className="space-y-4" data-testid="emehmon-registry-section">
          {/* Toolbar: Filter Chips + Search */}
          <div className="ops-card p-3 flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
            <SegmentedControl
              options={emehmonFilterOptions}
              value={emehmonFilter}
              onChange={setEmehmonFilter}
              layoutId="emehmonRegistryFilter"
              ariaLabel="Фильтры реестра E-mehmon"
            />

            <div className="relative lg:w-72 shrink-0">
              <Search
                className="w-4 h-4 text-[var(--text-muted)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                strokeWidth={1.75}
              />
              <input
                type="search"
                aria-label="Поиск по ФИО, паспорту, гражданству или комнате"
                value={registrySearch}
                onChange={(e) => setRegistrySearch(e.target.value)}
                placeholder="ФИО, паспорт, ITA / JPN..."
                className="ops-input h-10 w-full pl-9 pr-3 text-xs"
              />
            </div>
          </div>

          {/* Registry Table */}
          {filteredRegistryRows.length === 0 ? (
            <EmptyState
              icon={Users}
              title="По выбранному фильтру гостей нет"
              description="Все обязательные задачи по этому фильтру выполнены или поисковый запрос не дал совпадений."
              actionLabel="Показать всех проживающих"
              onAction={() => {
                setEmehmonFilter('all');
                setRegistrySearch('');
              }}
            />
          ) : (
            <div className="ops-card overflow-hidden">
              <div className="overflow-x-auto max-h-[62vh] overflow-y-auto">
                <table
                  className="w-full text-left border-collapse min-w-[900px]"
                  data-testid="emehmon-registry-table"
                >
                  <thead className="sticky top-0 z-10">
                    <tr className="bg-[var(--bg-elevated)] border-b border-[var(--border-strong)] text-xs font-semibold text-[var(--text-secondary)]">
                      <th className="py-2.5 px-2.5 whitespace-nowrap">Комната / Койка</th>
                      <th className="py-2.5 px-2.5 whitespace-nowrap">ФИО гостя</th>
                      <th className="py-2.5 px-2 whitespace-nowrap">Гражд.</th>
                      <th className="py-2.5 px-2.5 whitespace-nowrap">Паспорт</th>
                      <th className="py-2.5 px-2.5 whitespace-nowrap">Даты</th>
                      <th className="py-2.5 px-2.5 whitespace-nowrap">E-mehmon</th>
                      <th className="py-2.5 px-2 whitespace-nowrap">Квиток</th>
                      <th className="py-2.5 px-2 whitespace-nowrap text-right">Баланс</th>
                      <th className="py-2.5 px-2.5 whitespace-nowrap text-right">Действия</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-subtle)] text-xs">
                    {filteredRegistryRows.map((row) => (
                      <tr
                        key={row.key}
                        className="group h-[44px] hover:bg-[var(--bg-hover)]/50 transition-colors"
                      >
                        <td className="py-2.5 px-2.5 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <span
                              className="w-[3px] h-5 rounded-full shrink-0"
                              style={{ backgroundColor: row.roomColorHex }}
                            />
                            <span className="font-bold text-[var(--text-primary)]">
                              {row.roomLabel}
                            </span>
                          </div>
                        </td>
                        <td className="py-2.5 px-2.5">
                          <div className="font-semibold text-[var(--text-primary)] leading-snug">
                            {row.fullName}
                          </div>
                          <div className="text-[11px] text-[var(--text-muted)] font-mono tabular-nums">
                            {row.bnovoId}
                            {row.age < 16 ? ` · Реб. (${row.age} л.)` : ''}
                          </div>
                        </td>
                        <td className="py-2.5 px-2 whitespace-nowrap font-mono font-semibold text-[var(--text-primary)]">
                          {row.citizenship}
                        </td>
                        <td className="py-2.5 px-2.5 whitespace-nowrap font-mono tabular-nums text-[var(--text-secondary)]">
                          {row.passportNo}
                        </td>
                        <td className="py-2.5 px-2.5 whitespace-nowrap font-mono tabular-nums text-[var(--text-secondary)]">
                          <div>
                            {row.fromDate.slice(5)} → {row.toDate.slice(5)}
                          </div>
                          {row.checkingOutToday && (
                            <span
                              className="font-sans text-[11px] font-semibold"
                              style={{ color: 'var(--tone-amber-fg)' }}
                            >
                              Выезд 12:00
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-2.5 whitespace-nowrap">
                          {row.emehmonRegistered ? (
                            <StatusPill tone="emerald" icon={CheckCircle2}>
                              Оформлен
                            </StatusPill>
                          ) : (
                            <div className="inline-flex items-center gap-1.5">
                              <StatusPill tone="rose" icon={AlertCircle}>
                                Нужна рег.
                              </StatusPill>
                              <button
                                type="button"
                                onClick={() =>
                                  markGuestEmehmonRegistered(row.bookingId, row.guestId)
                                }
                                className="px-2 py-1 rounded-md bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-xs font-semibold transition-colors"
                              >
                                Оформить
                              </button>
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 px-2 whitespace-nowrap">
                          <span
                            className="text-xs font-medium"
                            style={{
                              color: row.registrationSlipPrinted
                                ? 'var(--tone-emerald-fg)'
                                : 'var(--text-muted)',
                            }}
                          >
                            {row.registrationSlipPrinted ? 'Выдан' : 'Нет'}
                          </span>
                        </td>
                        <td className="py-2.5 px-2 whitespace-nowrap text-right font-mono tabular-nums font-bold">
                          {row.debtUsd > 0 ? (
                            <span style={{ color: 'var(--tone-rose-fg)' }}>
                              −{formatUsd(row.debtUsd)}
                            </span>
                          ) : row.overpaidUsd > 0 ? (
                            <span style={{ color: 'var(--tone-cobalt-fg)' }}>
                              +{formatUsd(row.overpaidUsd)}
                            </span>
                          ) : (
                            <span style={{ color: 'var(--tone-emerald-fg)' }}>$0</span>
                          )}
                        </td>
                        <td className="py-2.5 px-2.5 whitespace-nowrap text-right">
                          <div className="inline-flex items-center justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => openBookingFolio(row.bookingId)}
                              title="Открыть счёт гостя"
                              className="h-8 px-2 rounded-lg bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-xs font-semibold text-[var(--text-primary)] inline-flex items-center gap-1 transition-colors"
                            >
                              <ExternalLink className="w-3.5 h-3.5" strokeWidth={1.75} />
                              Открыть
                            </button>
                            <button
                              type="button"
                              onClick={() => handleCopyForEmehmon(row)}
                              title="Скопировать паспортные данные для портала E-mehmon"
                              className="h-8 px-2 rounded-lg border text-xs font-semibold inline-flex items-center gap-1 transition-colors"
                              style={{
                                backgroundColor: 'var(--tone-cobalt-bg)',
                                borderColor: 'var(--tone-cobalt-border)',
                                color: 'var(--tone-cobalt-fg)',
                              }}
                            >
                              <Copy className="w-3.5 h-3.5" strokeWidth={1.75} />
                              E-mehmon
                            </button>
                            <button
                              type="button"
                              onClick={() => openCheckOutModal(row.bookingId)}
                              title="Оформить выезд"
                              className="h-8 px-2 rounded-lg bg-[var(--bg-elevated)] hover:bg-[var(--tone-amber-bg)] border border-[var(--border-subtle)] text-xs font-semibold text-[var(--text-primary)] inline-flex items-center gap-1 transition-colors"
                            >
                              <DoorOpen className="w-3.5 h-3.5" strokeWidth={1.75} />
                              Выезд
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ====================================================================
       * SUB-TAB 1: AUTOPILOT & SHIFT SCHEDULE (08:00 -> 00:00)
       * ==================================================================== */}
      {shiftSubTab === 'autopilot' && (
        <div className="space-y-5">
          {/* Hero Voice & Text Quick Command Bar */}
          <section className="ops-card p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Terminal
                  className="w-4 h-4 shrink-0"
                  strokeWidth={1.75}
                  style={{ color: 'var(--brand-primary)' }}
                />
                <h2 className="text-sm font-bold text-[var(--text-primary)]">
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
                className="ops-input flex-1 h-11 px-4 text-sm"
              />
              <button
                type="button"
                onClick={voice.toggle}
                className="h-11 px-4 rounded-xl text-xs sm:text-sm font-semibold inline-flex items-center justify-center gap-2 whitespace-nowrap shrink-0 transition-colors border"
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
                className="h-11 px-4 rounded-xl text-xs sm:text-sm font-semibold inline-flex items-center justify-center gap-2 whitespace-nowrap shrink-0 transition-colors border disabled:opacity-45"
                style={{
                  backgroundColor: 'var(--tone-cobalt-bg)',
                  borderColor: 'var(--tone-cobalt-border)',
                  color: 'var(--tone-cobalt-fg)',
                }}
              >
                {aiLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" strokeWidth={1.75} />
                ) : (
                  <FileText className="w-4 h-4" strokeWidth={1.75} />
                )}
                Точный разбор
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
                  className="text-left px-3 py-1.5 rounded-lg bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                >
                  {preset}
                </button>
              ))}
            </div>

            {/* Interactive 1-Click Confirmation Card */}
            {parsed && (
              <div
                className="rounded-xl border p-4 space-y-4 bg-[var(--bg-elevated)]"
                style={{ borderColor: 'var(--tone-cobalt-border)' }}
              >
                <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[var(--border-subtle)]">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span
                        className="text-xs font-bold"
                        style={{ color: 'var(--tone-cobalt-fg)' }}
                      >
                        Карточка подтверждения в 1 клик
                      </span>
                      <StatusPill tone={aiEngine === 'gemini' ? 'emerald' : 'cobalt'}>
                        {aiEngine === 'gemini' ? 'Точный разбор' : 'Локальный движок'}
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
                    <div className="text-sm font-bold text-[var(--text-primary)] mt-1">
                      {parsed.roomLabel}
                    </div>
                    <div className="text-[var(--text-secondary)] mt-0.5">{parsed.guestName}</div>
                  </div>
                  <div>
                    <div className="text-[var(--text-muted)]">Проживание и услуги</div>
                    <div className="text-sm font-bold font-mono tabular-nums text-[var(--text-primary)] mt-1">
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
                      className="text-sm font-bold font-mono tabular-nums mt-1"
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
                      className="text-sm font-bold font-mono tabular-nums mt-1"
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
                    className="h-10 px-4 rounded-lg bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-xs font-semibold text-[var(--text-secondary)] transition-colors"
                  >
                    Очистить
                  </button>
                  <button
                    type="button"
                    onClick={handleCommit}
                    className="ops-brand-btn h-10 px-5 rounded-lg text-xs sm:text-sm font-semibold inline-flex items-center gap-2"
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
                  <h2 className="text-sm font-bold text-[var(--text-primary)]">
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

              <div className="w-full h-1.5 rounded-full bg-[var(--bg-elevated)] overflow-hidden">
                <div
                  className="h-full rounded-full transition-[width] duration-500"
                  style={{ width: `${progressPct}%`, backgroundColor: 'var(--status-inhouse)' }}
                />
              </div>

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
                        className="relative w-full text-left rounded-xl border p-3.5 transition-colors flex items-start gap-3.5 hover:bg-[var(--bg-hover)]/60"
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
                            {!isCurrent && isOverdue && (
                              <StatusPill tone="amber">Проверить</StatusPill>
                            )}
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

              {completedItems.length > 0 && (
                <div className="pt-2 border-t border-[var(--border-subtle)] space-y-2">
                  <button
                    type="button"
                    onClick={() => setShowCompletedChecklist((v) => !v)}
                    className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] text-xs font-semibold text-[var(--text-secondary)] transition-colors"
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
                    <div className="divide-y divide-[var(--border-subtle)] border border-[var(--border-subtle)] rounded-xl bg-[var(--bg-elevated)] overflow-hidden">
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

            {/* Right Column: 12:00 Pre-Checkout Watch & E-mehmon Jump */}
            <section className="lg:col-span-5 space-y-5">
              <div className="ops-card p-5 space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Clock
                      className="w-4 h-4 shrink-0"
                      strokeWidth={1.75}
                      style={{ color: 'var(--tone-amber-fg)' }}
                    />
                    <h2 className="text-sm font-bold text-[var(--text-primary)]">
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
                          ? `${room.code} · ${bed.label}`
                          : room.code
                        : 'Номер';
                      const fin = calcBookingTotals(b);
                      const foreigner = b.guests.some((g) => g.isForeigner);

                      return (
                        <div
                          key={b.id}
                          className="p-3.5 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] space-y-2.5"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="text-sm font-bold text-[var(--text-primary)] truncate">
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
                              className="flex-1 h-9 px-3 rounded-lg bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-xs font-semibold text-[var(--text-primary)] transition-colors"
                            >
                              Счёт гостя
                            </button>
                            <button
                              type="button"
                              onClick={() => openCheckOutModal(b.id)}
                              className="flex-1 h-9 px-3 rounded-lg bg-[#D97706] hover:bg-[#B45309] text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors"
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
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-sm font-bold text-[var(--text-primary)]">
                    Контроль E-mehmon
                  </h2>
                  {registryCounts.unregistered_foreigners > 0 ? (
                    <StatusPill tone="rose" mono>
                      {registryCounts.unregistered_foreigners} без рег.
                    </StatusPill>
                  ) : (
                    <StatusPill tone="emerald" icon={ShieldCheck}>
                      Все оформлены
                    </StatusPill>
                  )}
                </div>
                <p className="text-xs text-[var(--text-muted)] leading-relaxed">
                  Откройте таблицу всех проживающих гостей, отфильтруйте иностранцев без E-mehmon и
                  скопируйте паспортные данные в 1 клик.
                </p>
                <div className="flex flex-col sm:flex-row gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setEmehmonFilter(
                        registryCounts.unregistered_foreigners > 0
                          ? 'unregistered_foreigners'
                          : 'all'
                      );
                      setShiftSubTab('emehmon');
                    }}
                    className="flex-1 h-10 px-3.5 rounded-lg bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] text-xs font-semibold text-[var(--text-primary)] border border-[var(--border-strong)] inline-flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <FileCheck2 className="w-4 h-4" strokeWidth={1.75} />
                    Открыть реестр E-mehmon
                  </button>
                  <button
                    type="button"
                    onClick={() => openCheckInModal()}
                    className="h-10 px-3.5 rounded-lg bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] text-xs font-semibold text-[var(--text-primary)] border border-[var(--border-subtle)] inline-flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <UserPlus className="w-4 h-4" strokeWidth={1.75} />
                    Заселить (N)
                  </button>
                </div>
              </div>
            </section>
          </div>
        </div>
      )}
    </div>
  );
};
