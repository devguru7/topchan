import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowRight,
  Banknote,
  BedDouble,
  Command,
  Mic,
  MicOff,
  Search,
  Sparkles,
  UserPlus,
  WashingMachine,
  X,
} from 'lucide-react';
import { useOps } from '../context/OpsContext';
import { COMMAND_PRESETS, parseRussianReceptionCommand } from '../utils/commandParser';
import { formatUsd, formatUzs } from '../utils/math';
import { useVoiceDictation } from '../hooks/useVoiceDictation';

export const CommandPalette: React.FC = () => {
  const {
    state,
    commandPaletteOpen,
    setCommandPaletteOpen,
    setActiveTab,
    openCheckInModal,
    setSelectedBookingId,
    commitParsedCommand,
    pushToast,
  } = useOps();

  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const voice = useVoiceDictation({
    onTranscript: (text) => setQuery(text),
    onStatusMessage: (msg, tone) => pushToast('Голосовой ввод', msg, tone),
  });

  useEffect(() => {
    if (commandPaletteOpen) {
      window.setTimeout(() => inputRef.current?.focus(), 40);
    } else {
      setQuery('');
      voice.stop();
    }
  }, [commandPaletteOpen, voice.stop]);

  const parsed = useMemo(() => {
    if (query.trim().length < 5) return null;
    return parseRussianReceptionCommand(
      query,
      state.physicalRooms,
      state.roomCategories,
      state.currency
    );
  }, [query, state.physicalRooms, state.roomCategories, state.currency]);

  const matchingBookings = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return state.bookings.filter((b) => b.status === 'active').slice(0, 4);
    return state.bookings
      .filter((b) => {
        if (b.status !== 'active') return false;
        const guestMatch = b.guests.some(
          (g) =>
            g.fullName.toLowerCase().includes(q) || g.passportNo.toLowerCase().includes(q)
        );
        const room = state.physicalRooms.find(
          (r) => r.id === b.segments[b.segments.length - 1]?.roomId
        );
        const roomMatch = room?.code.toLowerCase().includes(q);
        return guestMatch || roomMatch || b.bnovoId.toLowerCase().includes(q);
      })
      .slice(0, 4);
  }, [query, state.bookings, state.physicalRooms]);

  const handleCommit = () => {
    if (!parsed) return;
    const ok = commitParsedCommand(parsed);
    if (ok) setCommandPaletteOpen(false);
  };

  return (
    <AnimatePresence>
      {commandPaletteOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          style={{ backgroundColor: 'var(--backdrop-scrim)' }}
          className="fixed inset-0 z-50 backdrop-blur-xs flex items-start justify-center p-4 pt-[10vh] no-print"
          onClick={() => setCommandPaletteOpen(false)}
        >
          <motion.div
            initial={{ opacity: 0, y: -12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 300, damping: 28 }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Палитра команд Topchan Ops"
            className="w-full max-w-2xl bg-[var(--bg-surface)] border border-[var(--border-strong)] rounded-2xl shadow-xl overflow-hidden"
          >
            <div className="flex items-center gap-3 px-4 py-3.5 border-b border-[var(--border-subtle)]">
              <Search className="w-4 h-4 text-[var(--text-muted)] shrink-0" strokeWidth={1.75} />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && parsed) {
                    e.preventDefault();
                    handleCommit();
                  }
                }}
                placeholder="Команда («Смолл 3, Алекс Ким, 2 ночи, дал $50...») или поиск гостя..."
                className="flex-1 bg-transparent text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none"
              />
              <button
                type="button"
                onClick={voice.toggle}
                aria-label="Голосовая диктовка"
                style={
                  voice.isListening
                    ? {
                        backgroundColor: 'var(--tone-rose-bg)',
                        color: 'var(--tone-rose-fg)',
                        borderColor: 'var(--tone-rose-border)',
                      }
                    : undefined
                }
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap shrink-0 border ${
                  voice.isListening
                    ? ''
                    : 'bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border-[var(--border-subtle)]'
                }`}
              >
                {voice.isListening ? (
                  <MicOff className="w-3.5 h-3.5" strokeWidth={1.75} />
                ) : (
                  <Mic className="w-3.5 h-3.5" strokeWidth={1.75} />
                )}
                {voice.isListening ? 'Стоп...' : 'Голос'}
              </button>
              <button
                type="button"
                aria-label="Закрыть палитру"
                onClick={() => setCommandPaletteOpen(false)}
                className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded-xl"
              >
                <X className="w-4 h-4" strokeWidth={1.75} />
              </button>
            </div>

            {voice.isListening && (
              <div
                className="px-4 py-2 border-b text-xs flex items-center gap-2"
                style={{
                  backgroundColor: 'var(--tone-rose-bg)',
                  borderColor: 'var(--tone-rose-border)',
                  color: 'var(--tone-rose-fg)',
                }}
              >
                <span
                  className="w-2 h-2 rounded-full animate-ping"
                  style={{ backgroundColor: 'var(--tone-rose-fg)' }}
                />
                <span>Диктовка (ru-RU){voice.interimText ? `: ${voice.interimText}` : '...'}</span>
              </div>
            )}

            <div className="p-4 space-y-4 max-h-[70vh] overflow-y-auto">
              {/* Parsed Quick Command Preview */}
              {parsed && (
                <div
                  className="rounded-xl p-4 space-y-3 border"
                  style={{
                    backgroundColor: 'var(--bg-elevated)',
                    borderColor: 'var(--tone-cobalt-border)',
                  }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div
                      className="flex items-center gap-2 text-xs font-semibold"
                      style={{ color: 'var(--tone-cobalt-fg)' }}
                    >
                      <Sparkles className="w-3.5 h-3.5" strokeWidth={1.75} />
                      <span>Автопилот готов провести операцию</span>
                    </div>
                    <span className="text-xs text-[var(--text-muted)] tabular-nums">
                      {parsed.confidenceNote}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                    <div>
                      <div className="text-[var(--text-muted)]">Номер и гость</div>
                      <div className="text-[var(--text-primary)] font-semibold mt-0.5">
                        {parsed.roomLabel}
                      </div>
                      <div className="text-[var(--text-secondary)]">{parsed.guestName}</div>
                    </div>
                    <div>
                      <div className="text-[var(--text-muted)]">Итого к оплате</div>
                      <div className="text-[var(--text-primary)] font-semibold font-mono tabular-nums mt-0.5">
                        {formatUsd(parsed.totalUsd)}
                      </div>
                      <div className="text-[var(--text-muted)]">
                        {parsed.nights} н.
                        {parsed.extras.length > 0 ? ` + ${parsed.extras.length} доп.` : ''}
                      </div>
                    </div>
                    <div>
                      <div className="text-[var(--text-muted)]">Внесено</div>
                      <div
                        className="font-semibold font-mono tabular-nums mt-0.5"
                        style={{ color: 'var(--tone-emerald-fg)' }}
                      >
                        {parsed.paidAmount > 0
                          ? `${parsed.paidAmount} ${parsed.paidCurrency}`
                          : 'Без оплаты'}
                      </div>
                    </div>
                    <div>
                      <div className="text-[var(--text-muted)]">
                        {parsed.debtUsd > 0 ? 'Остаток долга' : 'Сдача'}
                      </div>
                      <div
                        className="font-semibold font-mono tabular-nums mt-0.5"
                        style={{
                          color:
                            parsed.debtUsd > 0
                              ? 'var(--tone-rose-fg)'
                              : 'var(--tone-amber-fg)',
                        }}
                      >
                        {parsed.debtUsd > 0
                          ? formatUsd(parsed.debtUsd)
                          : parsed.changeUzs > 0
                            ? formatUzs(parsed.changeUzs)
                            : parsed.changeUsd > 0
                              ? formatUsd(parsed.changeUsd)
                              : 'Ровно в 0'}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleCommit}
                    className="w-full py-2.5 px-4 rounded-xl bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2"
                  >
                    Подтвердить и провести в 1 клик
                    <ArrowRight className="w-4 h-4" strokeWidth={1.75} />
                  </button>
                </div>
              )}

              {/* Presets */}
              <div className="space-y-2">
                <div className="text-xs font-medium text-[var(--text-muted)]">
                  Примеры быстрых команд
                </div>
                <div className="flex flex-col gap-1.5">
                  {COMMAND_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setQuery(preset)}
                      className="text-left px-3 py-2 rounded-xl bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              </div>

              {/* Quick actions */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setCommandPaletteOpen(false);
                    openCheckInModal();
                  }}
                  className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] text-xs font-semibold text-[var(--text-primary)] border border-[var(--border-subtle)] transition-colors"
                >
                  <UserPlus
                    className="w-3.5 h-3.5 shrink-0"
                    strokeWidth={1.75}
                    style={{ color: 'var(--tone-emerald-fg)' }}
                  />
                  <span className="truncate">Заселить гостя</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab('grid');
                    setCommandPaletteOpen(false);
                  }}
                  className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] text-xs font-semibold text-[var(--text-primary)] border border-[var(--border-subtle)] transition-colors"
                >
                  <BedDouble
                    className="w-3.5 h-3.5 shrink-0"
                    strokeWidth={1.75}
                    style={{ color: 'var(--tone-cobalt-fg)' }}
                  />
                  <span className="truncate">Шахматка</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab('cash');
                    setCommandPaletteOpen(false);
                  }}
                  className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] text-xs font-semibold text-[var(--text-primary)] border border-[var(--border-subtle)] transition-colors"
                >
                  <Banknote
                    className="w-3.5 h-3.5 shrink-0"
                    strokeWidth={1.75}
                    style={{ color: 'var(--tone-amber-fg)' }}
                  />
                  <span className="truncate">Касса</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab('services');
                    setCommandPaletteOpen(false);
                  }}
                  className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] text-xs font-semibold text-[var(--text-primary)] border border-[var(--border-subtle)] transition-colors"
                >
                  <WashingMachine
                    className="w-3.5 h-3.5 shrink-0"
                    strokeWidth={1.75}
                    style={{ color: 'var(--tone-cobalt-fg)' }}
                  />
                  <span className="truncate">Стирка и QR</span>
                </button>
              </div>

              {/* Active guests */}
              {matchingBookings.length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-xs font-medium text-[var(--text-muted)]">
                    Открыть счёт гостя
                  </div>
                  <div className="divide-y divide-[var(--border-subtle)] border border-[var(--border-subtle)] rounded-xl overflow-hidden bg-[var(--bg-elevated)]">
                    {matchingBookings.map((b) => {
                      const room = state.physicalRooms.find(
                        (r) => r.id === b.segments[b.segments.length - 1]?.roomId
                      );
                      return (
                        <button
                          key={b.id}
                          type="button"
                          onClick={() => {
                            setActiveTab('grid');
                            setSelectedBookingId(b.id);
                            setCommandPaletteOpen(false);
                          }}
                          className="w-full px-3.5 py-2.5 flex items-center justify-between hover:bg-[var(--bg-hover)] transition-colors text-left"
                        >
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-[var(--text-primary)] truncate">
                              {b.guests.map((g) => g.fullName).join(', ')}
                            </div>
                            <div className="text-xs text-[var(--text-muted)] font-mono tabular-nums">
                              {room?.code} · {b.bnovoId}
                            </div>
                          </div>
                          <ArrowRight
                            className="w-4 h-4 text-[var(--text-muted)] shrink-0"
                            strokeWidth={1.75}
                          />
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <div className="px-4 py-2.5 bg-[var(--bg-elevated)] border-t border-[var(--border-subtle)] flex items-center justify-between text-xs text-[var(--text-muted)]">
              <div className="flex items-center gap-1.5">
                <Command className="w-3.5 h-3.5" strokeWidth={1.75} />
                <span>⌘K / Ctrl+K — быстрый вызов · 1–5 разделы · N заезд</span>
              </div>
              <span>Esc — закрыть</span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
