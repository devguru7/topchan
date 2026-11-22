import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Camera,
  CheckSquare,
  Loader2,
  ScanLine,
  ShieldCheck,
  UserPlus,
  X,
} from 'lucide-react';
import { useOps } from '../../context/OpsContext';
import type { CashPocketId, CurrencyCode } from '../../types/ops';
import {
  parseTd3MrzStrict,
  SAMPLE_MRZ_FEMALE_DE,
  SAMPLE_MRZ_ITALY,
  SAMPLE_MRZ_KOREA,
} from '../../utils/mrzParser';
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
import { CopyButton, StatusPill, StepProgress, TooltipHint } from '../ui';

const WIZARD_STEPS = [
  { id: 1, label: 'Гость и паспорт', hint: 'MRZ или вручную' },
  { id: 2, label: 'Комната и оплата', hint: 'Даты, тариф, касса' },
  { id: 3, label: 'Проверка правил', hint: 'E-mehmon и выдача ключа' },
] as const;

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
  const [step, setStep] = useState<1 | 2 | 3>(1);

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
        const femaleNote = cat?.femaleOnly ? ' · Женский' : '';
        for (const bed of room.beds) {
          items.push({
            key: `${room.id}:${bed.id}`,
            roomId: room.id,
            bedId: bed.id,
            label: `${room.code} · ${bed.label} (${bed.tier}${femaleNote}) — $${defaultRate}/н`,
            categoryId: room.categoryId,
            defaultRate,
            isCurrentlyFree: bed.status === 'available',
          });
        }
      } else {
        const metaNote = cat?.bedType
          ? ' · 1 большая кровать'
          : cat
            ? ` · до ${cat.maxOccupancy} чел.`
            : '';
        items.push({
          key: room.id,
          roomId: room.id,
          label: `${room.code}${metaNote} — $${defaultRate}/н`,
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
  const [sex, setSex] = useState<'M' | 'F' | 'X'>('M');

  // Payment
  const [payNow, setPayNow] = useState(true);
  const [payCurrency, setPayCurrency] = useState<CurrencyCode>('USD');
  const [payPocket, setPayPocket] = useState<CashPocketId>('cash_usd');
  const [payAmount, setPayAmount] = useState(36);

  // Mandatory reception checklist (individual manual confirmation required)
  const [chkOriginalPassport, setChkOriginalPassport] = useState(false);
  const [chkVisaChecked, setChkVisaChecked] = useState(false);
  const [chkBnovoPaid, setChkBnovoPaid] = useState(false);
  const [chkEmehmonDone, setChkEmehmonDone] = useState(false);
  const [chkTourDone, setChkTourDone] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setStep(1);
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
    setPayNow(true);
    setPayPocket('cash_usd');
    setPayCurrency('USD');
    setMrzInput('');
    setOcrNote(null);
    setFullName('');
    setPassportNo('');
    setCitizenship('ITA');
    setDob('1994-05-15');
    setAge(32);
    setSex('M');
    setChkOriginalPassport(false);
    setChkVisaChecked(false);
    setChkBnovoPaid(false);
    setChkEmehmonDone(false);
    setChkTourDone(false);
  }, [isOpen, checkInPreselect, allRoomOptions]);

  const mrzParsed = useMemo(() => {
    if (!mrzInput.trim()) return null;
    return parseTd3MrzStrict(mrzInput);
  }, [mrzInput]);

  const applyMrzString = (raw: string) => {
    setMrzInput(raw);
    const res = parseTd3MrzStrict(raw);
    if (res.valid) {
      setFullName(res.fullName);
      setCitizenship(res.nationality);
      setPassportNo(res.passportNo);
      setDob(res.dob);
      setAge(res.age);
      setSex(res.sex);
      setChkOriginalPassport(true);
      const sexLabel = res.sex === 'F' ? 'Жен' : res.sex === 'M' ? 'Муж' : 'Пол не указан (X)';
      const warnNeeded = !res.checkDigits.allValid || res.sex === 'X' || Boolean(res.isStateless);
      pushToast(
        warnNeeded ? 'MRZ распознан — проверьте данные' : 'MRZ распознан (ICAO OK)',
        `${res.fullName} · ${res.passportNo} (${res.nationality}, ${sexLabel})`,
        warnNeeded ? 'amber' : 'emerald'
      );
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
        pushToast('Подсказка сканера', result.note, 'amber');
      }
    } catch {
      pushToast('Не удалось прочитать файл', 'Попробуйте вставить 2 строки MRZ вручную', 'rose');
    } finally {
      setOcrLoading(false);
    }
  };

  const selectedOption = allRoomOptions.find((o) => o.key === selectedKey);
  const selectedCategory = useMemo(
    () => state.roomCategories.find((c) => c.id === selectedOption?.categoryId),
    [state.roomCategories, selectedOption?.categoryId]
  );
  const isFemaleOnlyViolation = Boolean(selectedCategory?.femaleOnly && sex === 'M');
  const toDate = addDaysIso(fromDate, Math.max(1, nights));

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

  const checklistItems = [
    {
      id: 'passport',
      checked: chkOriginalPassport,
      set: setChkOriginalPassport,
      label: 'Оригинал паспорта/ID проверен (никаких фото и сканов)',
    },
    {
      id: 'visa',
      checked: chkVisaChecked,
      set: setChkVisaChecked,
      label: 'Виза / регистрация и срок пребывания проверены',
    },
    {
      id: 'bnovo',
      checked: chkBnovoPaid,
      set: setChkBnovoPaid,
      label: 'Оплата и заезд отмечены в Bnovo',
    },
    {
      id: 'emehmon',
      checked: chkEmehmonDone,
      set: setChkEmehmonDone,
      label: 'Регистрация в E-mehmon оформлена',
    },
    {
      id: 'tour',
      checked: chkTourDone,
      set: setChkTourDone,
      label: 'Хостел показан (кухня до 00:00, душ, Wi-Fi, завтрак)',
    },
  ];
  const checkedCount = checklistItems.filter((item) => item.checked).length;
  const allChecked = checkedCount === checklistItems.length;

  const guestStepValid = fullName.trim().length >= 2 && passportNo.trim().length >= 4;
  const roomStepValid = Boolean(selectedOption && conflicts.length === 0 && !isFemaleOnlyViolation);
  const canSubmit = guestStepValid && roomStepValid && allChecked;

  const blockerReason = useMemo(() => {
    if (fullName.trim().length < 2) return 'Укажите ФИО гостя на шаге 1';
    if (passportNo.trim().length < 4) return 'Укажите номер паспорта (минимум 4 символа) на шаге 1';
    if (!selectedOption) return 'Выберите комнату или койку на шаге 2';
    if (isFemaleOnlyViolation) return 'Fem Dorm — женский дорм: выберите Mix/Six дорм или приватную комнату';
    if (conflicts.length > 0) return 'Выбранная комната занята на эти даты — выберите свободную';
    if (!allChecked) {
      const remaining = checklistItems.length - checkedCount;
      return `Отметьте оставшиеся пункты протокола (${remaining})`;
    }
    return null;
  }, [
    fullName,
    passportNo,
    selectedOption,
    isFemaleOnlyViolation,
    conflicts.length,
    allChecked,
    checklistItems.length,
    checkedCount,
  ]);

  const emehmonGuestDataText = useMemo(
    () =>
      JSON.stringify(
        {
          propertyId: state.propertyId,
          fullName: fullName || 'Guest',
          passportNo: passportNo || '-',
          citizenship: normalizedCitizenship,
          dob,
          room: selectedOption?.label ?? '',
          fromDate,
          nights,
        },
        null,
        2
      ),
    [state.propertyId, fullName, passportNo, normalizedCitizenship, dob, selectedOption?.label, fromDate, nights]
  );

  const guestMemoText = useMemo(() => {
    const { wifiSsid, wifiPass, doorCode } = state.integrations;
    return [
      `Добро пожаловать в Topchan Hostel (Ташкент)! / Welcome to Topchan Hostel!`,
      `Wi-Fi: ${wifiSsid} · Пароль / Password: ${wifiPass}`,
      `Код входной двери / Door code: ${doorCode}`,
      `Бесплатный завтрак / Free breakfast: 08:00–10:00 (поздний $2)`,
      `Кухня / Kitchen: открыта до 00:00 (просьба мыть посуду за собой)`,
      `Стирка / Laundry: быстрая 22 мин — $2, средняя 55 мин — $3`,
      `Выезд / Check-out: до 12:00`,
    ].join('\n');
  }, [state.integrations]);

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
          citizenship: normalizedCitizenship,
          age: Math.max(0, age),
          passportNo: passportNo.trim().toUpperCase(),
          dob,
          sex,
          isForeigner: normalizedCitizenship !== 'UZB',
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
          className="fixed inset-0 z-50 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5 overflow-y-auto"
          style={{ backgroundColor: 'var(--backdrop-scrim)' }}
          onClick={closeCheckInModal}
        >
          <motion.div
            initial={{ opacity: 0, y: 14, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 320, damping: 28, mass: 0.8 }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Заселение гостя"
            style={{ boxShadow: 'var(--shadow-popover)' }}
            className="w-full max-w-3xl rounded-2xl border border-[var(--border-strong)] bg-[var(--bg-surface)] overflow-hidden my-auto max-h-[92vh] flex flex-col"
          >
            {/* Header + 3-Step Bar */}
            <div className="px-5 py-4 border-b border-[var(--border-subtle)] space-y-3.5 shrink-0">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className="w-9 h-9 rounded-xl border flex items-center justify-center shrink-0"
                    style={{
                      backgroundColor: 'var(--tone-emerald-bg)',
                      borderColor: 'var(--tone-emerald-border)',
                      color: 'var(--tone-emerald-fg)',
                    }}
                  >
                    <UserPlus className="w-4 h-4" strokeWidth={1.75} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-base font-semibold text-[var(--text-primary)] truncate">
                        Новое заселение
                      </h2>
                      {selectedOption && (
                        <span
                          data-testid="checkin-prefill-summary"
                          className="text-xs font-mono font-semibold px-2 py-0.5 rounded-md border"
                          style={{
                            backgroundColor: 'var(--tone-cobalt-bg)',
                            borderColor: 'var(--tone-cobalt-border)',
                            color: 'var(--tone-cobalt-fg)',
                          }}
                        >
                          {selectedOption.label.split(' — ')[0]} · с {fromDate}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-[var(--text-muted)] truncate">
                      Сканер паспорта, проверка пересечений и протокол E-mehmon
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  aria-label="Закрыть окно заселения"
                  onClick={closeCheckInModal}
                  className="p-2 rounded-xl text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
                >
                  <X className="w-4 h-4" strokeWidth={1.75} />
                </button>
              </div>

              <StepProgress
                steps={WIZARD_STEPS}
                currentStep={step}
                onStepClick={(s) => setStep(s as 1 | 2 | 3)}
              />
            </div>

            {/* Wizard Body */}
            <form onSubmit={handleSubmit} className="flex-1 flex flex-col min-h-0">
              <div className="flex-1 overflow-y-auto p-5 space-y-5">
                {/* STEP 1: Guest & Passport */}
                {step === 1 && (
                  <div className="space-y-5">
                    <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2 text-xs font-semibold text-[var(--text-primary)]">
                          <ScanLine
                            className="w-4 h-4 shrink-0"
                            strokeWidth={1.75}
                            style={{ color: 'var(--tone-cobalt-fg)' }}
                          />
                          <span>Сканер паспорта (2 строки MRZ или фото)</span>
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
                            className="px-3 py-1.5 rounded-xl text-xs font-semibold border inline-flex items-center gap-1.5 transition-colors"
                            style={{
                              backgroundColor: 'var(--tone-cobalt-bg)',
                              borderColor: 'var(--tone-cobalt-border)',
                              color: 'var(--tone-cobalt-fg)',
                            }}
                          >
                            {ocrLoading ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" strokeWidth={1.75} />
                            ) : (
                              <Camera className="w-3.5 h-3.5" strokeWidth={1.75} />
                            )}
                            Скан фото паспорта
                          </button>
                          <button
                            type="button"
                            onClick={() => applyMrzString(SAMPLE_MRZ_ITALY)}
                            className="px-2.5 py-1.5 rounded-xl bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] text-xs font-medium text-[var(--text-secondary)] border border-[var(--border-subtle)] transition-colors"
                          >
                            Тест: Италия
                          </button>
                          <button
                            type="button"
                            onClick={() => applyMrzString(SAMPLE_MRZ_KOREA)}
                            className="px-2.5 py-1.5 rounded-xl bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] text-xs font-medium text-[var(--text-secondary)] border border-[var(--border-subtle)] transition-colors"
                          >
                            Тест: Корея
                          </button>
                          <button
                            type="button"
                            onClick={() => applyMrzString(SAMPLE_MRZ_FEMALE_DE)}
                            className="px-2.5 py-1.5 rounded-xl bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] text-xs font-medium text-[var(--text-secondary)] border border-[var(--border-subtle)] transition-colors"
                          >
                            Тест: ФРГ (Ж)
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
                          const res = parseTd3MrzStrict(v);
                          if (res.valid) {
                            setFullName(res.fullName);
                            setCitizenship(res.nationality);
                            setPassportNo(res.passportNo);
                            setDob(res.dob);
                            setAge(res.age);
                            setSex(res.sex);
                          }
                        }}
                        placeholder="Вставьте 2 строки MRZ из паспорта (например P<ITAROSSI<<MARCO...)"
                        className="ops-input w-full px-3 py-2 font-mono text-xs"
                      />

                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <span className="text-[var(--text-muted)]">
                          Фото обрабатывается только в памяти и не сохраняется.
                        </span>
                        {ocrNote && (
                          <span style={{ color: 'var(--tone-cobalt-fg)' }}>{ocrNote}</span>
                        )}
                      </div>

                      {mrzParsed && (
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                          <span
                            className="font-medium"
                            style={{
                              color: mrzParsed.valid
                                ? 'var(--tone-emerald-fg)'
                                : 'var(--tone-amber-fg)',
                            }}
                          >
                            {mrzParsed.valid
                              ? `Распознано: ${mrzParsed.surname} ${mrzParsed.givenName} · ${mrzParsed.passportNo} · ${mrzParsed.nationality} · ${mrzParsed.sex === 'F' ? 'Жен' : mrzParsed.sex === 'M' ? 'Муж' : 'Пол не указан (X)'} · ДР ${mrzParsed.dob}`
                              : mrzParsed.error}
                          </span>
                          {mrzParsed.valid && (
                            <span
                              className="px-2 py-0.5 rounded-md border font-mono text-[11px] font-semibold"
                              style={
                                mrzParsed.checkDigits.allValid
                                  ? {
                                      backgroundColor: 'var(--tone-emerald-bg)',
                                      borderColor: 'var(--tone-emerald-border)',
                                      color: 'var(--tone-emerald-fg)',
                                    }
                                  : {
                                      backgroundColor: 'var(--tone-amber-bg)',
                                      borderColor: 'var(--tone-amber-border)',
                                      color: 'var(--tone-amber-fg)',
                                    }
                              }
                            >
                              {mrzParsed.checkDigits.allValid
                                ? 'ICAO 9303: контрольные цифры OK'
                                : 'ICAO 9303: сверьте номер/даты вручную'}
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                          ФИО гостя (как в паспорте)
                        </label>
                        <input
                          type="text"
                          required
                          value={fullName}
                          onChange={(e) => setFullName(e.target.value)}
                          placeholder="Marco Rossi"
                          className="ops-input w-full px-3 py-2.5 text-sm"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-2.5">
                        <div>
                          <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                            Номер паспорта
                          </label>
                          <input
                            type="text"
                            required
                            value={passportNo}
                            onChange={(e) => setPassportNo(e.target.value)}
                            placeholder="YA4829103"
                            className="ops-input w-full px-3 py-2.5 font-mono text-sm uppercase"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                            Гражданство
                          </label>
                          <input
                            type="text"
                            value={citizenship}
                            onChange={(e) => setCitizenship(e.target.value)}
                            placeholder="ITA / UZB"
                            className="ops-input w-full px-3 py-2.5 font-mono text-sm uppercase"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2.5">
                        <div>
                          <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                            Дата рождения
                          </label>
                          <input
                            type="date"
                            value={dob}
                            onChange={(e) => setDob(e.target.value)}
                            className="ops-input w-full px-3 py-2.5 font-mono tabular-nums text-sm"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                            Возраст (лет)
                          </label>
                          <input
                            type="number"
                            min={0}
                            max={110}
                            value={age}
                            onChange={(e) => setAge(parseInt(e.target.value, 10) || 0)}
                            className="ops-input w-full px-3 py-2.5 font-mono tabular-nums text-sm"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2.5">
                        <div>
                          <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                            Пол (для Fem Dorm)
                          </label>
                          <select
                            value={sex}
                            onChange={(e) => setSex(e.target.value as 'M' | 'F' | 'X')}
                            className="ops-input w-full px-3 py-2.5 text-sm"
                          >
                            <option value="M">Мужской (M)</option>
                            <option value="F">Женский (F)</option>
                            <option value="X">Не указан (X — проверить)</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                            Источник брони
                          </label>
                          <select
                            value={source}
                            onChange={(e) => setSource(e.target.value as typeof source)}
                            className="ops-input w-full px-3 py-2.5 text-sm"
                          >
                            <option value="Bnovo">Bnovo</option>
                            <option value="Walk-in">С улицы (Walk-in)</option>
                            <option value="QR Direct">QR Прямая бронь</option>
                            <option value="Telegram">Telegram</option>
                          </select>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* STEP 2: Room & Payment */}
                {step === 2 && (
                  <div className="space-y-5">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                          Комната или койка
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
                          className="ops-input w-full px-3 py-2.5 text-sm"
                        >
                          {allRoomOptions.map((opt) => (
                            <option key={opt.key} value={opt.key}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                          Дата заезда → выезд <span className="font-mono tabular-nums">{toDate}</span>
                        </label>
                        <input
                          type="date"
                          value={fromDate}
                          onChange={(e) => setFromDate(e.target.value || getTashkentTodayIso())}
                          className="ops-input w-full px-3 py-2.5 font-mono tabular-nums text-sm"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                          Количество ночей
                        </label>
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
                          className="ops-input w-full px-3 py-2.5 font-mono tabular-nums text-sm"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                          Тариф за ночь (USD)
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
                          className="ops-input w-full px-3 py-2.5 font-mono tabular-nums text-sm"
                        />
                      </div>
                    </div>

                    {/* Female-Only Dorm Guard */}
                    {isFemaleOnlyViolation && (
                      <div
                        className="rounded-2xl border p-4 flex items-start gap-2.5 text-xs"
                        style={{
                          backgroundColor: 'var(--tone-rose-bg)',
                          borderColor: 'var(--tone-rose-border)',
                        }}
                      >
                        <AlertTriangle
                          className="w-4 h-4 shrink-0 mt-0.5"
                          strokeWidth={1.75}
                          style={{ color: 'var(--tone-rose-fg)' }}
                        />
                        <div>
                          <p className="font-semibold" style={{ color: 'var(--tone-rose-fg)' }}>
                            Заселение заблокировано: Fem Dorm — строго женский дорм
                          </p>
                          <p className="mt-1 text-[var(--text-secondary)]">
                            Гость указан как «Мужской (M)». Выберите койку в Mix Dorm, Six Dorm или приватную комнату.
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Overbooking Conflict Guard */}
                    {conflicts.length > 0 && (
                      <div
                        className="rounded-2xl border p-4 space-y-3"
                        style={{
                          backgroundColor: 'var(--tone-rose-bg)',
                          borderColor: 'var(--tone-rose-border)',
                        }}
                      >
                        <div className="flex items-start gap-2.5 text-xs">
                          <AlertTriangle
                            className="w-4 h-4 shrink-0 mt-0.5"
                            strokeWidth={1.75}
                            style={{ color: 'var(--tone-rose-fg)' }}
                          />
                          <div>
                            <p className="font-semibold" style={{ color: 'var(--tone-rose-fg)' }}>
                              Овербукинг заблокирован на даты {fromDate} → {toDate}
                            </p>
                            <p className="mt-1 text-[var(--text-secondary)]">
                              Пересечение с бронью {conflicts[0].bnovoId} ({conflicts[0].guestName}:{' '}
                              <span className="font-mono tabular-nums">
                                {conflicts[0].fromDate} — {conflicts[0].toDate}
                              </span>
                              ).
                            </p>
                          </div>
                        </div>
                        {alternativeRooms.length > 0 && (
                          <div className="space-y-1.5">
                            <p className="text-xs font-medium text-[var(--text-secondary)]">
                              Свободные комнаты на эти даты (выбор в 1 клик):
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
                                    className="px-3 py-1.5 rounded-xl border text-xs font-semibold transition-colors"
                                    style={{
                                      backgroundColor: 'var(--tone-emerald-bg)',
                                      borderColor: 'var(--tone-emerald-border)',
                                      color: 'var(--tone-emerald-fg)',
                                    }}
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

                    {/* Live Tourist Tax (БРВ) Preview */}
                    <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-1.5 font-semibold text-[var(--text-primary)]">
                          <span>
                            Туристический сбор РУз (БРВ{' '}
                            <span className="font-mono tabular-nums">
                              {state.currency.bcvUzs.toLocaleString('ru-RU')}
                            </span>{' '}
                            · {taxRatePct}%)
                          </span>
                          <TooltipHint
                            title="Туристический сбор по БРВ"
                            text="Для объектов до 10 номеров ставка 5% БРВ, свыше 10 номеров — 10% БРВ за иностранного гостя за ночь. Граждане РУз — 0.4% БРВ. Дети до 16 лет освобождены."
                            align="left"
                          />
                        </div>
                        <p className="text-[var(--text-muted)]">
                          {age < 16
                            ? `Ребёнок до 16 лет (${age} лет) — освобождён от турсбора (0 сум)`
                            : !isForeignGuest
                              ? `${Math.max(1, nights)} н. × ${formatUzs(dailyTaxUzs)} / ночь (гражданин РУз · 0.4% БРВ)`
                              : `${Math.max(1, nights)} н. × ${formatUzs(dailyTaxUzs)} / ночь (иностранец ${normalizedCitizenship})`}
                        </p>
                      </div>
                      <span
                        className="font-mono tabular-nums text-sm font-bold"
                        style={{ color: 'var(--tone-emerald-fg)' }}
                      >
                        {formatUzs(previewTouristTaxUzs)}
                      </span>
                    </div>

                    {/* Payment Block */}
                    <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4 space-y-3.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <label className="inline-flex items-center gap-2.5 text-sm font-semibold text-[var(--text-primary)] cursor-pointer">
                          <input
                            type="checkbox"
                            checked={payNow}
                            onChange={(e) => setPayNow(e.target.checked)}
                            className="w-4 h-4 accent-[#059669]"
                          />
                          Принять оплату при заезде
                        </label>
                        <div className="flex items-center gap-1.5 text-xs font-mono tabular-nums text-[var(--text-secondary)]">
                          <span>
                            К оплате:{' '}
                            <strong className="text-[var(--text-primary)]">
                              {formatUsd(totalUsd)}
                            </strong>{' '}
                            · {formatUzs(totalUzs)} (Acc {state.currency.accRate})
                          </span>
                          <TooltipHint
                            title="Курс проживания (Acc) и курс сдачи (Ex)"
                            text={`Проживание в сумах считается по курсу Acc (${state.currency.accRate.toLocaleString('ru-RU')}). Если гость даёт доллары или евро и нужна сдача сумами, сдача считается по курсу обмена Ex (${state.currency.exRate.toLocaleString('ru-RU')}).`}
                            align="right"
                          />
                        </div>
                      </div>

                      {payNow && (
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          <div>
                            <label className="block text-xs text-[var(--text-muted)] mb-1">
                              Карман кассы
                            </label>
                            <select
                              value={payPocket}
                              onChange={(e) => {
                                const p = e.target.value as CashPocketId;
                                setPayPocket(p);
                                if (p === 'cash_usd') setPayCurrency('USD');
                                else if (p === 'cash_eur') setPayCurrency('EUR');
                                else setPayCurrency('UZS');
                              }}
                              className="ops-input w-full px-3 py-2 text-xs"
                            >
                              {paymentPockets.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.name}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs text-[var(--text-muted)] mb-1">
                              Сумма ({payCurrency})
                            </label>
                            <input
                              type="number"
                              min={0}
                              step="any"
                              value={payAmount}
                              onChange={(e) => setPayAmount(parseFloat(e.target.value) || 0)}
                              className="ops-input w-full px-3 py-2 font-mono tabular-nums text-xs"
                            />
                          </div>
                          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 flex flex-col justify-center text-xs">
                            <span className="text-[var(--text-muted)]">
                              {isCashPocket
                                ? payCurrency === 'UZS'
                                  ? 'Сдача (сумы → сумы)'
                                  : `Сдача (курс Ex ${state.currency.exRate})`
                                : 'Безналичная оплата'}
                            </span>
                            <span
                              className="font-mono tabular-nums text-sm font-bold mt-0.5"
                              style={{
                                color:
                                  isCashPocket && changeUzs > 0
                                    ? 'var(--tone-amber-fg)'
                                    : 'var(--text-primary)',
                              }}
                            >
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
                  </div>
                )}

                {/* STEP 3: Mandatory Compliance Protocol */}
                {step === 3 && (
                  <div className="space-y-5">
                    {/* Compact Booking Summary */}
                    <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4 flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-[var(--text-primary)] truncate">
                          {fullName.trim() || 'Гость не указан'}{' '}
                          <span className="font-mono text-xs text-[var(--text-muted)] ml-1">
                            {normalizedCitizenship} · {passportNo.trim() || '—'}
                          </span>
                        </div>
                        <div className="text-xs text-[var(--text-secondary)] mt-0.5 font-mono tabular-nums">
                          {selectedOption?.label ?? 'Комната не выбрана'} · {fromDate} → {toDate} ({nights} н.)
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <StatusPill tone={payNow && payAmount > 0 ? 'emerald' : 'amber'} mono>
                          {payNow && payAmount > 0
                            ? `Оплата: ${formatUsd(Math.min(totalUsd, paidUsdEq))}`
                            : `К оплате: ${formatUsd(totalUsd)}`}
                        </StatusPill>
                        <StatusPill tone={allChecked ? 'emerald' : 'amber'} mono>
                          {checkedCount}/{checklistItems.length}
                        </StatusPill>
                      </div>
                    </div>

                    {/* Individual Checklist (NO Check-All shortcut) */}
                    <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2 text-xs font-semibold text-[var(--text-primary)]">
                          <CheckSquare
                            className="w-4 h-4 shrink-0"
                            strokeWidth={1.75}
                            style={{ color: 'var(--tone-amber-fg)' }}
                          />
                          <span>Обязательный протокол заселения Topchan</span>
                        </div>
                        <span className="text-xs text-[var(--text-muted)]">
                          Отметьте каждый пункт вручную
                        </span>
                      </div>

                      <div className="space-y-2">
                        {checklistItems.map((item) => (
                          <label
                            key={item.id}
                            className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors text-xs ${
                              item.checked
                                ? 'border-[var(--tone-emerald-border)] bg-[var(--tone-emerald-bg)] text-[var(--text-primary)]'
                                : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)]'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={item.checked}
                              onChange={(e) => item.set(e.target.checked)}
                              className="mt-0.5 w-4 h-4 accent-[#059669] shrink-0"
                            />
                            <span className="leading-relaxed font-medium">{item.label}</span>
                          </label>
                        ))}
                      </div>
                    </div>

                    {/* Quick Copy Actions */}
                    <div className="flex flex-wrap items-center gap-2">
                      <CopyButton
                        text={emehmonGuestDataText}
                        label="Данные гостя (E-mehmon)"
                        onCopied={() =>
                          pushToast(
                            'Данные для E-mehmon скопированы',
                            `${fullName || 'Гость'} · ${passportNo || '—'}`,
                            'cobalt'
                          )
                        }
                      />
                      <CopyButton
                        text={guestMemoText}
                        label="Памятка гостю (RU/EN)"
                        onCopied={() =>
                          pushToast(
                            'Памятка гостю скопирована',
                            `Wi-Fi: ${state.integrations.wifiPass} · Дверь: ${state.integrations.doorCode}`,
                            'emerald'
                          )
                        }
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Sticky Bottom Footer */}
              <div className="px-5 py-3.5 border-t border-[var(--border-subtle)] bg-[var(--bg-elevated)] shrink-0 space-y-2.5">
                {blockerReason && step === 3 && (
                  <div
                    className="flex items-center gap-2 text-xs font-medium"
                    style={{ color: 'var(--tone-amber-fg)' }}
                  >
                    <AlertTriangle className="w-4 h-4 shrink-0" strokeWidth={1.75} />
                    <span>{blockerReason}</span>
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="text-xs font-mono tabular-nums text-[var(--text-secondary)]">
                    <span className="font-bold text-[var(--text-primary)]">
                      {formatUsd(totalUsd)}
                    </span>{' '}
                    · {formatUzs(totalUzs)} · Турсбор {formatUzs(previewTouristTaxUzs)}
                  </div>

                  <div className="flex items-center gap-2 ml-auto">
                    {step > 1 && (
                      <button
                        type="button"
                        onClick={() => setStep((s) => (s > 1 ? ((s - 1) as 1 | 2 | 3) : s))}
                        className="px-3.5 py-2.5 rounded-xl border border-[var(--border-strong)] bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] text-xs font-semibold text-[var(--text-primary)] inline-flex items-center gap-1.5 transition-colors"
                      >
                        <ArrowLeft className="w-3.5 h-3.5" strokeWidth={1.75} />
                        Назад
                      </button>
                    )}

                    {step < 3 ? (
                      <button
                        type="button"
                        onClick={() => setStep((s) => (s < 3 ? ((s + 1) as 1 | 2 | 3) : s))}
                        className="px-4 py-2.5 rounded-xl bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors"
                      >
                        Далее
                        <ArrowRight className="w-3.5 h-3.5" strokeWidth={1.75} />
                      </button>
                    ) : (
                      <button
                        type="submit"
                        disabled={!canSubmit}
                        className="px-5 py-2.5 rounded-xl bg-[#2563EB] hover:bg-[#1D4ED8] disabled:bg-[var(--bg-hover)] disabled:text-[var(--text-muted)] text-white text-xs font-semibold transition-colors inline-flex items-center gap-2"
                      >
                        <ShieldCheck className="w-4 h-4" strokeWidth={1.75} />
                        Заселить гостя
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
