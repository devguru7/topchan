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
      setTimeout(() => inputRef.current?.focus(), 40);
    } else {
      setQuery('');
      voice.stop();
    }
  }, [commandPaletteOpen, voice.stop]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandPaletteOpen((open) => !open);
      } else if (e.key === 'Escape' && commandPaletteOpen) {
        setCommandPaletteOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [commandPaletteOpen, setCommandPaletteOpen]);

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
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-start justify-center p-4 pt-[10vh]"
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
            className="w-full max-w-2xl bg-[#121826] border border-white/[0.12] rounded-2xl shadow-2xl overflow-hidden"
          >
            <div className="flex items-center gap-3 px-4 py-3.5 border-b border-white/[0.08]">
              <Search className="w-4 h-4 text-slate-400 shrink-0" />
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
                className="flex-1 bg-transparent text-sm text-white placeholder:text-slate-500 focus:outline-none"
              />
              <button
                type="button"
                onClick={voice.toggle}
                aria-label="Голосовая диктовка"
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  voice.isListening
                    ? 'bg-[#F43F5E]/20 text-[#F43F5E] border border-[#F43F5E]/40'
                    : 'bg-[#1A2234] text-slate-300 hover:text-white border border-white/[0.08]'
                }`}
              >
                {voice.isListening ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
                {voice.isListening ? 'Стоп...' : 'Голос'}
              </button>
              <button
                type="button"
                aria-label="Закрыть палитру"
                onClick={() => setCommandPaletteOpen(false)}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {voice.isListening && (
              <div className="px-4 py-2 bg-[#F43F5E]/10 border-b border-[#F43F5E]/25 text-xs text-rose-200 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-[#F43F5E] animate-ping" />
                <span>Диктовка (ru-RU){voice.interimText ? `: ${voice.interimText}` : '...'}</span>
              </div>
            )}

            <div className="p-4 space-y-4 max-h-[70vh] overflow-y-auto">
              {/* Parsed Zero-Typing preview */}
              {parsed && (
                <div className="bg-[#0B0F17] border border-[#3B82F6]/30 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs font-medium text-[#3B82F6]">
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>Автопилот готов провести команду</span>
                    </div>
                    <span className="text-xs text-slate-400 tabular-nums">
                      {parsed.confidenceNote}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                    <div>
                      <div className="text-slate-400">Номер и гость</div>
                      <div className="text-white font-semibold mt-0.5">{parsed.roomLabel}</div>
                      <div className="text-slate-300">{parsed.guestName}</div>
                    </div>
                    <div>
                      <div className="text-slate-400">Итого к оплате</div>
                      <div className="text-white font-semibold font-mono tabular-nums mt-0.5">
                        {formatUsd(parsed.totalUsd)}
                      </div>
                      <div className="text-slate-400">
                        {parsed.nights} н.
                        {parsed.extras.length > 0 ? ` + ${parsed.extras.length} доп.` : ''}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-400">Внесено</div>
                      <div className="text-[#10B981] font-semibold font-mono tabular-nums mt-0.5">
                        {parsed.paidAmount > 0
                          ? `${parsed.paidAmount} ${parsed.paidCurrency}`
                          : 'Без оплаты'}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-400">
                        {parsed.debtUsd > 0 ? 'Остаток долга' : 'Сдача'}
                      </div>
                      <div
                        className={`font-semibold font-mono tabular-nums mt-0.5 ${
                          parsed.debtUsd > 0 ? 'text-[#F43F5E]' : 'text-[#F59E0B]'
                        }`}
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
                    className="w-full py-2.5 px-4 rounded-lg bg-[#3B82F6] hover:bg-blue-500 text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2"
                  >
                    Подтвердить и провести в 1 клик
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              )}

              {/* Presets */}
              <div className="space-y-2">
                <div className="text-xs font-medium text-slate-400">Примеры голосовых команд</div>
                <div className="flex flex-col gap-1.5">
                  {COMMAND_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setQuery(preset)}
                      className="text-left px-3 py-2 rounded-lg bg-[#0B0F17] hover:bg-[#1A2234] border border-white/[0.06] text-xs text-slate-200 transition-colors"
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
                  className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-[#1A2234] hover:bg-slate-700/70 text-xs font-medium text-white border border-white/[0.06] transition-colors"
                >
                  <UserPlus className="w-3.5 h-3.5 text-[#10B981] shrink-0" />
                  <span className="truncate">Новое заселение</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab('grid');
                    setCommandPaletteOpen(false);
                  }}
                  className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-[#1A2234] hover:bg-slate-700/70 text-xs font-medium text-white border border-white/[0.06] transition-colors"
                >
                  <BedDouble className="w-3.5 h-3.5 text-[#3B82F6] shrink-0" />
                  <span className="truncate">Шахматка</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab('cash');
                    setCommandPaletteOpen(false);
                  }}
                  className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-[#1A2234] hover:bg-slate-700/70 text-xs font-medium text-white border border-white/[0.06] transition-colors"
                >
                  <Banknote className="w-3.5 h-3.5 text-[#F59E0B] shrink-0" />
                  <span className="truncate">Касса (6 карманов)</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab('services');
                    setCommandPaletteOpen(false);
                  }}
                  className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-[#1A2234] hover:bg-slate-700/70 text-xs font-medium text-white border border-white/[0.06] transition-colors"
                >
                  <WashingMachine className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                  <span className="truncate">Стирка и QR</span>
                </button>
              </div>

              {/* Active guests */}
              {matchingBookings.length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-xs font-medium text-slate-400">Активные гости</div>
                  <div className="divide-y divide-white/[0.06] border border-white/[0.06] rounded-xl overflow-hidden bg-[#0B0F17]">
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
                          className="w-full px-3.5 py-2.5 flex items-center justify-between hover:bg-[#1A2234] transition-colors text-left"
                        >
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-white truncate">
                              {b.guests.map((g) => g.fullName).join(', ')}
                            </div>
                            <div className="text-xs text-slate-400">
                              {room?.code} · {b.bnovoId}
                            </div>
                          </div>
                          <ArrowRight className="w-4 h-4 text-slate-500 shrink-0" />
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <div className="px-4 py-2.5 bg-[#0B0F17] border-t border-white/[0.08] flex items-center justify-between text-xs text-slate-400">
              <div className="flex items-center gap-1.5">
                <Command className="w-3.5 h-3.5" />
                <span>Ctrl+K / Cmd+K — вызов из любого раздела</span>
              </div>
              <span>Esc — закрыть</span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
