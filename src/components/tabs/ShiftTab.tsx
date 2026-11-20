import React, { useMemo, useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  Circle,
  Clock,
  DoorOpen,
  Mic,
  ScanLine,
  Sparkles,
  UserPlus,
} from 'lucide-react';
import { useOps } from '../../context/OpsContext';
import { COMMAND_PRESETS, parseRussianReceptionCommand } from '../../utils/commandParser';
import { calcBookingTotals, formatUsd, formatUzs } from '../../utils/math';

export const ShiftTab: React.FC = () => {
  const {
    state,
    commitParsedCommand,
    toggleChecklistItem,
    openCheckInModal,
    openCheckOutModal,
    setSelectedBookingId,
    pushToast,
  } = useOps();

  const [commandText, setCommandText] = useState('');
  const [isDictating, setIsDictating] = useState(false);

  const parsed = useMemo(() => {
    if (commandText.trim().length < 4) return null;
    return parseRussianReceptionCommand(
      commandText,
      state.physicalRooms,
      state.roomCategories,
      state.currency
    );
  }, [commandText, state.physicalRooms, state.roomCategories, state.currency]);

  const completedChecklistCount = state.shiftChecklist.filter((c) => c.done).length;
  const checkoutsToday = state.bookings.filter(
    (b) => b.status === 'active' && b.checkingOutToday
  );

  const handleVoiceSimulate = () => {
    setIsDictating(true);
    pushToast('Диктовка активна', 'Симуляция распознавания речи администратора...', 'cobalt');
    window.setTimeout(() => {
      setCommandText(COMMAND_PRESETS[0]);
      setIsDictating(false);
    }, 650);
  };

  const handleCommit = () => {
    if (!parsed) return;
    commitParsedCommand(parsed);
    setCommandText('');
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white">
            Смена и Автопилот ресепшна
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 mt-0.5">
            Голосовые команды в 1 клик · регламент смены 08:00–00:00 · сканер MRZ и Check-out Guard
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => openCheckInModal()}
            className="px-4 py-2.5 rounded-lg bg-[#10B981] hover:bg-emerald-600 text-slate-950 text-sm font-semibold inline-flex items-center gap-2 whitespace-nowrap shrink-0 transition-colors"
          >
            <ScanLine className="w-4 h-4" />
            Check-in + MRZ
          </button>
        </div>
      </div>

      {/* Zero-Typing Voice/Text Command Bar */}
      <section className="bg-[#121826] border border-white/[0.08] rounded-2xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-[#3B82F6]" />
            <h2 className="text-sm font-semibold text-white">
              Zero-Typing командная строка (без ручных форм)
            </h2>
          </div>
          <span className="text-xs text-slate-400">
            Автопарсер комнаты, ночей, оплаты, сдачи (Ex {state.currency.exRate}) и стирки
          </span>
        </div>

        <div className="flex flex-col sm:flex-row gap-2.5">
          <input
            type="text"
            aria-label="Командная строка автопилота"
            value={commandText}
            onChange={(e) => setCommandText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && parsed) {
                e.preventDefault();
                handleCommit();
              }
            }}
            placeholder="Например: Смолл 3, Алекс Ким, 2 ночи, дал $50, сдача сумами, быстрая стирка"
            className="flex-1 bg-[#0B0F17] border border-white/[0.1] rounded-xl px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-[#3B82F6]"
          />
          <button
            type="button"
            onClick={handleVoiceSimulate}
            className={`px-4 py-3 rounded-xl text-sm font-medium inline-flex items-center justify-center gap-2 whitespace-nowrap shrink-0 transition-colors border ${
              isDictating
                ? 'bg-[#F43F5E]/20 text-[#F43F5E] border-[#F43F5E]/40'
                : 'bg-[#1A2234] hover:bg-slate-700 text-white border-white/[0.08]'
            }`}
          >
            <Mic className="w-4 h-4" />
            {isDictating ? 'Запись...' : 'Диктовка'}
          </button>
        </div>

        {/* 3 Clickable Realistic Presets */}
        <div className="flex flex-wrap gap-2">
          {COMMAND_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => setCommandText(preset)}
              className="text-left px-3 py-1.5 rounded-lg bg-[#0B0F17] hover:bg-[#1A2234] border border-white/[0.08] text-xs text-slate-300 hover:text-white transition-colors"
            >
              {preset}
            </button>
          ))}
        </div>

        {/* Interactive 1-Click Confirmation Card */}
        {parsed && (
          <div className="bg-[#0B0F17] border border-[#3B82F6]/40 rounded-xl p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-white/[0.06]">
              <div>
                <div className="text-xs font-semibold text-[#3B82F6]">
                  Карточка подтверждения в 1 клик
                </div>
                <div className="text-xs text-slate-400 mt-0.5">{parsed.confidenceNote}</div>
              </div>
              <div className="text-xs font-mono tabular-nums text-slate-300">
                Курс сдачи Ex: {state.currency.exRate.toLocaleString('ru-RU')} сум
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
              <div>
                <div className="text-slate-400">Комната и гость</div>
                <div className="text-sm font-semibold text-white mt-1">{parsed.roomLabel}</div>
                <div className="text-slate-300 mt-0.5">{parsed.guestName}</div>
              </div>
              <div>
                <div className="text-slate-400">Проживание и допы</div>
                <div className="text-sm font-semibold font-mono tabular-nums text-white mt-1">
                  {parsed.nights} н. × {formatUsd(parsed.nightlyRateUsd)} ={' '}
                  {formatUsd(parsed.totalUsd)}
                </div>
                <div className="text-slate-300 mt-0.5">
                  {parsed.extras.length > 0
                    ? parsed.extras.map((e) => `${e.label} ($${e.priceUsd})`).join(', ')
                    : 'Без доп. услуг'}
                </div>
              </div>
              <div>
                <div className="text-slate-400">Принято в кассу</div>
                <div className="text-sm font-semibold font-mono tabular-nums text-[#10B981] mt-1">
                  {parsed.paidAmount > 0
                    ? `${parsed.paidAmount} ${parsed.paidCurrency}`
                    : 'Без оплаты'}
                </div>
                <div className="text-slate-400 mt-0.5">
                  Карман: Нал {parsed.paidCurrency}
                </div>
              </div>
              <div>
                <div className="text-slate-400">
                  {parsed.debtUsd > 0 ? 'Останется долг' : 'Выдать сдачу'}
                </div>
                <div
                  className={`text-sm font-semibold font-mono tabular-nums mt-1 ${
                    parsed.debtUsd > 0 ? 'text-[#F43F5E]' : 'text-[#F59E0B]'
                  }`}
                >
                  {parsed.debtUsd > 0
                    ? formatUsd(parsed.debtUsd)
                    : parsed.changeUzs > 0
                      ? formatUzs(parsed.changeUzs)
                      : parsed.changeUsd > 0
                        ? formatUsd(parsed.changeUsd)
                        : 'Без сдачи (0)'}
                </div>
                <div className="text-slate-400 mt-0.5">
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
                className="px-4 py-2 rounded-lg bg-[#1A2234] hover:bg-slate-700 text-xs font-medium text-slate-300"
              >
                Очистить
              </button>
              <button
                type="button"
                onClick={handleCommit}
                className="px-5 py-2.5 rounded-lg bg-[#3B82F6] hover:bg-blue-500 text-white text-sm font-semibold inline-flex items-center gap-2 transition-colors"
              >
                Подтвердить и провести
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Main 2-Column Split: 24-Hour Checklist + Check-out Queue */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* 24-Hour Topchan Shift Timeline */}
        <section className="lg:col-span-7 bg-[#121826] border border-white/[0.08] rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-white">
                Регламент смены Topchan (08:00 → 00:00)
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Кликайте по пунктам для фиксации выполнения
              </p>
            </div>
            <span className="text-xs font-mono tabular-nums text-[#10B981]">
              {completedChecklistCount} / {state.shiftChecklist.length}
            </span>
          </div>

          <div className="divide-y divide-white/[0.06] border border-white/[0.08] rounded-xl bg-[#0B0F17] overflow-hidden">
            {state.shiftChecklist.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => toggleChecklistItem(item.id)}
                className="w-full text-left px-4 py-3.5 hover:bg-[#1A2234] transition-colors flex items-start gap-3.5"
              >
                <span className="font-mono tabular-nums text-xs font-semibold text-[#3B82F6] w-11 shrink-0 pt-0.5">
                  {item.time}
                </span>
                <div className="min-w-0 flex-1">
                  <div
                    className={`text-sm font-medium ${
                      item.done ? 'line-through text-slate-400' : 'text-white'
                    }`}
                  >
                    {item.title}
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">
                    {item.description}
                  </p>
                </div>
                <div className="shrink-0 flex flex-col items-end gap-1">
                  {item.done ? (
                    <CheckCircle2 className="w-5 h-5 text-[#10B981]" />
                  ) : (
                    <Circle className="w-5 h-5 text-slate-600" />
                  )}
                  {item.doneAt && (
                    <span className="text-xs font-mono tabular-nums text-slate-500">
                      {item.doneAt}
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
        </section>

        {/* Right Column: 12:00 Pre-Checkout Watch & Quick Launchers */}
        <section className="lg:col-span-5 space-y-5">
          <div className="bg-[#121826] border border-white/[0.08] rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-[#F59E0B]" />
                <h2 className="text-sm font-semibold text-white">
                  Выезды сегодня в 12:00 ({checkoutsToday.length})
                </h2>
              </div>
            </div>

            {checkoutsToday.length === 0 ? (
              <div className="p-5 rounded-xl bg-[#0B0F17] border border-white/[0.06] text-center text-xs text-slate-400">
                Все гости на 12:00 уже выселены.
              </div>
            ) : (
              <div className="space-y-2.5">
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
                      className="p-3.5 rounded-xl bg-[#0B0F17] border border-white/[0.08] space-y-2.5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="text-sm font-semibold text-white">{roomLabel}</div>
                          <div className="text-xs text-slate-300">
                            {b.guests.map((g) => `${g.fullName} (${g.citizenship})`).join(', ')}
                          </div>
                        </div>
                        <span
                          className={`text-xs font-mono tabular-nums font-semibold ${
                            fin.debtUsd > 0 ? 'text-[#F43F5E]' : 'text-[#10B981]'
                          }`}
                        >
                          {fin.debtUsd > 0 ? `Долг ${formatUsd(fin.debtUsd)}` : 'Оплачено'}
                        </span>
                      </div>
                      {foreigner && (
                        <div className="text-xs text-[#F59E0B]">
                          Иностранец — распечатать квиток E-mehmon при выезде
                        </div>
                      )}
                      <div className="flex items-center gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => setSelectedBookingId(b.id)}
                          className="flex-1 py-2 px-3 rounded-lg bg-[#1A2234] hover:bg-slate-700 text-xs font-medium text-slate-200 transition-colors"
                        >
                          Фолио / Оплата
                        </button>
                        <button
                          type="button"
                          onClick={() => openCheckOutModal(b.id)}
                          className="flex-1 py-2 px-3 rounded-lg bg-[#F59E0B] hover:bg-amber-600 text-slate-950 text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors"
                        >
                          <DoorOpen className="w-3.5 h-3.5" />
                          Check-out Guard
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="bg-[#121826] border border-white/[0.08] rounded-2xl p-5 space-y-3">
            <h2 className="text-sm font-semibold text-white">Быстрый запуск протоколов</h2>
            <p className="text-xs text-slate-400 leading-relaxed">
              Открывайте форму заселения со встроенным сканером 2-строчного MRZ паспорта, копируйте
              JSON для E-mehmon и памятку гостю (Wi-Fi: {state.integrations.wifiPass}, дверь:{' '}
              {state.integrations.doorCode}).
            </p>
            <button
              type="button"
              onClick={() => openCheckInModal()}
              className="w-full py-2.5 px-4 rounded-xl bg-[#1A2234] hover:bg-slate-700 text-sm font-medium text-white border border-white/[0.08] inline-flex items-center justify-center gap-2 transition-colors"
            >
              <UserPlus className="w-4 h-4 text-[#10B981]" />
              Открыть Check-in со сканером MRZ
            </button>
          </div>
        </section>
      </div>
    </div>
  );
};
