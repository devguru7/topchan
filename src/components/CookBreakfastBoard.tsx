import React, { useMemo } from 'react';
import {
  AlertTriangle,
  BedDouble,
  CalendarClock,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Coffee,
  Printer,
  Sunrise,
  Users,
  UtensilsCrossed,
} from 'lucide-react';
import { useOps } from '../context/OpsContext';
import {
  computeBreakfastForecast,
  DIETARY_TAG_LABELS,
} from '../utils/breakfastForecast';
import { getTashkentTodayIso } from '../utils/time';
import { StatusPill } from './ui';

function sanitizeKitchenNote(note?: string): string {
  if (!note) return '';
  return note
    .replace(/\(\s*\$[\d.,]+\s*\)/g, '')
    .replace(/\$[\d.,]+/g, '')
    .replace(/\b\d[\d\s.,]*\s*(USD|UZS|EUR|сум(?:ов)?)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function formatPortionLabel(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} порция`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} порции`;
  return `${count} порций`;
}

export const CookBreakfastBoard: React.FC = () => {
  const { state, serveLateBreakfastOrder, toggleKitchenChecklistItem } = useOps();

  const targetDateIso = state.operationalDate || getTashkentTodayIso();

  const forecast = useMemo(
    () => computeBreakfastForecast(state, targetDateIso),
    [state, targetDateIso]
  );

  const lateOrders = useMemo(() => {
    const list = state.lateBreakfastOrders ?? [];
    return [...list].sort((a, b) => {
      if (a.status !== b.status) return a.status === 'pending' ? -1 : 1;
      return a.requestedAt.localeCompare(b.requestedAt);
    });
  }, [state.lateBreakfastOrders]);

  const pendingLateCount = lateOrders.filter((o) => o.status === 'pending').length;
  const kitchenChecklist = state.kitchenChecklist ?? [];
  const checklistDoneCount = kitchenChecklist.filter((i) => i.done).length;

  const privateInHouse = useMemo(
    () => forecast.inHouseNow.rooms.filter((r) => !r.isDorm),
    [forecast.inHouseNow.rooms]
  );
  const dormInHouse = useMemo(
    () => forecast.inHouseNow.rooms.filter((r) => r.isDorm),
    [forecast.inHouseNow.rooms]
  );

  const todayPortionsRange =
    forecast.todayBreakfastEstimate.minPortions === forecast.todayBreakfastEstimate.maxPortions
      ? String(forecast.todayBreakfastEstimate.minPortions)
      : `${forecast.todayBreakfastEstimate.minPortions}–${forecast.todayBreakfastEstimate.maxPortions}`;

  const handlePrintKitchenSheet = () => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    const prevTarget = document.body.dataset.printTarget;
    document.body.dataset.printTarget = 'kitchen-sheet';

    const cleanup = () => {
      if (prevTarget) {
        document.body.dataset.printTarget = prevTarget;
      } else {
        delete document.body.dataset.printTarget;
      }
      window.removeEventListener('afterprint', cleanup);
    };

    window.addEventListener('afterprint', cleanup);
    window.print();
    window.setTimeout(cleanup, 1500);
  };

  return (
    <div className="space-y-5" data-testid="cook-breakfast-board">
      {/* Top Board Header + Print Action */}
      <div className="flex flex-wrap items-center justify-between gap-3 no-print">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <UtensilsCrossed
              className="w-5 h-5 shrink-0"
              strokeWidth={1.75}
              style={{ color: 'var(--brand-primary)' }}
            />
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[var(--text-primary)]">
              Кухня и завтраки · Topchan
            </h1>
          </div>
          <p className="text-xs sm:text-sm text-[var(--text-muted)] mt-0.5">
            Бесплатный завтрак 08:00–10:00 · Дата смены:{' '}
            <span className="font-mono tabular-nums font-semibold text-[var(--text-secondary)]">
              {forecast.targetDateIso}
            </span>
          </p>
        </div>

        <button
          type="button"
          data-testid="print-kitchen-sheet-btn"
          onClick={handlePrintKitchenSheet}
          className="min-h-[44px] px-4 py-2.5 rounded-xl bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] border border-[var(--border-strong)] text-xs sm:text-sm font-semibold text-[var(--text-primary)] inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0"
        >
          <Printer
            className="w-4 h-4 shrink-0"
            strokeWidth={1.75}
            style={{ color: 'var(--brand-primary)' }}
          />
          Печать листа кухни
        </button>
      </div>

      {/* 4 Large Live KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3.5 no-print">
        {/* KPI 1: Today's Breakfast Portions */}
        <div
          data-testid="kpi-today-breakfast"
          className="ops-card p-4 sm:p-5 flex flex-col justify-between gap-3"
          style={{ borderLeft: '3px solid var(--brand-primary)' }}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-[var(--text-secondary)]">
              Сегодня на завтрак
            </span>
            <span
              className="text-[11px] font-mono tabular-nums font-semibold px-2 py-0.5 rounded-md border"
              style={{
                backgroundColor: 'var(--brand-primary-soft)',
                borderColor: 'var(--brand-primary)',
                color: 'var(--brand-primary)',
              }}
            >
              08:00–10:00
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl sm:text-4xl font-bold font-mono tabular-nums text-[var(--text-primary)] leading-none">
              {todayPortionsRange}
            </span>
            <span className="text-xs font-medium text-[var(--text-muted)]">порций</span>
          </div>
          <div className="text-xs text-[var(--text-secondary)] leading-relaxed">
            В отеле{' '}
            <span className="font-mono tabular-nums font-semibold text-[var(--text-primary)]">
              {forecast.inHouseNow.totalGuests}
            </span>{' '}
            (вкл. выезд 12:00)
            {forecast.arrivingToday.earlyArrivalsBefore10 > 0 ? (
              <>
                {' '}
                +{' '}
                <span
                  className="font-mono tabular-nums font-semibold"
                  style={{ color: 'var(--brand-primary)' }}
                >
                  {forecast.arrivingToday.earlyArrivalsBefore10}
                </span>{' '}
                ранних до 10:00
              </>
            ) : (
              ' · ранних до 10:00 нет'
            )}
          </div>
        </div>

        {/* KPI 2: Currently In-House */}
        <div
          data-testid="kpi-in-house"
          className="ops-card p-4 sm:p-5 flex flex-col justify-between gap-3"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-[var(--text-secondary)]">
              Сейчас в отеле
            </span>
            <Users
              className="w-4 h-4 shrink-0"
              strokeWidth={1.75}
              style={{ color: 'var(--tone-emerald-fg)' }}
            />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl sm:text-4xl font-bold font-mono tabular-nums text-[var(--text-primary)] leading-none">
              {forecast.inHouseNow.totalGuests}
            </span>
            <span className="text-xs font-medium text-[var(--text-muted)]">гостей</span>
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--text-secondary)]">
            <span className="font-mono tabular-nums">
              Взрослые: <strong className="text-[var(--text-primary)]">{forecast.inHouseNow.adultsCount}</strong>
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">
              Дети &lt;16: <strong className="text-[var(--text-primary)]">{forecast.inHouseNow.childrenCount}</strong>
            </span>
            <span aria-hidden="true">·</span>
            <span
              className="font-mono tabular-nums font-semibold"
              style={{ color: 'var(--tone-amber-fg)' }}
            >
              Выезд 12:00: {forecast.inHouseNow.checkingOutTodayCount}
            </span>
          </div>
        </div>

        {/* KPI 3: Arriving Today */}
        <div
          data-testid="kpi-arriving-today"
          className="ops-card p-4 sm:p-5 flex flex-col justify-between gap-3"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-[var(--text-secondary)]">
              Приедут сегодня по броням
            </span>
            <CalendarClock
              className="w-4 h-4 shrink-0"
              strokeWidth={1.75}
              style={{ color: 'var(--tone-cobalt-fg)' }}
            />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl sm:text-4xl font-bold font-mono tabular-nums text-[var(--text-primary)] leading-none">
              {forecast.arrivingToday.totalGuests}
            </span>
            <span className="text-xs font-medium text-[var(--text-muted)]">чел.</span>
          </div>
          <div className="grid grid-cols-2 gap-1.5 text-xs">
            <div
              className="px-2 py-1 rounded-lg border"
              style={{
                backgroundColor: 'var(--tone-amber-bg)',
                borderColor: 'var(--tone-amber-border)',
              }}
            >
              <div className="text-[11px] text-[var(--text-secondary)] leading-tight">До 10:00</div>
              <div
                className="font-mono tabular-nums font-bold text-sm"
                style={{ color: 'var(--tone-amber-fg)' }}
              >
                {forecast.arrivingToday.earlyArrivalsBefore10}
              </div>
            </div>
            <div className="px-2 py-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)]">
              <div className="text-[11px] text-[var(--text-muted)] leading-tight">После 10:00</div>
              <div className="font-mono tabular-nums font-bold text-sm text-[var(--text-primary)]">
                {forecast.arrivingToday.standardArrivals}
              </div>
            </div>
          </div>
        </div>

        {/* KPI 4: Tomorrow Morning Forecast */}
        <div
          data-testid="kpi-tomorrow-forecast"
          className="ops-card p-4 sm:p-5 flex flex-col justify-between gap-3"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-[var(--text-secondary)]">
              Прогноз на завтра утром
            </span>
            <Sunrise
              className="w-4 h-4 shrink-0"
              strokeWidth={1.75}
              style={{ color: 'var(--brand-primary)' }}
            />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl sm:text-4xl font-bold font-mono tabular-nums text-[var(--text-primary)] leading-none">
              {forecast.tomorrowBreakfastEstimate.totalPortions}
            </span>
            <span className="text-xs font-medium text-[var(--text-muted)]">на закуп</span>
          </div>
          <div className="text-xs text-[var(--text-secondary)] leading-relaxed">
            Остаются:{' '}
            <span className="font-mono tabular-nums font-semibold text-[var(--text-primary)]">
              {forecast.tomorrowBreakfastEstimate.stayingInHouseCount}
            </span>{' '}
            + заезд сегодня:{' '}
            <span className="font-mono tabular-nums font-semibold text-[var(--text-primary)]">
              {forecast.tomorrowBreakfastEstimate.arrivingTodayCount}
            </span>
          </div>
        </div>
      </div>

      {/* Dietary Alerts Strip */}
      <section
        data-testid="dietary-alerts-strip"
        className="ops-card p-4 sm:p-5 space-y-3 no-print"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <AlertTriangle
              className="w-4 h-4 shrink-0"
              strokeWidth={1.75}
              style={{ color: 'var(--tone-amber-fg)' }}
            />
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">
              Диеты, Халяль и аллергии (утренний стол)
            </h2>
          </div>
          <span className="text-xs text-[var(--text-muted)]">
            {forecast.dietarySummary.length > 0 || forecast.dietaryNotesList.length > 0
              ? 'Учтите при сервировке'
              : 'Особых ограничений нет'}
          </span>
        </div>

        {forecast.dietarySummary.length === 0 && forecast.dietaryNotesList.length === 0 ? (
          <div className="px-3.5 py-2.5 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-xs text-[var(--text-secondary)]">
            Все гости на стандартном меню (без отмеченных аллергий и спецдиет).
          </div>
        ) : (
          <div className="space-y-2.5">
            {forecast.dietarySummary.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {forecast.dietarySummary.map((item) => {
                  const isAllergy = item.tag === 'allergy';
                  return (
                    <div
                      key={item.tag}
                      className="px-3 py-2 rounded-xl border flex items-center gap-2 text-xs"
                      style={
                        isAllergy
                          ? {
                              backgroundColor: 'var(--tone-rose-bg)',
                              borderColor: 'var(--tone-rose-border)',
                              color: 'var(--tone-rose-fg)',
                            }
                          : {
                              backgroundColor: 'var(--tone-amber-bg)',
                              borderColor: 'var(--tone-amber-border)',
                              color: 'var(--tone-amber-fg)',
                            }
                      }
                    >
                      <span className="font-bold">{item.label}</span>
                      <span className="font-mono tabular-nums font-bold px-1.5 py-0.5 rounded bg-[var(--bg-surface)] text-[var(--text-primary)]">
                        {item.guestCount}
                      </span>
                      <span className="text-[var(--text-secondary)] font-mono text-[11px]">
                        ({item.roomCodes.join(', ')})
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            {forecast.dietaryNotesList.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {forecast.dietaryNotesList.map((entry, idx) => (
                  <div
                    key={`${entry.roomCode}-${idx}`}
                    className="px-3 py-2 rounded-xl border text-xs flex items-start gap-2"
                    style={{
                      backgroundColor: 'var(--tone-rose-bg)',
                      borderColor: 'var(--tone-rose-border)',
                    }}
                  >
                    <span
                      className="font-mono font-bold shrink-0"
                      style={{ color: 'var(--tone-rose-fg)' }}
                    >
                      {entry.roomCode}:
                    </span>
                    <span className="text-[var(--text-primary)] font-medium">{entry.note}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {/* Main Two-Column Grid: Late Breakfast Queue + Kitchen Checklist */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 no-print">
        {/* Live Queue: Late Breakfast After 10:00 */}
        <section
          data-testid="late-breakfast-queue"
          className="lg:col-span-7 ops-card p-4 sm:p-5 space-y-3.5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Coffee
                className="w-4 h-4 shrink-0"
                strokeWidth={1.75}
                style={{ color: 'var(--brand-primary)' }}
              />
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                Поздний завтрак после 10:00
              </h2>
            </div>
            <StatusPill tone={pendingLateCount > 0 ? 'amber' : 'emerald'} mono>
              {pendingLateCount > 0 ? `В очереди: ${pendingLateCount}` : 'Очередь пуста'}
            </StatusPill>
          </div>

          {lateOrders.length === 0 ? (
            <div className="p-5 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-center space-y-1">
              <p className="text-sm font-medium text-[var(--text-primary)]">
                Заказов на поздний завтрак пока нет
              </p>
              <p className="text-xs text-[var(--text-muted)]">
                Когда ресепшн добавит гостю поздний завтрак, заказ мгновенно появится здесь.
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {lateOrders.map((order) => {
                const isPending = order.status === 'pending';
                const cleanNote = sanitizeKitchenNote(order.note);
                return (
                  <div
                    key={order.id}
                    data-testid={`late-order-card-${order.id}`}
                    className="p-3.5 sm:p-4 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                    style={
                      isPending
                        ? {
                            backgroundColor: 'var(--tone-amber-bg)',
                            borderColor: 'var(--tone-amber-border)',
                          }
                        : {
                            backgroundColor: 'var(--bg-elevated)',
                            borderColor: 'var(--border-subtle)',
                            opacity: 0.78,
                          }
                    }
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-base font-bold text-[var(--text-primary)] font-mono">
                          {order.roomLabel}
                        </span>
                        <StatusPill tone={isPending ? 'amber' : 'emerald'} mono>
                          {formatPortionLabel(order.portions)}
                        </StatusPill>
                        <span className="inline-flex items-center gap-1 text-xs font-mono tabular-nums text-[var(--text-secondary)]">
                          <Clock className="w-3.5 h-3.5" strokeWidth={1.75} />
                          {order.requestedAt}
                        </span>
                      </div>
                      {cleanNote && (
                        <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                          {cleanNote}
                        </p>
                      )}
                      {!isPending && order.servedAt && (
                        <p
                          className="text-xs font-medium inline-flex items-center gap-1"
                          style={{ color: 'var(--tone-emerald-fg)' }}
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" strokeWidth={1.75} />
                          Подано в <span className="font-mono tabular-nums">{order.servedAt}</span>
                        </p>
                      )}
                    </div>

                    {isPending ? (
                      <button
                        type="button"
                        data-testid={`serve-late-breakfast-${order.id}`}
                        onClick={() => serveLateBreakfastOrder(order.id)}
                        className="ops-brand-btn min-h-[48px] px-4 py-2.5 rounded-xl text-sm font-semibold inline-flex items-center justify-center gap-2 whitespace-nowrap shrink-0"
                      >
                        <Check className="w-4 h-4 shrink-0" strokeWidth={2.25} />
                        Подано / Готово
                      </button>
                    ) : (
                      <span
                        className="min-h-[44px] px-3.5 rounded-xl border text-xs font-semibold inline-flex items-center justify-center gap-1.5 shrink-0"
                        style={{
                          backgroundColor: 'var(--tone-emerald-bg)',
                          borderColor: 'var(--tone-emerald-border)',
                          color: 'var(--tone-emerald-fg)',
                        }}
                      >
                        <CheckCircle2 className="w-4 h-4" strokeWidth={1.75} />
                        Выдано
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Kitchen Shift Checklist */}
        <section
          data-testid="kitchen-checklist-panel"
          className="lg:col-span-5 ops-card p-4 sm:p-5 space-y-3.5"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <ClipboardCheck
                className="w-4 h-4 shrink-0"
                strokeWidth={1.75}
                style={{ color: 'var(--tone-emerald-fg)' }}
              />
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                Чек-лист смены кухни
              </h2>
            </div>
            <StatusPill
              tone={
                kitchenChecklist.length > 0 && checklistDoneCount === kitchenChecklist.length
                  ? 'emerald'
                  : 'neutral'
              }
              mono
            >
              {checklistDoneCount}/{kitchenChecklist.length}
            </StatusPill>
          </div>

          <div className="space-y-2">
            {kitchenChecklist.map((item) => (
              <button
                key={item.id}
                type="button"
                data-testid={`kitchen-check-${item.id}`}
                onClick={() => toggleKitchenChecklistItem(item.id)}
                className="w-full min-h-[52px] px-3.5 py-2.5 rounded-xl border text-left flex items-center gap-3 transition-colors"
                style={
                  item.done
                    ? {
                        backgroundColor: 'var(--tone-emerald-bg)',
                        borderColor: 'var(--tone-emerald-border)',
                      }
                    : {
                        backgroundColor: 'var(--bg-elevated)',
                        borderColor: 'var(--border-subtle)',
                      }
                }
              >
                <span
                  className="w-6 h-6 rounded-lg border flex items-center justify-center shrink-0"
                  style={
                    item.done
                      ? {
                          backgroundColor: 'var(--status-inhouse)',
                          borderColor: 'var(--status-inhouse)',
                          color: '#FFFFFF',
                        }
                      : {
                          backgroundColor: 'var(--bg-surface)',
                          borderColor: 'var(--border-strong)',
                        }
                  }
                >
                  {item.done && <Check className="w-4 h-4" strokeWidth={2.5} />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono tabular-nums text-xs font-bold text-[var(--brand-primary)]">
                      {item.time}
                    </span>
                    {item.done && item.doneAt && (
                      <span
                        className="font-mono tabular-nums text-[11px]"
                        style={{ color: 'var(--tone-emerald-fg)' }}
                      >
                        ✓ {item.doneAt}
                      </span>
                    )}
                  </div>
                  <div
                    className={`text-xs sm:text-sm font-medium mt-0.5 ${
                      item.done
                        ? 'line-through text-[var(--text-muted)]'
                        : 'text-[var(--text-primary)]'
                    }`}
                  >
                    {item.title}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </section>
      </div>

      {/* Compact Sanitized Room Breakdown (NO names, NO passports, NO prices) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 no-print">
        {/* In-House Private Rooms & Dorms */}
        <section className="lg:col-span-8 ops-card p-4 sm:p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <BedDouble
                className="w-4 h-4 shrink-0"
                strokeWidth={1.75}
                style={{ color: 'var(--tone-cobalt-fg)' }}
              />
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                Разбивка по комнатам (сейчас в отеле)
              </h2>
            </div>
            <span className="text-xs text-[var(--text-muted)] font-mono tabular-nums">
              Приватные: {privateInHouse.reduce((s, r) => s + r.guestCount, 0)} чел. · Дормы:{' '}
              {dormInHouse.reduce((s, r) => s + r.guestCount, 0)} чел.
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Private Rooms Column */}
            <div className="space-y-2">
              <div className="text-xs font-semibold text-[var(--text-secondary)]">
                Приватные комнаты ({privateInHouse.length})
              </div>
              {privateInHouse.length === 0 ? (
                <div className="p-3 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-xs text-[var(--text-muted)]">
                  Нет занятых приватных комнат
                </div>
              ) : (
                <div className="divide-y divide-[var(--border-subtle)] border border-[var(--border-subtle)] rounded-xl bg-[var(--bg-elevated)] overflow-hidden">
                  {privateInHouse.map((room) => (
                    <div
                      key={room.bookingId}
                      className="px-3.5 py-2.5 flex items-start justify-between gap-2 text-xs"
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-mono font-bold text-sm text-[var(--text-primary)]">
                            {room.roomCode}
                          </span>
                          {room.isCheckingOutToday && (
                            <StatusPill tone="amber">Выезд 12:00</StatusPill>
                          )}
                        </div>
                        {(room.dietaryTags.length > 0 || room.dietaryNotes.length > 0) && (
                          <div className="flex flex-wrap gap-1">
                            {room.dietaryTags.map((tag) => (
                              <span
                                key={tag}
                                className="px-1.5 py-0.5 rounded text-[11px] font-semibold"
                                style={{
                                  backgroundColor:
                                    tag === 'allergy'
                                      ? 'var(--tone-rose-bg)'
                                      : 'var(--tone-amber-bg)',
                                  color:
                                    tag === 'allergy'
                                      ? 'var(--tone-rose-fg)'
                                      : 'var(--tone-amber-fg)',
                                }}
                              >
                                {DIETARY_TAG_LABELS[tag]}
                              </span>
                            ))}
                            {room.dietaryNotes.map((n, idx) => (
                              <span
                                key={idx}
                                className="text-[11px] text-[var(--text-secondary)]"
                              >
                                · {n}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <span className="font-mono tabular-nums font-bold text-sm text-[var(--text-primary)]">
                          {room.guestCount} чел.
                        </span>
                        {room.childrenCount > 0 && (
                          <div className="text-[11px] text-[var(--text-muted)] font-mono tabular-nums">
                            детей: {room.childrenCount}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Dorms Column */}
            <div className="space-y-2">
              <div className="text-xs font-semibold text-[var(--text-secondary)]">
                Дормы ({dormInHouse.length})
              </div>
              {dormInHouse.length === 0 ? (
                <div className="p-3 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-xs text-[var(--text-muted)]">
                  Нет занятых коек в дормах
                </div>
              ) : (
                <div className="divide-y divide-[var(--border-subtle)] border border-[var(--border-subtle)] rounded-xl bg-[var(--bg-elevated)] overflow-hidden">
                  {dormInHouse.map((room) => (
                    <div
                      key={room.bookingId}
                      className="px-3.5 py-2.5 flex items-start justify-between gap-2 text-xs"
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-mono font-bold text-sm text-[var(--text-primary)]">
                            {room.roomCode}
                          </span>
                          {room.isCheckingOutToday && (
                            <StatusPill tone="amber">Выезд 12:00</StatusPill>
                          )}
                        </div>
                        {(room.dietaryTags.length > 0 || room.dietaryNotes.length > 0) && (
                          <div className="flex flex-wrap gap-1">
                            {room.dietaryTags.map((tag) => (
                              <span
                                key={tag}
                                className="px-1.5 py-0.5 rounded text-[11px] font-semibold"
                                style={{
                                  backgroundColor:
                                    tag === 'allergy'
                                      ? 'var(--tone-rose-bg)'
                                      : 'var(--tone-amber-bg)',
                                  color:
                                    tag === 'allergy'
                                      ? 'var(--tone-rose-fg)'
                                      : 'var(--tone-amber-fg)',
                                }}
                              >
                                {DIETARY_TAG_LABELS[tag]}
                              </span>
                            ))}
                            {room.dietaryNotes.map((n, idx) => (
                              <span
                                key={idx}
                                className="text-[11px] text-[var(--text-secondary)]"
                              >
                                · {n}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <span className="font-mono tabular-nums font-bold text-sm text-[var(--text-primary)]">
                          {room.guestCount} чел.
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Arriving Today Rooms Breakdown */}
        <section className="lg:col-span-4 ops-card p-4 sm:p-5 space-y-3.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <CalendarClock
                className="w-4 h-4 shrink-0"
                strokeWidth={1.75}
                style={{ color: 'var(--brand-primary)' }}
              />
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                Заезды сегодня
              </h2>
            </div>
            <StatusPill tone="cobalt" mono>
              {forecast.arrivingToday.totalGuests} чел.
            </StatusPill>
          </div>

          {forecast.arrivingToday.rooms.length === 0 ? (
            <div className="p-4 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-xs text-[var(--text-muted)]">
              На сегодня ожидаемых заездов по броням нет.
            </div>
          ) : (
            <div className="space-y-2">
              {forecast.arrivingToday.rooms.map((arr) => (
                <div
                  key={arr.bookingId}
                  className="p-3 rounded-xl border space-y-1.5 text-xs"
                  style={
                    arr.isEarlyBefore10
                      ? {
                          backgroundColor: 'var(--tone-amber-bg)',
                          borderColor: 'var(--tone-amber-border)',
                        }
                      : {
                          backgroundColor: 'var(--bg-elevated)',
                          borderColor: 'var(--border-subtle)',
                        }
                  }
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono font-bold text-sm text-[var(--text-primary)]">
                      {arr.roomCode}
                    </span>
                    <span className="font-mono tabular-nums font-bold text-[var(--text-primary)]">
                      {arr.guestCount} чел.
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-mono tabular-nums font-semibold text-[var(--text-secondary)]">
                      Заезд: {arr.expectedArrivalTime || 'после 14:00'}
                    </span>
                    {arr.isEarlyBefore10 ? (
                      <StatusPill tone="amber">Успеют до 10:00</StatusPill>
                    ) : (
                      <StatusPill tone="neutral">На завтра</StatusPill>
                    )}
                  </div>
                  {(arr.dietaryTags.length > 0 || arr.dietaryNotes.length > 0) && (
                    <div className="flex flex-wrap gap-1 pt-0.5">
                      {arr.dietaryTags.map((tag) => (
                        <span
                          key={tag}
                          className="px-1.5 py-0.5 rounded text-[11px] font-semibold bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border-subtle)]"
                        >
                          {DIETARY_TAG_LABELS[tag]}
                        </span>
                      ))}
                      {arr.dietaryNotes.map((n, idx) => (
                        <span key={idx} className="text-[11px] text-[var(--text-secondary)]">
                          · {n}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Printable Clean Kitchen Sheet (Visible ONLY in @media print) */}
      <div id="printable-kitchen-sheet" className="hidden print:block space-y-5 text-black">
        <div className="border-b-2 border-black pb-3 flex items-baseline justify-between">
          <div>
            <h1 className="text-xl font-bold">TOPCHAN HOSTEL · ЛИСТ КУХНИ (ЗАВТРАКИ)</h1>
            <p className="text-xs">г. Ташкент, ул. 8 Марта, 104 · Бесплатный завтрак 08:00–10:00</p>
          </div>
          <div className="font-mono text-sm font-bold">{forecast.targetDateIso}</div>
        </div>

        <div className="grid grid-cols-4 gap-3 text-xs border border-black p-3">
          <div>
            <div className="font-semibold">Сегодня на завтрак</div>
            <div className="text-2xl font-mono font-bold">{todayPortionsRange}</div>
            <div>порций (08:00–10:00)</div>
          </div>
          <div>
            <div className="font-semibold">Сейчас в отеле</div>
            <div className="text-2xl font-mono font-bold">{forecast.inHouseNow.totalGuests}</div>
            <div>
              Взр: {forecast.inHouseNow.adultsCount} · Дети: {forecast.inHouseNow.childrenCount} · Выезд 12:00:{' '}
              {forecast.inHouseNow.checkingOutTodayCount}
            </div>
          </div>
          <div>
            <div className="font-semibold">Приедут сегодня</div>
            <div className="text-2xl font-mono font-bold">{forecast.arrivingToday.totalGuests}</div>
            <div>
              До 10:00: {forecast.arrivingToday.earlyArrivalsBefore10} · После 10:00:{' '}
              {forecast.arrivingToday.standardArrivals}
            </div>
          </div>
          <div>
            <div className="font-semibold">Завтра утром</div>
            <div className="text-2xl font-mono font-bold">
              {forecast.tomorrowBreakfastEstimate.totalPortions}
            </div>
            <div>
              Ост: {forecast.tomorrowBreakfastEstimate.stayingInHouseCount} + заезд:{' '}
              {forecast.tomorrowBreakfastEstimate.arrivingTodayCount}
            </div>
          </div>
        </div>

        {(forecast.dietarySummary.length > 0 || forecast.dietaryNotesList.length > 0) && (
          <div className="space-y-1.5">
            <h2 className="text-sm font-bold uppercase">Диеты и аллергии</h2>
            <ul className="text-xs space-y-1">
              {forecast.dietarySummary.map((d) => (
                <li key={d.tag}>
                  • <strong>{d.label}</strong>: {d.guestCount} чел. ({d.roomCodes.join(', ')})
                </li>
              ))}
              {forecast.dietaryNotesList.map((n, idx) => (
                <li key={idx}>
                  • <strong>{n.roomCode}</strong>: {n.note}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="space-y-1.5">
          <h2 className="text-sm font-bold uppercase">Комнаты в отеле</h2>
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b border-black text-left">
                <th className="py-1 pr-3">Комната / Койка</th>
                <th className="py-1 pr-3">Гостей</th>
                <th className="py-1 pr-3">Статус</th>
                <th className="py-1">Диета / заметка</th>
              </tr>
            </thead>
            <tbody>
              {forecast.inHouseNow.rooms.map((r) => (
                <tr key={r.bookingId} className="border-b border-gray-300">
                  <td className="py-1 pr-3 font-mono font-bold">{r.roomCode}</td>
                  <td className="py-1 pr-3 font-mono">{r.guestCount}</td>
                  <td className="py-1 pr-3">{r.isCheckingOutToday ? 'Выезд 12:00' : 'Проживает'}</td>
                  <td className="py-1">
                    {[
                      ...r.dietaryTags.map((t) => DIETARY_TAG_LABELS[t]),
                      ...r.dietaryNotes,
                    ].join(', ') || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {forecast.arrivingToday.rooms.length > 0 && (
          <div className="space-y-1.5">
            <h2 className="text-sm font-bold uppercase">Ожидаемые заезды сегодня</h2>
            <ul className="text-xs space-y-1">
              {forecast.arrivingToday.rooms.map((a) => (
                <li key={a.bookingId}>
                  • <strong className="font-mono">{a.roomCode}</strong> — {a.guestCount} чел. ·
                  заезд {a.expectedArrivalTime || 'после 14:00'}{' '}
                  {a.isEarlyBefore10 ? '(до 10:00 — успеют на завтрак)' : '(на завтра)'}
                  {a.dietaryTags.length > 0
                    ? ` · ${a.dietaryTags.map((t) => DIETARY_TAG_LABELS[t]).join(', ')}`
                    : ''}
                </li>
              ))}
            </ul>
          </div>
        )}

        {lateOrders.filter((o) => o.status === 'pending').length > 0 && (
          <div className="space-y-1.5">
            <h2 className="text-sm font-bold uppercase">Поздний завтрак после 10:00</h2>
            <ul className="text-xs space-y-1">
              {lateOrders
                .filter((o) => o.status === 'pending')
                .map((o) => (
                  <li key={o.id}>
                    • <strong className="font-mono">{o.roomLabel}</strong> —{' '}
                    {formatPortionLabel(o.portions)} ({o.requestedAt})
                    {sanitizeKitchenNote(o.note) ? ` · ${sanitizeKitchenNote(o.note)}` : ''}
                  </li>
                ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
};
