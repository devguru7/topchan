import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Chrome,
  DownloadCloud,
  FileSpreadsheet,
  RefreshCw,
  ShieldCheck,
  X,
} from 'lucide-react';
import { useOps } from '../context/OpsContext';
import { SAMPLE_MRZ_ITALY, SAMPLE_MRZ_KOREA, parseTd3Mrz } from '../utils/mrz';
import { CopyButton, SegmentedControl, StatusPill } from './ui';

export const ChromeSidePanel: React.FC<{ onClose?: () => void }> = ({ onClose }) => {
  const { state, importBnovoDemoBooking, markGuestEmehmonRegistered, pushToast } = useOps();
  const [bridgeTab, setBridgeTab] = useState<'bnovo' | 'emehmon'>('bnovo');
  const [mrzDemo, setMrzDemo] = useState(SAMPLE_MRZ_ITALY);

  const activeForeignBookings = state.bookings.filter(
    (b) => b.status === 'active' && b.guests.some((g) => g.isForeigner)
  );
  const parsedMrz = parseTd3Mrz(mrzDemo);

  const emehmonGuestDataJson = useMemo(
    () =>
      JSON.stringify(
        {
          hostelId: state.propertyId,
          surname: parsedMrz.surname,
          givenName: parsedMrz.givenName,
          passportNo: parsedMrz.passportNo,
          citizenship: parsedMrz.nationality,
          birthDate: parsedMrz.dob,
          sex: parsedMrz.sex,
          documentExpiry: parsedMrz.expiryDate,
        },
        null,
        2
      ),
    [state.propertyId, parsedMrz]
  );

  return (
    <aside
      aria-label="Боковая панель Chrome — Мост Bnovo и E-mehmon"
      className="h-full bg-[var(--bg-surface)] border-l border-[var(--border-subtle)] flex flex-col w-full"
    >
      <div className="px-4 h-16 border-b border-[var(--border-subtle)] flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <Chrome
            className="w-4 h-4 shrink-0"
            strokeWidth={1.75}
            style={{ color: 'var(--tone-cobalt-fg)' }}
          />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-[var(--text-primary)] truncate">
              Мост Bnovo / E-mehmon
            </h2>
            <p className="text-xs text-[var(--text-muted)] truncate">
              Панель расширения браузера
            </p>
          </div>
        </div>
        {onClose && (
          <button
            type="button"
            aria-label="Скрыть панель моста"
            onClick={onClose}
            className="p-2 rounded-xl text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
          >
            <X className="w-4 h-4" strokeWidth={1.75} />
          </button>
        )}
      </div>

      {/* Mode Switcher */}
      <div className="p-3 border-b border-[var(--border-subtle)]">
        <SegmentedControl
          layoutId="chromeBridgeMode"
          ariaLabel="Режим моста браузера"
          fullWidth
          size="sm"
          value={bridgeTab}
          onChange={setBridgeTab}
          options={[
            { id: 'bnovo', label: 'Bnovo PMS' },
            { id: 'emehmon', label: 'E-mehmon MRZ' },
          ]}
        />
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {bridgeTab === 'bnovo' ? (
          <>
            <div className="ops-panel p-3.5 space-y-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-[var(--text-muted)]">Активная вкладка</span>
                <span
                  className="font-mono font-medium"
                  style={{ color: 'var(--tone-cobalt-fg)' }}
                >
                  online.bnovo.ru
                </span>
              </div>
              <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                Считывает открытую карточку брони из Bnovo и создаёт заселение в Topchan Ops без
                ручного перепечатывания.
              </p>
              <button
                type="button"
                onClick={importBnovoDemoBooking}
                className="w-full py-2.5 px-3 rounded-xl bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-xs font-semibold transition-colors flex items-center justify-center gap-2"
              >
                <DownloadCloud className="w-4 h-4" strokeWidth={1.75} />
                Прочитать бронь из Bnovo
              </button>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-[var(--text-secondary)]">
                  Синхронизация категорий
                </span>
                <StatusPill tone={state.integrations.bnovoConnected ? 'emerald' : 'amber'}>
                  {state.integrations.bnovoConnected ? 'Подключено' : 'Пауза'}
                </StatusPill>
              </div>
              <div className="divide-y divide-[var(--border-subtle)] border border-[var(--border-subtle)] rounded-xl bg-[var(--bg-elevated)] overflow-hidden">
                {state.roomCategories.slice(0, 6).map((cat) => (
                  <div key={cat.id} className="px-3 py-2 flex items-center justify-between text-xs">
                    <span className="text-[var(--text-primary)] font-medium">{cat.name}</span>
                    <span className="font-mono text-[var(--text-muted)] tabular-nums">
                      {cat.bnovoCategoryId} · ${cat.pricesUsd[1]}
                    </span>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() =>
                  pushToast(
                    'Bnovo синхронизирован',
                    `Проверено ${state.physicalRooms.filter((r) => !r.archived).length} комнат и ${state.bookings.filter((b) => b.status === 'active').length} броней`,
                    'cobalt'
                  )
                }
                className="w-full py-2 px-3 rounded-xl bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] text-xs font-semibold text-[var(--text-primary)] border border-[var(--border-subtle)] flex items-center justify-center gap-2 transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" strokeWidth={1.75} />
                Сверить квоты с Bnovo
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="ops-panel p-3.5 space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-[var(--text-muted)]">Портал МВД РУз</span>
                <span
                  className="font-mono font-medium"
                  style={{ color: 'var(--tone-emerald-fg)' }}
                >
                  emehmon.uz
                </span>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => setMrzDemo(SAMPLE_MRZ_ITALY)}
                  className="py-1.5 px-2 rounded-xl bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] text-xs font-medium text-[var(--text-secondary)] border border-[var(--border-subtle)]"
                >
                  Паспорт ITA
                </button>
                <button
                  type="button"
                  onClick={() => setMrzDemo(SAMPLE_MRZ_KOREA)}
                  className="py-1.5 px-2 rounded-xl bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] text-xs font-medium text-[var(--text-secondary)] border border-[var(--border-subtle)]"
                >
                  Паспорт KOR
                </button>
              </div>
              <textarea
                aria-label="Строки MRZ для автозаполнения E-mehmon"
                value={mrzDemo}
                onChange={(e) => setMrzDemo(e.target.value)}
                rows={3}
                className="w-full ops-input p-2.5 font-mono text-xs"
              />
              {parsedMrz.valid && (
                <div className="text-xs space-y-1 text-[var(--text-secondary)] font-mono tabular-nums">
                  <div>ФИО: {parsedMrz.fullName}</div>
                  <div>
                    Паспорт: {parsedMrz.passportNo} · {parsedMrz.nationality}
                  </div>
                  <div>Дата рожд.: {parsedMrz.dob}</div>
                </div>
              )}
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() =>
                    pushToast(
                      'Форма E-mehmon заполнена',
                      `${parsedMrz.fullName} (${parsedMrz.passportNo}) — поля вставлены в портал`,
                      'emerald'
                    )
                  }
                  className="w-full py-2.5 px-3 rounded-xl bg-[#059669] hover:bg-[#047857] text-white text-xs font-semibold transition-colors flex items-center justify-center gap-2"
                >
                  <FileSpreadsheet className="w-4 h-4" strokeWidth={1.75} />
                  Заполнить E-mehmon (MRZ)
                </button>
                <CopyButton
                  text={emehmonGuestDataJson}
                  label="Скопировать данные гостя"
                  onCopied={() =>
                    pushToast(
                      'Данные гостя скопированы',
                      `${parsedMrz.fullName} · ${parsedMrz.passportNo}`,
                      'cobalt'
                    )
                  }
                  className="w-full"
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-xs font-semibold text-[var(--text-secondary)]">
                Иностранцы на смене ({activeForeignBookings.length})
              </div>
              <div className="space-y-2">
                {activeForeignBookings.map((b) =>
                  b.guests
                    .filter((g) => g.isForeigner)
                    .map((g) => (
                      <div
                        key={g.id}
                        className="p-3 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-[var(--text-primary)] truncate">
                            {g.fullName}
                          </div>
                          <div className="text-xs text-[var(--text-muted)] font-mono tabular-nums">
                            {g.citizenship} · {g.passportNo}
                          </div>
                        </div>
                        {g.emehmonRegistered ? (
                          <StatusPill tone="emerald" icon={ShieldCheck}>
                            Учтён
                          </StatusPill>
                        ) : (
                          <button
                            type="button"
                            onClick={() => markGuestEmehmonRegistered(b.id, g.id)}
                            className="px-2.5 py-1.5 rounded-xl text-xs font-semibold shrink-0 inline-flex items-center gap-1 border"
                            style={{
                              backgroundColor: 'var(--tone-cobalt-bg)',
                              borderColor: 'var(--tone-cobalt-border)',
                              color: 'var(--tone-cobalt-fg)',
                            }}
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" strokeWidth={1.75} />
                            Внести
                          </button>
                        )}
                      </div>
                    ))
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </aside>
  );
};
