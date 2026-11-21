import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertTriangle,
  Camera,
  CheckSquare,
  Copy,
  FileText,
  Loader2,
  ScanLine,
  ShieldCheck,
  UserPlus,
  X,
} from 'lucide-react';
import { useOps } from '../../context/OpsContext';
import type { CashPocketId, CurrencyCode } from '../../types/ops';
import { parseTd3Mrz, SAMPLE_MRZ_ITALY, SAMPLE_MRZ_KOREA } from '../../utils/mrz';
import {
  calcAccommodationUzs,
  calcDualRateChange,
  calcTouristTaxPerNightUzs,
  formatUsd,
  formatUzs,
  round2,
} from '../../utils/math';
import { addDaysIso, getTashkentTodayIso } from '../../utils/time';
import { findAlternativeFreeRooms, findRoomConflicts } from '../../utils/availability';
import { extractPassportMrzFromPhoto } from '../../services/aiService';

export const CheckInModal: React.FC = () => {
  const {
    state,
    checkInPreselect,
    closeCheckInModal,
    checkIn,
    pushToast,
  } = useOps();

  const isOpen = checkInPreselect !== null;
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const allRoomOptions = useMemo(() => {
    const items: Array<{
      key: string;
      roomId: string;
      bedId?: string;
      label: string;
      categoryId: string;
      defaultRate: number;
      isCurrentlyFree: boolean;
    }> = [];
    for (const room of state.physicalRooms) {
      if (room.archived) continue;
      const cat = state.roomCategories.find((c) => c.id === room.categoryId);
      const defaultRate = cat?.pricesUsd[1] ?? 18;
      if (room.beds) {
        for (const bed of room.beds) {
          items.push({
            key: `${room.id}:${bed.id}`,
            roomId: room.id,
            bedId: bed.id,
            label: `${room.code} · Койка ${bed.label} (${bed.tier}) — $${defaultRate}/н`,
            categoryId: room.categoryId,
            defaultRate,
            isCurrentlyFree: bed.status === 'available',
          });
        }
      } else {
        items.push({
          key: room.id,
          roomId: room.id,
          label: `${room.code} — $${defaultRate}/н`,
          categoryId: room.categoryId,
          defaultRate,
          isCurrentlyFree: room.status === 'available',
        });
      }
    }
    return items;
  }, [state.physicalRooms, state.roomCategories]);

  const [selectedKey, setSelectedKey] = useState('');
  const [fromDate, setFromDate] = useState(() => getTashkentTodayIso());
  const [nights, setNights] = useState(2);
  const [nightlyRate, setNightlyRate] = useState(18);
  const [source, setSource] = useState<'Bnovo' | 'Walk-in' | 'QR Direct' | 'Telegram'>('Bnovo');

  // MRZ & Guest data
  const [mrzInput, setMrzInput] = useState('');
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrNote, setOcrNote] = useState<string | null>(null);
  const [fullName, setFullName] = useState('');
  const [citizenship, setCitizenship] = useState('ITA');
  const [passportNo, setPassportNo] = useState('');
  const [dob, setDob] = useState('1994-05-15');
  const [age, setAge] = useState(32);

  // Payment
  const [payNow, setPayNow] = useState(true);
  const [payCurrency, setPayCurrency] = useState<CurrencyCode>('USD');
  const [payPocket, setPayPocket] = useState<CashPocketId>('cash_usd');
  const [payAmount, setPayAmount] = useState(36);

  // Mandatory reception checklist
  const [chkOriginalPassport, setChkOriginalPassport] = useState(false);
  const [chkVisaChecked, setChkVisaChecked] = useState(false);
  const [chkBnovoPaid, setChkBnovoPaid] = useState(false);
  const [chkEmehmonDone, setChkEmehmonDone] = useState(false);
  const [chkTourDone, setChkTourDone] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const preKey = checkInPreselect?.bedId
      ? `${checkInPreselect.roomId}:${checkInPreselect.bedId}`
      : checkInPreselect?.roomId ?? '';
    const found =
      allRoomOptions.find((o) => o.key === preKey) ??
      allRoomOptions.find((o) => o.isCurrentlyFree) ??
      allRoomOptions[0];
    if (found) {
      setSelectedKey(found.key);
      setNightlyRate(found.defaultRate);
      setPayAmount(round2(found.defaultRate * 2));
    }
    setFromDate(checkInPreselect?.fromDate || getTashkentTodayIso());
    setNights(2);
    setMrzInput('');
    setOcrNote(null);
    setFullName('');
    setPassportNo('');
    setCitizenship('ITA');
    setDob('1994-05-15');
    setAge(32);
    setChkOriginalPassport(false);
    setChkVisaChecked(false);
    setChkBnovoPaid(false);
    setChkEmehmonDone(false);
    setChkTourDone(false);
  }, [isOpen, checkInPreselect, allRoomOptions]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) closeCheckInModal();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, closeCheckInModal]);

  const mrzParsed = useMemo(() => {
    if (!mrzInput.trim()) return null;
    return parseTd3Mrz(mrzInput);
  }, [mrzInput]);

  const applyMrzString = (raw: string) => {
    setMrzInput(raw);
    const res = parseTd3Mrz(raw);
    if (res.valid) {
      setFullName(res.fullName);
      setCitizenship(res.nationality);
      setPassportNo(res.passportNo);
      setDob(res.dob);
      setAge(res.age);
      setChkOriginalPassport(true);
      pushToast('MRZ распознан', `${res.fullName} · ${res.passportNo} (${res.nationality})`, 'emerald');
    }
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      pushToast('Неверный формат файла', 'Загрузите изображение паспорта (JPG / PNG / WebP)', 'rose');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      pushToast('Файл слишком большой', 'Максимальный размер фото паспорта — 5 МБ', 'rose');
      return;
    }

    setOcrLoading(true);
    setOcrNote(null);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('read_failed'));
        reader.readAsDataURL(file);
      });
      const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
      const result = await extractPassportMrzFromPhoto(base64, file.type);
      if (result.mrzRaw) {
        applyMrzString(result.mrzRaw);
        setOcrNote(result.note);
      } else {
        setOcrNote(result.note);
        pushToast('OCR-подсказка', result.note, 'amber');
      }
    } catch {
      pushToast('Не удалось прочитать файл', 'Попробуйте вставить 2 строки MRZ вручную', 'rose');
    } finally {
      setOcrLoading(false);
    }
  };

  const selectedOption = allRoomOptions.find((o) => o.key === selectedKey);
  const toDate = addDaysIso(fromDate, Math.max(1, nights));

  // Real-time Overbooking Conflict Check + Alternative Suggestions
  const conflicts = useMemo(() => {
    if (!selectedOption) return [];
    return findRoomConflicts(
      state.bookings,
      selectedOption.roomId,
      selectedOption.bedId,
      fromDate,
      toDate
    );
  }, [state.bookings, selectedOption, fromDate, toDate]);

  const alternativeRooms = useMemo(() => {
    if (conflicts.length === 0 || !selectedOption) return [];
    return findAlternativeFreeRooms(
      state.physicalRooms,
      state.bookings,
      selectedOption.categoryId,
      fromDate,
      toDate
    ).slice(0, 6);
  }, [conflicts.length, selectedOption, state.physicalRooms, state.bookings, fromDate, toDate]);

  const paymentPockets = useMemo(
    () => state.pockets.filter((p) => p.id !== 'safe'),
    [state.pockets]
  );
  const isCashPocket =
    payPocket === 'cash_uzs' || payPocket === 'cash_usd' || payPocket === 'cash_eur';

  const totalUsd = round2(Math.max(1, nights) * nightlyRate);
  const totalUzs = calcAccommodationUzs(totalUsd, state.currency.accRate);

  const payCalc = useMemo(
    () =>
      calcDualRateChange({
        billUsd: totalUsd,
        receivedCurrency: payCurrency,
        receivedAmount: payNow ? Math.max(0, payAmount) : 0,
        accRate: state.currency.accRate,
        exRate: state.currency.exRate,
        cbuUsd: state.currency.cbuUsd,
        cbuEur: state.currency.cbuEur,
      }),
    [totalUsd, payCurrency, payNow, payAmount, state.currency]
  );

  const paidUsdEq = payNow && payAmount > 0 ? payCalc.receivedUsdEquivalent : 0;
  const changeUzs = payNow && isCashPocket ? payCalc.changeUzs : 0;

  const activePhysicalCount = state.physicalRooms.filter((r) => !r.archived).length;
  const normalizedCitizenship = citizenship.trim().toUpperCase() || 'UZB';
  const isForeignGuest = normalizedCitizenship !== 'UZB';
  const dailyTaxUzs = calcTouristTaxPerNightUzs(
    { age, isForeigner: isForeignGuest },
    state.currency.bcvUzs,
    activePhysicalCount
  );
  const previewTouristTaxUzs = dailyTaxUzs * Math.max(1, nights);
  const taxRatePct = activePhysicalCount <= 10 ? 5 : 10;

  const allChecked =
    chkOriginalPassport && chkVisaChecked && chkBnovoPaid && chkEmehmonDone && chkTourDone;
  const canSubmit = Boolean(
    selectedOption &&
      conflicts.length === 0 &&
      fullName.trim().length >= 2 &&
      passportNo.trim().length >= 4 &&
      allChecked
  );

  const handleCopyEmehmonJson = () => {
    const payload = {
      propertyId: state.propertyId,
      fullName: fullName || 'Guest',
      passportNo: passportNo || '-',
      citizenship,
      dob,
      room: selectedOption?.label ?? '',
      fromDate,
      nights,
    };
    navigator.clipboard?.writeText(JSON.stringify(payload, null, 2)).catch(() => {});
    pushToast('JSON для E-mehmon скопирован', `${payload.fullName} · ${payload.passportNo}`, 'cobalt');
  };

  const handleCopyGuestMemo = () => {
    const { wifiSsid, wifiPass, doorCode } = state.integrations;
    const memo = [
      `Добро пожаловать в Topchan Hostel (Ташкент)! / Welcome to Topchan Hostel!`,
      `Wi-Fi: ${wifiSsid} · Пароль / Password: ${wifiPass}`,
      `Код входной двери / Door code: ${doorCode}`,
      `Бесплатный завтрак / Free breakfast: 08:00–10:00 (поздний $2)`,
      `Кухня / Kitchen: открыта до 00:00 (просьба мыть посуду за собой)`,
      `Стирка / Laundry: быстрая 22 мин — $2, средняя 55 мин — $3`,
      `Выезд / Check-out: до 12:00`,
    ].join('\n');
    navigator.clipboard?.writeText(memo).catch(() => {});
    pushToast('Памятка гостю (RU/EN) скопирована', `Wi-Fi: ${wifiPass} · Дверь: ${doorCode}`, 'emerald');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOption || !canSubmit) return;
    checkIn({
      roomId: selectedOption.roomId,
      bedId: selectedOption.bedId,
      fromDate,
      nights: Math.max(1, nights),
      nightlyRateUsd: nightlyRate,
      source,
      guests: [
        {
          fullName: fullName.trim(),
          citizenship: citizenship.trim().toUpperCase() || 'UZB',
          age: Math.max(0, age),
          passportNo: passportNo.trim().toUpperCase(),
          dob,
          isForeigner: citizenship.trim().toUpperCase() !== 'UZB',
          mrzRaw: mrzInput.trim() || undefined,
          emehmonRegistered: chkEmehmonDone,
          emehmonCheckedOut: false,
          registrationSlipPrinted: false,
          keyIssued: true,
        },
      ],
      initialPayment:
        payNow && payAmount > 0
          ? {
              amountUsdEquivalent: Math.min(totalUsd, paidUsdEq),
              originalCurrency: payCurrency,
              originalAmount: payAmount,
              pocketId: payPocket,
            }
          : undefined,
      changeUzsOut: changeUzs > 0 ? changeUzs : undefined,
    });
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5 overflow-y-auto"
          onClick={closeCheckInModal}
        >
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 300, damping: 28 }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Заселение гостя и сканер MRZ"
            className="w-full max-w-3xl bg-[#121826] border border-white/[0.1] rounded-2xl shadow-2xl overflow-hidden my-auto max-h-[92vh] flex flex-col"
          >
            <div className="px-5 py-4 border-b border-white/[0.08] flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <UserPlus className="w-5 h-5 text-[#10B981]" />
                <div>
                  <h2 className="text-base font-semibold text-white">Заселение гостя (Check-in)</h2>
                  <p className="text-xs text-slate-400">
                    ICAO TD3 MRZ парсер · защита от овербукинга · чек-лист Bnovo &amp; E-mehmon
                  </p>
                </div>
              </div>
              <button
                type="button"
                aria-label="Закрыть окно заселения"
                onClick={closeCheckInModal}
                className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-[#1A2234]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="overflow-y-auto p-5 space-y-5">
              {/* MRZ Scanner + Photo OCR Section */}
              <div className="bg-[#0B0F17] border border-white/[0.08] rounded-xl p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-semibold text-white">
                    <ScanLine className="w-4 h-4 text-[#3B82F6]" />
                    <span>Сканер MRZ (2 строки TD3 или фото паспорта)</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={handlePhotoUpload}
                      className="hidden"
                    />
                    <button
                      type="button"
                      disabled={ocrLoading}
                      onClick={() => fileInputRef.current?.click()}
                      className="px-2.5 py-1 rounded-lg bg-[#3B82F6]/20 hover:bg-[#3B82F6]/30 text-xs font-semibold text-blue-200 border border-[#3B82F6]/40 inline-flex items-center gap-1.5"
                    >
                      {ocrLoading ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Camera className="w-3.5 h-3.5" />
                      )}
                      Скан фото паспорта
                    </button>
                    <button
                      type="button"
                      onClick={() => applyMrzString(SAMPLE_MRZ_ITALY)}
                      className="px-2.5 py-1 rounded-lg bg-[#1A2234] hover:bg-slate-700 text-xs text-slate-200 border border-white/[0.08]"
                    >
                      Пример: Италия (ITA)
                    </button>
                    <button
                      type="button"
                      onClick={() => applyMrzString(SAMPLE_MRZ_KOREA)}
                      className="px-2.5 py-1 rounded-lg bg-[#1A2234] hover:bg-slate-700 text-xs text-slate-200 border border-white/[0.08]"
                    >
                      Пример: Корея (KOR)
                    </button>
                  </div>
                </div>
                <textarea
                  aria-label="Поле ввода MRZ паспорта"
                  rows={2}
                  value={mrzInput}
                  onChange={(e) => {
                    const v = e.target.value;
                    setMrzInput(v);
                    const res = parseTd3Mrz(v);
                    if (res.valid) {
                      setFullName(res.fullName);
                      setCitizenship(res.nationality);
                      setPassportNo(res.passportNo);
                      setDob(res.dob);
                      setAge(res.age);
                    }
                  }}
                  placeholder="Вставьте 2 строки MRZ из паспорта (например P<ITAROSSI<<MARCO...)"
                  className="w-full bg-[#121826] border border-white/[0.08] rounded-lg px-3 py-2 font-mono text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-[#3B82F6]"
                />
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="text-slate-400">
                    Фото обрабатывается только в памяти и никогда не сохраняется.
                  </span>
                  {ocrNote && <span className="text-blue-300">{ocrNote}</span>}
                </div>
                {mrzParsed && (
                  <div
                    className={`text-xs ${
                      mrzParsed.valid ? 'text-[#10B981]' : 'text-[#F59E0B]'
                    }`}
                  >
                    {mrzParsed.valid
                      ? `Распознано: ${mrzParsed.surname} ${mrzParsed.givenName} · Паспорт ${mrzParsed.passportNo} · ${mrzParsed.nationality} · ДР ${mrzParsed.dob} (${mrzParsed.age} лет)`
                      : mrzParsed.error}
                  </div>
                )}
              </div>

              {/* Room & Date Selection + Live Overbooking Alert */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Комната / Койка
                  </label>
                  <select
                    value={selectedKey}
                    onChange={(e) => {
                      const val = e.target.value;
                      setSelectedKey(val);
                      const opt = allRoomOptions.find((o) => o.key === val);
                      if (opt) {
                        setNightlyRate(opt.defaultRate);
                        setPayAmount(round2(opt.defaultRate * nights));
                      }
                    }}
                    className="w-full bg-[#0B0F17] border border-white/[0.1] rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-[#3B82F6]"
                  >
                    {allRoomOptions.map((opt) => (
                      <option key={opt.key} value={opt.key}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Дата заезда → выезда ({toDate})
                  </label>
                  <input
                    type="date"
                    value={fromDate}
                    onChange={(e) => setFromDate(e.target.value || getTashkentTodayIso())}
                    className="w-full bg-[#0B0F17] border border-white/[0.1] rounded-lg px-3 py-2 font-mono tabular-nums text-sm text-white focus:outline-none focus:border-[#3B82F6]"
                  />
                </div>

                {conflicts.length > 0 && (
                  <div className="sm:col-span-2 bg-[#F43F5E]/10 border border-[#F43F5E]/40 rounded-xl p-3.5 space-y-2.5">
                    <div className="flex items-start gap-2 text-xs text-rose-200">
                      <AlertTriangle className="w-4 h-4 text-[#F43F5E] shrink-0 mt-0.5" />
                      <div>
                        <p className="font-semibold text-[#F43F5E]">
                          Овербукинг заблокирован на даты {fromDate} → {toDate}
                        </p>
                        <p className="mt-0.5">
                          Пересечение с бронью {conflicts[0].bnovoId} ({conflicts[0].guestName}:{' '}
                          {conflicts[0].fromDate} — {conflicts[0].toDate}).
                        </p>
                      </div>
                    </div>
                    {alternativeRooms.length > 0 && (
                      <div className="space-y-1.5">
                        <p className="text-xs font-medium text-slate-300">
                          Альтернативные свободные комнаты на эти даты (1 клик):
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {alternativeRooms.map((alt) => {
                            const key = alt.bedId ? `${alt.roomId}:${alt.bedId}` : alt.roomId;
                            return (
                              <button
                                key={key}
                                type="button"
                                onClick={() => {
                                  setSelectedKey(key);
                                  const opt = allRoomOptions.find((o) => o.key === key);
                                  if (opt) {
                                    setNightlyRate(opt.defaultRate);
                                    setPayAmount(round2(opt.defaultRate * nights));
                                  }
                                }}
                                className="px-2.5 py-1 rounded-lg bg-[#10B981]/15 hover:bg-[#10B981]/25 border border-[#10B981]/40 text-xs font-semibold text-emerald-200"
                              >
                                {alt.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    ФИО гостя (как в паспорте)
                  </label>
                  <input
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Marco Rossi"
                    className="w-full bg-[#0B0F17] border border-white/[0.1] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#3B82F6]"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">
                      Номер паспорта
                    </label>
                    <input
                      type="text"
                      required
                      value={passportNo}
                      onChange={(e) => setPassportNo(e.target.value)}
                      placeholder="YA4829103"
                      className="w-full bg-[#0B0F17] border border-white/[0.1] rounded-lg px-3 py-2 font-mono text-sm text-white focus:outline-none focus:border-[#3B82F6]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">
                      Гражданство
                    </label>
                    <input
                      type="text"
                      value={citizenship}
                      onChange={(e) => setCitizenship(e.target.value)}
                      placeholder="ITA / UZB"
                      className="w-full bg-[#0B0F17] border border-white/[0.1] rounded-lg px-3 py-2 font-mono text-sm text-white uppercase focus:outline-none focus:border-[#3B82F6]"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2.5">
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">Ночей</label>
                    <input
                      type="number"
                      min={1}
                      max={60}
                      value={nights}
                      onChange={(e) => {
                        const n = Math.max(1, parseInt(e.target.value, 10) || 1);
                        setNights(n);
                        setPayAmount(round2(n * nightlyRate));
                      }}
                      className="w-full bg-[#0B0F17] border border-white/[0.1] rounded-lg px-3 py-2 font-mono tabular-nums text-sm text-white focus:outline-none focus:border-[#3B82F6]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">
                      Тариф ($/н)
                    </label>
                    <input
                      type="number"
                      min={1}
                      value={nightlyRate}
                      onChange={(e) => {
                        const r = Math.max(1, parseFloat(e.target.value) || 1);
                        setNightlyRate(r);
                        setPayAmount(round2(nights * r));
                      }}
                      className="w-full bg-[#0B0F17] border border-white/[0.1] rounded-lg px-3 py-2 font-mono tabular-nums text-sm text-white focus:outline-none focus:border-[#3B82F6]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">
                      Возраст
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={110}
                      value={age}
                      onChange={(e) => setAge(parseInt(e.target.value, 10) || 0)}
                      className="w-full bg-[#0B0F17] border border-white/[0.1] rounded-lg px-3 py-2 font-mono tabular-nums text-sm text-white focus:outline-none focus:border-[#3B82F6]"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">
                      Дата рождения
                    </label>
                    <input
                      type="date"
                      value={dob}
                      onChange={(e) => setDob(e.target.value)}
                      className="w-full bg-[#0B0F17] border border-white/[0.1] rounded-lg px-3 py-2 font-mono tabular-nums text-sm text-white focus:outline-none focus:border-[#3B82F6]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">
                      Источник брони
                    </label>
                    <select
                      value={source}
                      onChange={(e) => setSource(e.target.value as typeof source)}
                      className="w-full bg-[#0B0F17] border border-white/[0.1] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#3B82F6]"
                    >
                      <option value="Bnovo">Bnovo</option>
                      <option value="Walk-in">Walk-in (с улицы)</option>
                      <option value="QR Direct">QR Прямая бронь</option>
                      <option value="Telegram">Telegram</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Live Uzbekistan Tourist Tax (БРВ) Preview */}
              <div className="bg-[#0B0F17] border border-white/[0.08] rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div>
                  <span className="font-semibold text-slate-200">
                    Туристический сбор РУз (БРВ {state.currency.bcvUzs.toLocaleString('ru-RU')} ·{' '}
                    {taxRatePct}%)
                  </span>
                  <p className="text-slate-400 mt-0.5">
                    {age < 16
                      ? `Ребёнок до 16 лет (${age} лет) — освобождён от турсбора (0 сум)`
                      : !isForeignGuest
                        ? `${Math.max(1, nights)} н. × ${formatUzs(dailyTaxUzs)} / ночь (гражданин РУз · 0.4% БРВ)`
                        : `${Math.max(1, nights)} н. × ${formatUzs(dailyTaxUzs)} / ночь (иностранец ${normalizedCitizenship})`}
                  </p>
                </div>
                <span className="font-mono tabular-nums text-sm font-bold text-[#10B981]">
                  {formatUzs(previewTouristTaxUzs)}
                </span>
              </div>

              {/* Payment block */}
              <div className="bg-[#0B0F17] border border-white/[0.08] rounded-xl p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="inline-flex items-center gap-2 text-sm font-medium text-white cursor-pointer">
                    <input
                      type="checkbox"
                      checked={payNow}
                      onChange={(e) => setPayNow(e.target.checked)}
                      className="w-4 h-4 accent-[#10B981]"
                    />
                    Принять оплату при заезде
                  </label>
                  <div className="text-xs font-mono tabular-nums text-slate-300">
                    К оплате: <strong className="text-white">{formatUsd(totalUsd)}</strong> ·{' '}
                    {formatUzs(totalUzs)} (Acc {state.currency.accRate})
                  </div>
                </div>
                {payNow && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">Карман кассы</label>
                      <select
                        value={payPocket}
                        onChange={(e) => {
                          const p = e.target.value as CashPocketId;
                          setPayPocket(p);
                          if (p === 'cash_usd') setPayCurrency('USD');
                          else if (p === 'cash_eur') setPayCurrency('EUR');
                          else setPayCurrency('UZS');
                        }}
                        className="w-full bg-[#121826] border border-white/[0.1] rounded-lg px-3 py-2 text-xs text-white"
                      >
                        {paymentPockets.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">Сумма ({payCurrency})</label>
                      <input
                        type="number"
                        min={0}
                        step="any"
                        value={payAmount}
                        onChange={(e) => setPayAmount(parseFloat(e.target.value) || 0)}
                        className="w-full bg-[#121826] border border-white/[0.1] rounded-lg px-3 py-2 font-mono tabular-nums text-xs text-white"
                      />
                    </div>
                    <div className="flex flex-col justify-center text-xs">
                      <span className="text-slate-400">
                        {isCashPocket
                          ? payCurrency === 'UZS'
                            ? 'Сдача (сумы → сумы, без спреда)'
                            : `Сдача (курс Ex ${state.currency.exRate})`
                          : 'Безналичная оплата'}
                      </span>
                      <span className="font-mono tabular-nums text-sm font-semibold text-[#F59E0B] mt-0.5">
                        {!isCashPocket
                          ? 'Без сдачи (безнал)'
                          : changeUzs > 0
                            ? formatUzs(changeUzs)
                            : '0 сум'}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* Mandatory Reception Checklist (No Check-All shortcut for legal compliance) */}
              <div className="bg-[#0B0F17] border border-white/[0.08] rounded-xl p-4 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-semibold text-white">
                    <CheckSquare className="w-4 h-4 text-[#F59E0B]" />
                    <span>Обязательный протокол заселения Topchan</span>
                  </div>
                  <span className="text-xs text-slate-400">
                    Подтвердите каждый пункт вручную
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  {[
                    {
                      checked: chkOriginalPassport,
                      set: setChkOriginalPassport,
                      label: 'Оригинал паспорта/ID проверен (никаких фото/сканов)',
                    },
                    {
                      checked: chkVisaChecked,
                      set: setChkVisaChecked,
                      label: 'Виза / регистрация и срок пребывания проверены',
                    },
                    {
                      checked: chkBnovoPaid,
                      set: setChkBnovoPaid,
                      label: 'Оплата отмечена в Bnovo',
                    },
                    {
                      checked: chkEmehmonDone,
                      set: setChkEmehmonDone,
                      label: 'Регистрация в E-mehmon оформлена',
                    },
                    {
                      checked: chkTourDone,
                      set: setChkTourDone,
                      label: 'Хостел показан (кухня до 00:00, душ, Wi-Fi)',
                    },
                  ].map((item) => (
                    <label
                      key={item.label}
                      className="flex items-start gap-2.5 p-2 rounded-lg hover:bg-[#1A2234]/60 cursor-pointer text-slate-200"
                    >
                      <input
                        type="checkbox"
                        checked={item.checked}
                        onChange={(e) => item.set(e.target.checked)}
                        className="mt-0.5 w-4 h-4 accent-[#10B981] shrink-0"
                      />
                      <span>{item.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Helper Copy Actions + Submit */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-white/[0.08]">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleCopyEmehmonJson}
                    className="px-3 py-2 rounded-lg bg-[#1A2234] hover:bg-slate-700 text-xs font-medium text-slate-200 border border-white/[0.08] inline-flex items-center gap-1.5"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    Скопировать JSON для E-mehmon
                  </button>
                  <button
                    type="button"
                    onClick={handleCopyGuestMemo}
                    className="px-3 py-2 rounded-lg bg-[#1A2234] hover:bg-slate-700 text-xs font-medium text-slate-200 border border-white/[0.08] inline-flex items-center gap-1.5"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    Скопировать памятку гостю (RU/EN)
                  </button>
                </div>

                <button
                  type="submit"
                  disabled={!canSubmit}
                  className="px-5 py-2.5 rounded-lg bg-[#10B981] hover:bg-emerald-600 disabled:bg-slate-700 disabled:text-slate-400 text-slate-950 text-sm font-semibold transition-colors inline-flex items-center gap-2"
                >
                  <ShieldCheck className="w-4 h-4" />
                  Заселить гостя
                </button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
