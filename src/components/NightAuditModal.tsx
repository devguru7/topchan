import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  MoonStar,
  Printer,
  ShieldAlert,
  Wallet,
  X,
} from 'lucide-react';
import { useOps } from '../context/OpsContext';
import { calcBookingTotals, formatUsd, formatUzs } from '../utils/math';
import { addDaysIso, getTashkentTodayIso } from '../utils/time';
import { StatusPill, StepProgress } from './ui';
import { SPRING_SNAPPY } from '../utils/motion';

const NIGHT_AUDIT_STEPS = [
  { id: 1, label: 'No-show', hint: 'Предзаезды' },
  { id: 2, label: 'Заезды', hint: 'Оплаты сегодня' },
  { id: 3, label: 'E-mehmon', hint: 'Контроль 72ч' },
  { id: 4, label: 'Выезды', hint: 'До 12:00' },
  { id: 5, label: '00:00 и касса', hint: '6 карманов' },
  { id: 6, label: 'Закрытие дня', hint: 'Архив смены' },
] as const;

export const NightAuditModal: React.FC = () => {
  const {
    state,
    nightAuditOpen,
    setNightAuditOpen,
    markGuestEmehmonRegistered,
    toggleChecklistItem,
    completeNightAudit,
    openCheckOutModal,
  } = useOps();

  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5 | 6>(1);
  const [selectedNoShows, setSelectedNoShows] = useState<string[]>([]);
  const [auditNotes, setAuditNotes] = useState('');
  const [completedRecordId, setCompletedRecordId] = useState<string | null>(null);

  const opDate = state.operationalDate ?? getTashkentTodayIso();
  const nextOpDate = addDaysIso(opDate, 1);

  useEffect(() => {
    if (!nightAuditOpen) return;
    setStep(1);
    setSelectedNoShows([]);
    setAuditNotes('');
    setCompletedRecordId(null);
  }, [nightAuditOpen]);

  const activeBookings = useMemo(
    () => state.bookings.filter((b) => b.status === 'active'),
    [state.bookings]
  );

  // Step 1: Arrivals scheduled for operationalDate with unpaid balance (potential no-shows)
  const potentialNoShows = useMemo(
    () =>
      activeBookings.filter((b) => {
        const firstSeg = b.segments[0];
        if (!firstSeg || firstSeg.fromDate !== opDate) return false;
        const { totalPaymentsUsd } = calcBookingTotals(b);
        return totalPaymentsUsd <= 0;
      }),
    [activeBookings, opDate]
  );

  // Step 2: All arrivals today
  const arrivalsToday = useMemo(
    () => activeBookings.filter((b) => b.segments[0]?.fromDate === opDate),
    [activeBookings, opDate]
  );

  // Step 3: Unregistered foreigners in-house (72h legal compliance)
  const unregisteredForeigners = useMemo(() => {
    const list: Array<{
      bookingId: string;
      bnovoId: string;
      guestId: string;
      guestName: string;
      citizenship: string;
      passportNo: string;
      roomLabel: string;
    }> = [];
    for (const b of activeBookings) {
      if (selectedNoShows.includes(b.id)) continue;
      const seg = b.segments[b.segments.length - 1];
      const room = state.physicalRooms.find((r) => r.id === seg?.roomId);
      const bed = seg?.bedId ? room?.beds?.find((bd) => bd.id === seg.bedId) : undefined;
      const roomLabel = room ? (bed ? `${room.code} ${bed.label}` : room.code) : '—';
      for (const g of b.guests) {
        if (g.isForeigner && !g.emehmonRegistered) {
          list.push({
            bookingId: b.id,
            bnovoId: b.bnovoId,
            guestId: g.id,
            guestName: g.fullName,
            citizenship: g.citizenship,
            passportNo: g.passportNo,
            roomLabel,
          });
        }
      }
    }
    return list;
  }, [activeBookings, selectedNoShows, state.physicalRooms]);

  // Step 4: Departures scheduled today (12:00 check-out) still active
  const pendingDepartures = useMemo(
    () =>
      activeBookings.filter((b) => {
        if (selectedNoShows.includes(b.id)) return false;
        const lastSeg = b.segments[b.segments.length - 1];
        return lastSeg && lastSeg.toDate <= opDate;
      }),
    [activeBookings, selectedNoShows, opDate]
  );

  const checklistDoneCount = state.shiftChecklist.filter((i) => i.done).length;
  const shiftHistory = state.shiftHistory ?? [];
  const latestRecord = completedRecordId
    ? shiftHistory.find((h) => h.id === completedRecordId) ?? shiftHistory[0] ?? null
    : null;

  const toggleNoShow = (bookingId: string) => {
    setSelectedNoShows((prev) =>
      prev.includes(bookingId) ? prev.filter((id) => id !== bookingId) : [...prev, bookingId]
    );
  };

  const handleCloseDay = () => {
    completeNightAudit({
      noShowBookingIds: selectedNoShows,
      notes: auditNotes.trim() || `Ночной аудит за ${opDate} закрыт без замечаний`,
    });
    setCompletedRecordId(`done-${Date.now()}`);
  };

  const getRoomLabel = (roomId?: string, bedId?: string) => {
    const room = state.physicalRooms.find((r) => r.id === roomId);
    if (!room) return '—';
    const bed = bedId ? room.beds?.find((b) => b.id === bedId) : undefined;
    return bed ? `${room.code} · ${bed.label}` : room.code;
  };

  return (
    <AnimatePresence>
      {nightAuditOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5 overflow-y-auto"
          style={{ backgroundColor: 'var(--backdrop-scrim)' }}
          onClick={() => setNightAuditOpen(false)}
        >
          <motion.div
            initial={{ opacity: 0, y: 14, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={SPRING_SNAPPY}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Ночной аудит и закрытие операционного дня"
            style={{ boxShadow: 'var(--shadow-popover)' }}
            className="w-full max-w-4xl rounded-2xl border border-[var(--border-strong)] bg-[var(--bg-surface)] overflow-hidden my-auto max-h-[92vh] flex flex-col"
          >
            {/* Header */}
            <div className="px-5 py-4 border-b border-[var(--border-subtle)] space-y-3.5 shrink-0">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className="w-9 h-9 rounded-xl border flex items-center justify-center shrink-0"
                    style={{
                      backgroundColor: 'var(--brand-primary-soft)',
                      borderColor: 'var(--brand-primary-border)',
                      color: 'var(--brand-primary)',
                    }}
                  >
                    <MoonStar className="w-4 h-4" strokeWidth={1.75} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-base font-semibold text-[var(--text-primary)] truncate">
                        Ночной аудит смены
                      </h2>
                      <span className="px-2 py-0.5 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] font-mono text-xs tabular-nums text-[var(--text-secondary)]">
                        {opDate} → {nextOpDate}
                      </span>
                    </div>
                    <p className="text-xs text-[var(--text-muted)] truncate">
                      Пошаговая сверка незаездов, E-mehmon 72ч, выездов 12:00 и 6 карманов кассы
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  aria-label="Закрыть Ночной аудит"
                  onClick={() => setNightAuditOpen(false)}
                  className="p-2 rounded-xl text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
                >
                  <X className="w-4 h-4" strokeWidth={1.75} />
                </button>
              </div>

              <StepProgress
                steps={NIGHT_AUDIT_STEPS}
                currentStep={step}
                onStepClick={(s) => setStep(s as 1 | 2 | 3 | 4 | 5 | 6)}
              />
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {/* STEP 1: No-shows */}
              {step === 1 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                        Шаг 1. Предзаезды и незаезды (No-show) на {opDate}
                      </h3>
                      <p className="text-xs text-[var(--text-muted)] mt-0.5">
                        Отметьте неоплаченные брони, гости по которым не приехали — они будут отменены, а комнаты освободятся.
                      </p>
                    </div>
                    <StatusPill tone={potentialNoShows.length > 0 ? 'amber' : 'emerald'}>
                      Кандидатов: {potentialNoShows.length}
                    </StatusPill>
                  </div>

                  {potentialNoShows.length === 0 ? (
                    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-6 text-center space-y-1">
                      <CheckCircle2
                        className="w-6 h-6 mx-auto"
                        strokeWidth={1.75}
                        style={{ color: 'var(--tone-emerald-fg)' }}
                      />
                      <p className="text-sm font-medium text-[var(--text-primary)]">
                        Неоплаченных предзаездов за {opDate} нет
                      </p>
                      <p className="text-xs text-[var(--text-muted)]">
                        Все гости сегодняшнего заезда внесены и подтверждены.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {potentialNoShows.map((bkg) => {
                        const seg = bkg.segments[0];
                        const totals = calcBookingTotals(bkg);
                        const checked = selectedNoShows.includes(bkg.id);
                        return (
                          <label
                            key={bkg.id}
                            className="flex items-center justify-between gap-3 p-3.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] cursor-pointer transition-colors"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleNoShow(bkg.id)}
                                className="w-4 h-4 accent-[#C2592B]"
                              />
                              <div className="min-w-0">
                                <div className="text-sm font-semibold text-[var(--text-primary)] truncate">
                                  {bkg.guests[0]?.fullName ?? 'Гость'}{' '}
                                  <span className="font-mono text-xs text-[var(--text-muted)]">
                                    {bkg.bnovoId}
                                  </span>
                                </div>
                                <div className="text-xs text-[var(--text-muted)]">
                                  {getRoomLabel(seg?.roomId, seg?.bedId)} · {seg?.fromDate} — {seg?.toDate} · {bkg.source}
                                </div>
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <div className="font-mono text-sm font-semibold tabular-nums" style={{ color: 'var(--tone-rose-fg)' }}>
                                Долг {formatUsd(totals.debtUsd)}
                              </div>
                              <div className="text-[11px] text-[var(--text-muted)]">
                                {checked ? 'Будет отменён (No-show)' : 'Оставить активным'}
                              </div>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* STEP 2: Today's Arrivals */}
              {step === 2 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                        Шаг 2. Сверка заездов и оплат за {opDate}
                      </h3>
                      <p className="text-xs text-[var(--text-muted)] mt-0.5">
                        Проверьте, что по каждому заехавшему гостю сумма проживания и оплата отражены верно.
                      </p>
                    </div>
                    <StatusPill tone="cobalt">Заездов: {arrivalsToday.length}</StatusPill>
                  </div>

                  {arrivalsToday.length === 0 ? (
                    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-6 text-center text-xs text-[var(--text-muted)]">
                      Заездов с датой {opDate} не зафиксировано.
                    </div>
                  ) : (
                    <div className="overflow-x-auto rounded-xl border border-[var(--border-subtle)]">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-muted)]">
                            <th className="py-2.5 px-3 font-medium">Гость / Бронь</th>
                            <th className="py-2.5 px-3 font-medium">Номер</th>
                            <th className="py-2.5 px-3 font-medium text-right">Начислено</th>
                            <th className="py-2.5 px-3 font-medium text-right">Оплачено</th>
                            <th className="py-2.5 px-3 font-medium text-right">Остаток</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--border-subtle)]">
                          {arrivalsToday.map((bkg) => {
                            const seg = bkg.segments[0];
                            const totals = calcBookingTotals(bkg);
                            const isMarkedNoShow = selectedNoShows.includes(bkg.id);
                            return (
                              <tr key={bkg.id} className={isMarkedNoShow ? 'opacity-50 line-through' : ''}>
                                <td className="py-2.5 px-3 font-medium text-[var(--text-primary)]">
                                  {bkg.guests[0]?.fullName}{' '}
                                  <span className="font-mono text-[var(--text-muted)]">{bkg.bnovoId}</span>
                                </td>
                                <td className="py-2.5 px-3 text-[var(--text-secondary)]">
                                  {getRoomLabel(seg?.roomId, seg?.bedId)}
                                </td>
                                <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                                  {formatUsd(totals.totalChargesUsd)}
                                </td>
                                <td className="py-2.5 px-3 text-right font-mono tabular-nums" style={{ color: 'var(--tone-emerald-fg)' }}>
                                  {formatUsd(totals.totalPaymentsUsd)}
                                </td>
                                <td
                                  className="py-2.5 px-3 text-right font-mono font-semibold tabular-nums"
                                  style={{
                                    color: totals.debtUsd > 0.01 ? 'var(--tone-rose-fg)' : 'var(--tone-emerald-fg)',
                                  }}
                                >
                                  {totals.debtUsd > 0.01 ? formatUsd(totals.debtUsd) : 'Оплачено'}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* STEP 3: E-mehmon 72h */}
              {step === 3 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                        Шаг 3. Контроль E-mehmon (иностранцы, правило 72 часов)
                      </h3>
                      <p className="text-xs text-[var(--text-muted)] mt-0.5">
                        Зарегистрируйте всех иностранных гостей до закрытия операционного дня, чтобы избежать штрафов.
                      </p>
                    </div>
                    <StatusPill tone={unregisteredForeigners.length > 0 ? 'rose' : 'emerald'}>
                      {unregisteredForeigners.length > 0
                        ? `Не оформлено: ${unregisteredForeigners.length}`
                        : '100% E-mehmon OK'}
                    </StatusPill>
                  </div>

                  {unregisteredForeigners.length === 0 ? (
                    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-6 text-center space-y-1">
                      <CheckCircle2
                        className="w-6 h-6 mx-auto"
                        strokeWidth={1.75}
                        style={{ color: 'var(--tone-emerald-fg)' }}
                      />
                      <p className="text-sm font-medium text-[var(--text-primary)]">
                        Все проживающие иностранные гости оформлены в E-mehmon
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {unregisteredForeigners.map((item) => (
                        <div
                          key={`${item.bookingId}-${item.guestId}`}
                          className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-xl border"
                          style={{
                            backgroundColor: 'var(--tone-rose-bg)',
                            borderColor: 'var(--tone-rose-border)',
                          }}
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <ShieldAlert
                              className="w-4 h-4 shrink-0"
                              strokeWidth={1.75}
                              style={{ color: 'var(--tone-rose-fg)' }}
                            />
                            <div className="min-w-0">
                              <div className="text-sm font-semibold text-[var(--text-primary)]">
                                {item.guestName}{' '}
                                <span className="font-mono text-xs text-[var(--text-muted)]">
                                  ({item.citizenship} · {item.passportNo})
                                </span>
                              </div>
                              <div className="text-xs text-[var(--text-secondary)]">
                                {item.roomLabel} · Бронь {item.bnovoId}
                              </div>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => markGuestEmehmonRegistered(item.bookingId, item.guestId)}
                            className="ops-brand-btn px-3 py-1.5 rounded-lg text-xs font-semibold shrink-0"
                          >
                            Отметить E-mehmon
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* STEP 4: Pending Departures 12:00 */}
              {step === 4 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                        Шаг 4. Незакрытые выезды (Check-out до 12:00)
                      </h3>
                      <p className="text-xs text-[var(--text-muted)] mt-0.5">
                        Проверьте гостей с датой выезда ≤ {opDate}. Если гость остался — продлите бронь, если уехал — оформите выезд.
                      </p>
                    </div>
                    <StatusPill tone={pendingDepartures.length > 0 ? 'amber' : 'emerald'}>
                      Ожидают выезда: {pendingDepartures.length}
                    </StatusPill>
                  </div>

                  {pendingDepartures.length === 0 ? (
                    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-6 text-center space-y-1">
                      <CheckCircle2
                        className="w-6 h-6 mx-auto"
                        strokeWidth={1.75}
                        style={{ color: 'var(--tone-emerald-fg)' }}
                      />
                      <p className="text-sm font-medium text-[var(--text-primary)]">
                        Все выезды за {opDate} закрыты
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {pendingDepartures.map((bkg) => {
                        const seg = bkg.segments[bkg.segments.length - 1];
                        const totals = calcBookingTotals(bkg);
                        return (
                          <div
                            key={bkg.id}
                            className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]"
                          >
                            <div>
                              <div className="text-sm font-semibold text-[var(--text-primary)]">
                                {bkg.guests[0]?.fullName}{' '}
                                <span className="font-mono text-xs text-[var(--text-muted)]">
                                  {getRoomLabel(seg?.roomId, seg?.bedId)}
                                </span>
                              </div>
                              <div className="text-xs text-[var(--text-muted)]">
                                Плановый выезд: {seg?.toDate} · Баланс:{' '}
                                <span className="font-mono font-semibold text-[var(--text-primary)]">
                                  {totals.debtUsd > 0.01 ? `Долг ${formatUsd(totals.debtUsd)}` : 'Оплачено'}
                                </span>
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                setNightAuditOpen(false);
                                openCheckOutModal(bkg.id);
                              }}
                              className="px-3 py-1.5 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] text-xs font-semibold text-[var(--text-primary)] transition-colors"
                            >
                              Оформить выезд
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* STEP 5: Midnight Checklist & 6 Cash Pockets */}
              {step === 5 && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-xs font-semibold text-[var(--text-primary)]">
                        <ClipboardCheck className="w-4 h-4" strokeWidth={1.75} />
                        <span>Полуночный чек-лист (00:00)</span>
                      </div>
                      <span className="font-mono text-xs text-[var(--text-muted)]">
                        {checklistDoneCount}/{state.shiftChecklist.length}
                      </span>
                    </div>
                    <div className="space-y-1.5">
                      {state.shiftChecklist.map((item) => (
                        <label
                          key={item.id}
                          className="flex items-start gap-2.5 p-2 rounded-lg hover:bg-[var(--bg-hover)] cursor-pointer text-xs"
                        >
                          <input
                            type="checkbox"
                            checked={item.done}
                            onChange={() => toggleChecklistItem(item.id)}
                            className="mt-0.5 w-4 h-4 accent-[#0F766E]"
                          />
                          <span
                            className={
                              item.done
                                ? 'line-through text-[var(--text-muted)]'
                                : 'text-[var(--text-primary)]'
                            }
                          >
                            <span className="font-mono text-[11px] text-[var(--text-muted)] mr-1.5">
                              {item.time}
                            </span>
                            {item.title}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-xs font-semibold text-[var(--text-primary)]">
                        <Wallet className="w-4 h-4" strokeWidth={1.75} />
                        <span>Снимок 6 карманов кассы (раздельные валюты)</span>
                      </div>
                    </div>
                    <div className="divide-y divide-[var(--border-subtle)] text-xs">
                      {state.pockets.map((p) => (
                        <div key={p.id} className="py-2 flex items-center justify-between gap-2">
                          <span className="text-[var(--text-secondary)]">{p.name}</span>
                          {p.id === 'safe' && p.safeBalances ? (
                            <span className="font-mono tabular-nums font-semibold text-[var(--text-primary)]">
                              {formatUzs(p.safeBalances.UZS)} · {formatUsd(p.safeBalances.USD)} · €
                              {p.safeBalances.EUR.toFixed(2)}
                            </span>
                          ) : (
                            <span className="font-mono tabular-nums font-semibold text-[var(--text-primary)]">
                              {p.currency === 'UZS'
                                ? formatUzs(p.balance)
                                : p.currency === 'USD'
                                  ? formatUsd(p.balance)
                                  : `€${p.balance.toFixed(2)}`}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* STEP 6: Finalize & Archive */}
              {step === 6 && (
                <div className="space-y-4">
                  {completedRecordId && latestRecord ? (
                    <div className="rounded-2xl border border-[var(--tone-emerald-border)] bg-[var(--tone-emerald-bg)] p-5 space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2.5">
                          <CheckCircle2
                            className="w-5 h-5"
                            strokeWidth={1.75}
                            style={{ color: 'var(--tone-emerald-fg)' }}
                          />
                          <div>
                            <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                              Операционный день {latestRecord.businessDate} успешно закрыт
                            </h3>
                            <p className="text-xs text-[var(--text-secondary)]">
                              Новый операционный день: <strong className="font-mono">{state.operationalDate}</strong> · Запись добавлена в архив смен
                            </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => window.print()}
                          className="px-3 py-1.5 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-surface)] text-xs font-semibold inline-flex items-center gap-1.5"
                        >
                          <Printer className="w-3.5 h-3.5" strokeWidth={1.75} />
                          Печать Z-отчёта
                        </button>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-2 text-xs">
                        <div className="rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] p-2.5">
                          <div className="text-[var(--text-muted)]">Загрузка</div>
                          <div className="font-mono text-base font-bold tabular-nums text-[var(--text-primary)]">
                            {latestRecord.totalUnits > 0
                              ? Math.round((latestRecord.occupiedUnits / latestRecord.totalUnits) * 100)
                              : 0}
                            %
                          </div>
                        </div>
                        <div className="rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] p-2.5">
                          <div className="text-[var(--text-muted)]">Занято мест</div>
                          <div className="font-mono text-base font-bold tabular-nums text-[var(--text-primary)]">
                            {latestRecord.occupiedUnits}/{latestRecord.totalUnits}
                          </div>
                        </div>
                        <div className="rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] p-2.5">
                          <div className="text-[var(--text-muted)]">No-show отменено</div>
                          <div className="font-mono text-base font-bold tabular-nums text-[var(--text-primary)]">
                            {latestRecord.noShowCancelledCount}
                          </div>
                        </div>
                        <div className="rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] p-2.5">
                          <div className="text-[var(--text-muted)]">Наличные USD</div>
                          <div className="font-mono text-base font-bold tabular-nums text-[var(--text-primary)]">
                            {formatUsd(
                              latestRecord.pocketsSnapshot.find((p) => p.id === 'cash_usd')?.balance ?? 0
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4 space-y-2.5">
                        <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                          Итог перед закрытием суток {opDate} → {nextOpDate}
                        </h3>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
                          <div className="rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] p-3">
                            <div className="text-[var(--text-muted)]">Активных броней</div>
                            <div className="font-mono text-base font-bold tabular-nums text-[var(--text-primary)]">
                              {activeBookings.length - selectedNoShows.length}
                            </div>
                          </div>
                          <div className="rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] p-3">
                            <div className="text-[var(--text-muted)]">No-show к отмене</div>
                            <div className="font-mono text-base font-bold tabular-nums text-[var(--text-primary)]">
                              {selectedNoShows.length}
                            </div>
                          </div>
                          <div className="rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] p-3">
                            <div className="text-[var(--text-muted)]">E-mehmon долг</div>
                            <div
                              className="font-mono text-base font-bold tabular-nums"
                              style={{
                                color:
                                  unregisteredForeigners.length > 0
                                    ? 'var(--tone-rose-fg)'
                                    : 'var(--tone-emerald-fg)',
                              }}
                            >
                              {unregisteredForeigners.length}
                            </div>
                          </div>
                          <div className="rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] p-3">
                            <div className="text-[var(--text-muted)]">Чек-лист 00:00</div>
                            <div className="font-mono text-base font-bold tabular-nums text-[var(--text-primary)]">
                              {checklistDoneCount}/{state.shiftChecklist.length}
                            </div>
                          </div>
                        </div>

                        {unregisteredForeigners.length > 0 && (
                          <div
                            className="flex items-center gap-2 p-2.5 rounded-lg border text-xs"
                            style={{
                              backgroundColor: 'var(--tone-amber-bg)',
                              borderColor: 'var(--tone-amber-border)',
                              color: 'var(--tone-amber-fg)',
                            }}
                          >
                            <AlertTriangle className="w-4 h-4 shrink-0" strokeWidth={1.75} />
                            <span>
                              Внимание: {unregisteredForeigners.length} иностр. гостей ещё без отметки E-mehmon — факт будет записан в архив смены.
                            </span>
                          </div>
                        )}
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                          Комментарий к передаче смены (утренняя смена увидит в архиве)
                        </label>
                        <textarea
                          rows={2}
                          value={auditNotes}
                          onChange={(e) => setAuditNotes(e.target.value)}
                          placeholder="Например: кухня обработана в 00:00, ранний заезд в Small-2 в 05:30, багаж #B14 у ресепшн."
                          className="ops-input w-full px-3 py-2 text-xs"
                        />
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-5 py-3.5 border-t border-[var(--border-subtle)] bg-[var(--bg-elevated)] flex items-center justify-between gap-3 shrink-0">
              <button
                type="button"
                disabled={step === 1 || Boolean(completedRecordId)}
                onClick={() => setStep((prev) => Math.max(1, prev - 1) as 1 | 2 | 3 | 4 | 5 | 6)}
                className="px-3.5 py-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-xs font-semibold text-[var(--text-secondary)] disabled:opacity-40 inline-flex items-center gap-1.5 transition-colors"
              >
                <ArrowLeft className="w-3.5 h-3.5" strokeWidth={1.75} />
                Назад
              </button>

              {step < 6 ? (
                <button
                  type="button"
                  onClick={() => setStep((prev) => Math.min(6, prev + 1) as 1 | 2 | 3 | 4 | 5 | 6)}
                  className="ops-brand-btn px-4 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5"
                >
                  Далее
                  <ArrowRight className="w-3.5 h-3.5" strokeWidth={1.75} />
                </button>
              ) : completedRecordId ? (
                <button
                  type="button"
                  onClick={() => setNightAuditOpen(false)}
                  className="ops-brand-btn px-4 py-2 rounded-xl text-xs font-semibold"
                >
                  Готово
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleCloseDay}
                  className="ops-brand-btn px-4 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5"
                >
                  <MoonStar className="w-3.5 h-3.5" strokeWidth={1.75} />
                  Закрыть операционный день ({opDate})
                </button>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
