import React, { useState } from 'react';
import {
  CheckCircle2,
  Chrome,
  Copy,
  DownloadCloud,
  FileSpreadsheet,
  RefreshCw,
  ShieldCheck,
  X,
} from 'lucide-react';
import { useOps } from '../context/OpsContext';
import { SAMPLE_MRZ_ITALY, SAMPLE_MRZ_KOREA, parseTd3Mrz } from '../utils/mrz';

export const ChromeSidePanel: React.FC<{ onClose?: () => void }> = ({ onClose }) => {
  const { state, importBnovoDemoBooking, markGuestEmehmonRegistered, pushToast } = useOps();
  const [bridgeTab, setBridgeTab] = useState<'bnovo' | 'emehmon'>('bnovo');
  const [mrzDemo, setMrzDemo] = useState(SAMPLE_MRZ_ITALY);

  const activeForeignBookings = state.bookings.filter(
    (b) => b.status === 'active' && b.guests.some((g) => g.isForeigner)
  );
  const parsedMrz = parseTd3Mrz(mrzDemo);

  const handleCopyEmehmonPayload = () => {
    const json = JSON.stringify(
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
    );
    navigator.clipboard?.writeText(json).catch(() => {});
    pushToast('JSON для E-mehmon скопирован', `${parsedMrz.fullName} · ${parsedMrz.passportNo}`, 'cobalt');
  };

  return (
    <aside
      aria-label="Chrome Side Panel — Мост Bnovo и E-mehmon"
      className="h-full bg-[#121826] border-l border-white/[0.08] flex flex-col w-full"
    >
      <div className="px-4 py-3.5 border-b border-white/[0.08] flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Chrome className="w-4 h-4 text-[#3B82F6] shrink-0" />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-white truncate">Chrome Side Panel</h2>
            <p className="text-xs text-slate-400 truncate">Мост Bnovo &amp; E-mehmon</p>
          </div>
        </div>
        {onClose && (
          <button
            type="button"
            aria-label="Скрыть панель моста"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-[#1A2234] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Mode Switcher */}
      <div className="p-3 border-b border-white/[0.08]">
        <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-[#0B0F17] border border-white/[0.06]">
          <button
            type="button"
            onClick={() => setBridgeTab('bnovo')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
              bridgeTab === 'bnovo'
                ? 'bg-[#1A2234] text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Bnovo PMS
          </button>
          <button
            type="button"
            onClick={() => setBridgeTab('emehmon')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
              bridgeTab === 'emehmon'
                ? 'bg-[#1A2234] text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            E-mehmon MRZ
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {bridgeTab === 'bnovo' ? (
          <>
            <div className="bg-[#0B0F17] border border-white/[0.08] rounded-xl p-3.5 space-y-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">Активная вкладка ПК</span>
                <span className="text-[#3B82F6] font-mono">online.bnovo.ru</span>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                Считывает открытую карточку брони из Bnovo и создаёт заселение в Topchan Ops без
                ручного перепечатывания.
              </p>
              <button
                type="button"
                onClick={importBnovoDemoBooking}
                className="w-full py-2.5 px-3 rounded-lg bg-[#3B82F6] hover:bg-blue-500 text-white text-xs font-semibold transition-colors flex items-center justify-center gap-2"
              >
                <DownloadCloud className="w-4 h-4" />
                Прочитать бронь из Bnovo
              </button>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-slate-300">Синхронизация категорий</span>
                <span className="text-[#10B981]">
                  {state.integrations.bnovoConnected ? 'Подключено' : 'Пауза'}
                </span>
              </div>
              <div className="divide-y divide-white/[0.06] border border-white/[0.08] rounded-xl bg-[#0B0F17] overflow-hidden">
                {state.roomCategories.slice(0, 6).map((cat) => (
                  <div key={cat.id} className="px-3 py-2 flex items-center justify-between text-xs">
                    <span className="text-slate-200">{cat.name}</span>
                    <span className="font-mono text-slate-400 tabular-nums">
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
                className="w-full py-2 px-3 rounded-lg bg-[#1A2234] hover:bg-slate-700/80 text-xs font-medium text-slate-200 border border-white/[0.08] flex items-center justify-center gap-2 transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Сверить квоты с Bnovo
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="bg-[#0B0F17] border border-white/[0.08] rounded-xl p-3.5 space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">Портал МВД РУз</span>
                <span className="text-[#10B981] font-mono">emehmon.uz</span>
              </div>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => setMrzDemo(SAMPLE_MRZ_ITALY)}
                  className="flex-1 py-1.5 px-2 rounded-lg bg-[#1A2234] hover:bg-slate-700 text-xs text-slate-200 border border-white/[0.08]"
                >
                  Паспорт ITA
                </button>
                <button
                  type="button"
                  onClick={() => setMrzDemo(SAMPLE_MRZ_KOREA)}
                  className="flex-1 py-1.5 px-2 rounded-lg bg-[#1A2234] hover:bg-slate-700 text-xs text-slate-200 border border-white/[0.08]"
                >
                  Паспорт KOR
                </button>
              </div>
              <textarea
                aria-label="Строки MRZ для автозаполнения E-mehmon"
                value={mrzDemo}
                onChange={(e) => setMrzDemo(e.target.value)}
                rows={3}
                className="w-full bg-[#121826] border border-white/[0.08] rounded-lg p-2 font-mono text-xs text-slate-200 focus:outline-none focus:border-[#3B82F6]"
              />
              {parsedMrz.valid && (
                <div className="text-xs space-y-1 text-slate-300 font-mono tabular-nums">
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
                      'Форма E-mehmon заполнена (MRZ)',
                      `${parsedMrz.fullName} (${parsedMrz.passportNo}) — поля вставлены в портал`,
                      'emerald'
                    )
                  }
                  className="w-full py-2.5 px-3 rounded-lg bg-[#10B981] hover:bg-emerald-600 text-slate-950 text-xs font-semibold transition-colors flex items-center justify-center gap-2"
                >
                  <FileSpreadsheet className="w-4 h-4" />
                  Заполнить E-mehmon (MRZ)
                </button>
                <button
                  type="button"
                  onClick={handleCopyEmehmonPayload}
                  className="w-full py-2 px-3 rounded-lg bg-[#1A2234] hover:bg-slate-700 text-xs font-medium text-slate-200 border border-white/[0.08] flex items-center justify-center gap-2"
                >
                  <Copy className="w-3.5 h-3.5" />
                  Скопировать JSON
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-xs font-medium text-slate-300">
                Иностранцы на смене ({activeForeignBookings.length})
              </div>
              <div className="space-y-2">
                {activeForeignBookings.map((b) =>
                  b.guests
                    .filter((g) => g.isForeigner)
                    .map((g) => (
                      <div
                        key={g.id}
                        className="p-3 rounded-xl bg-[#0B0F17] border border-white/[0.08] flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-white truncate">
                            {g.fullName}
                          </div>
                          <div className="text-xs text-slate-400 font-mono tabular-nums">
                            {g.citizenship} · {g.passportNo}
                          </div>
                        </div>
                        {g.emehmonRegistered ? (
                          <span className="inline-flex items-center gap-1 text-xs text-[#10B981] shrink-0">
                            <ShieldCheck className="w-3.5 h-3.5" />
                            Учтён
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => markGuestEmehmonRegistered(b.id, g.id)}
                            className="px-2.5 py-1.5 rounded-lg bg-[#3B82F6]/20 hover:bg-[#3B82F6]/30 text-[#3B82F6] text-xs font-medium shrink-0 inline-flex items-center gap-1"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
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
