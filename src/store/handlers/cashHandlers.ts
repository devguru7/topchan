import type { AppState, CashTransaction, SafeCurrencyBreakdown } from '../../types/ops';
import { formatEur, formatUsd, formatUzs, round2 } from '../../utils/math';
import { makeId, type RecordCashCalcPayload } from '../types';
import { isPocketCurrencyMatch } from './bookingHandlers';

function getSafeBreakdown(state: AppState): SafeCurrencyBreakdown {
  const safe = state.pockets.find((p) => p.id === 'safe');
  if (safe?.safeBalances) {
    return { ...safe.safeBalances };
  }
  return { UZS: 0, USD: safe?.balance ?? 0, EUR: 0 };
}

export function validatePettyCash(state: AppState, amountUzs: number): string | null {
  if (!Number.isFinite(amountUzs) || amountUzs <= 0) {
    return 'Сумма хозрасхода должна быть больше нуля.';
  }
  const uzsPocket = state.pockets.find((p) => p.id === 'cash_uzs');
  const available = uzsPocket?.balance ?? 0;
  if (Math.round(amountUzs) > available) {
    return `Недостаточно UZS в ящике ресепшн (доступно ${formatUzs(available)}).`;
  }
  return null;
}

export function handleAddPettyCash(
  state: AppState,
  payload: { category: string; amountUzs: number; note: string },
  nowIso = new Date().toISOString()
): AppState {
  const amount = Math.round(payload.amountUzs);
  if (validatePettyCash(state, amount)) return state;

  return {
    ...state,
    pockets: state.pockets.map((p) =>
      p.id === 'cash_uzs' ? { ...p, balance: Math.round(p.balance - amount) } : p
    ),
    transactions: [
      {
        id: makeId('tx'),
        propertyId: state.propertyId,
        timestamp: nowIso,
        pocketId: 'cash_uzs',
        direction: 'out',
        currency: 'UZS',
        amount,
        label: `Хозрасход: ${payload.category}${payload.note ? ` (${payload.note})` : ''}`,
        actor: state.adminName,
      },
      ...state.transactions,
    ],
    auditLog: [
      {
        id: makeId('aud'),
        propertyId: state.propertyId,
        timestamp: nowIso,
        actor: state.adminName,
        action: 'Хозрасход',
        diff: `-${formatUzs(amount)} (Нал UZS)`,
        reason: `${payload.category}${payload.note ? ` — ${payload.note}` : ''}`,
      },
      ...state.auditLog,
    ],
  };
}

export function validateCashCalc(state: AppState, params: RecordCashCalcPayload): string | null {
  if (!isPocketCurrencyMatch(params.pocketId, params.currency)) {
    return `Карман ${params.pocketId} не поддерживает валюту ${params.currency}.`;
  }
  if (!Number.isFinite(params.receivedAmount) || params.receivedAmount <= 0) {
    return 'Принятая сумма должна быть больше нуля.';
  }
  const changeUzs = Math.max(0, Math.round(params.changeUzs));
  const changeUsd = Math.max(0, round2(params.changeUsd));

  if (changeUzs > 0) {
    const uzsPocket = state.pockets.find((p) => p.id === 'cash_uzs');
    const availableUzs =
      (uzsPocket?.balance ?? 0) + (params.pocketId === 'cash_uzs' ? Math.round(params.receivedAmount) : 0);
    if (changeUzs > availableUzs) {
      return `Недостаточно UZS для сдачи (${formatUzs(changeUzs)} > ${formatUzs(availableUzs)}).`;
    }
  }
  if (changeUsd > 0) {
    const usdPocket = state.pockets.find((p) => p.id === 'cash_usd');
    const availableUsd =
      (usdPocket?.balance ?? 0) + (params.pocketId === 'cash_usd' ? round2(params.receivedAmount) : 0);
    if (changeUsd > availableUsd) {
      return `Недостаточно USD для сдачи (${formatUsd(changeUsd)} > ${formatUsd(availableUsd)}).`;
    }
  }
  return null;
}

export function handleRecordCashCalc(
  state: AppState,
  params: RecordCashCalcPayload,
  nowIso = new Date().toISOString()
): AppState {
  if (validateCashCalc(state, params)) return state;

  const changeUzs = Math.max(0, Math.round(params.changeUzs));
  const changeUsd = Math.max(0, round2(params.changeUsd));

  const nextPockets = state.pockets.map((p) => {
    const added = p.id === params.pocketId ? params.receivedAmount : 0;
    const deductUzs = p.id === 'cash_uzs' ? changeUzs : 0;
    const deductUsd = p.id === 'cash_usd' ? changeUsd : 0;
    if (added === 0 && deductUzs === 0 && deductUsd === 0) return p;
    const bal =
      p.currency === 'UZS'
        ? Math.round(p.balance + added - deductUzs)
        : round2(p.balance + added - deductUsd);
    return { ...p, balance: bal };
  });

  const nextTx: CashTransaction[] = [
    {
      id: makeId('tx'),
      propertyId: state.propertyId,
      timestamp: nowIso,
      pocketId: params.pocketId,
      direction: 'in',
      currency: params.currency,
      amount: params.receivedAmount,
      label: params.label,
      actor: state.adminName,
    },
    ...state.transactions,
  ];

  // Independent checks so combined UZS + USD change records BOTH outgoing transactions
  if (changeUzs > 0) {
    nextTx.unshift({
      id: makeId('tx'),
      propertyId: state.propertyId,
      timestamp: nowIso,
      pocketId: 'cash_uzs',
      direction: 'out',
      currency: 'UZS',
      amount: changeUzs,
      label: `Сдача сумами · ${params.label}`,
      actor: state.adminName,
    });
  }
  if (changeUsd > 0) {
    nextTx.unshift({
      id: makeId('tx'),
      propertyId: state.propertyId,
      timestamp: nowIso,
      pocketId: 'cash_usd',
      direction: 'out',
      currency: 'USD',
      amount: changeUsd,
      label: `Сдача долларами · ${params.label}`,
      actor: state.adminName,
    });
  }

  return {
    ...state,
    pockets: nextPockets,
    transactions: nextTx,
    auditLog: [
      {
        id: makeId('aud'),
        propertyId: state.propertyId,
        timestamp: nowIso,
        actor: state.adminName,
        action: 'Калькулятор кассы',
        diff: `+${params.receivedAmount} ${params.currency}${changeUzs > 0 ? ` / -${formatUzs(changeUzs)}` : ''}${changeUsd > 0 ? ` / -${formatUsd(changeUsd)}` : ''}`,
        reason: params.label,
      },
      ...state.auditLog,
    ],
  };
}

export function validateSafeCollection(
  state: AppState,
  payload: { amountUzs: number; amountUsd: number; amountEur: number }
): string | null {
  const { amountUzs, amountUsd, amountEur } = payload;
  if (
    !Number.isFinite(amountUzs) ||
    !Number.isFinite(amountUsd) ||
    !Number.isFinite(amountEur) ||
    amountUzs < 0 ||
    amountUsd < 0 ||
    amountEur < 0
  ) {
    return 'Суммы инкассации не могут быть отрицательными.';
  }
  if (amountUzs <= 0 && amountUsd <= 0 && amountEur <= 0) {
    return 'Укажите хотя бы одну положительную сумму для передачи в сейф.';
  }

  const uzsBal = state.pockets.find((p) => p.id === 'cash_uzs')?.balance ?? 0;
  const usdBal = state.pockets.find((p) => p.id === 'cash_usd')?.balance ?? 0;
  const eurBal = state.pockets.find((p) => p.id === 'cash_eur')?.balance ?? 0;

  if (amountUzs > uzsBal) {
    return `Недостаточно Нал UZS (в кассе ${formatUzs(uzsBal)}).`;
  }
  if (amountUsd > usdBal) {
    return `Недостаточно Нал USD (в кассе ${formatUsd(usdBal)}).`;
  }
  if (amountEur > eurBal) {
    return `Недостаточно Нал EUR (в кассе ${formatEur(eurBal)}).`;
  }
  return null;
}

export function handleCreateSafeCollection(
  state: AppState,
  payload: { amountUzs: number; amountUsd: number; amountEur: number },
  nowIso = new Date().toISOString()
): AppState {
  const amountUzs = Math.round(payload.amountUzs);
  const amountUsd = round2(payload.amountUsd);
  const amountEur = round2(payload.amountEur);

  if (validateSafeCollection(state, { amountUzs, amountUsd, amountEur })) {
    return state;
  }

  const currentSafe = getSafeBreakdown(state);
  const nextSafe: SafeCurrencyBreakdown = {
    UZS: Math.round(currentSafe.UZS + amountUzs),
    USD: round2(currentSafe.USD + amountUsd),
    EUR: round2(currentSafe.EUR + amountEur),
  };

  const nextPockets = state.pockets.map((p) => {
    if (p.id === 'cash_uzs' && amountUzs > 0) {
      return { ...p, balance: Math.round(p.balance - amountUzs) };
    }
    if (p.id === 'cash_usd' && amountUsd > 0) {
      return { ...p, balance: round2(p.balance - amountUsd) };
    }
    if (p.id === 'cash_eur' && amountEur > 0) {
      return { ...p, balance: round2(p.balance - amountEur) };
    }
    if (p.id === 'safe') {
      return { ...p, balance: nextSafe.USD, safeBalances: nextSafe };
    }
    return p;
  });

  const colId = makeId('col');
  const newTx: CashTransaction[] = [];
  if (amountUzs > 0) {
    newTx.push({
      id: makeId('tx'),
      propertyId: state.propertyId,
      timestamp: nowIso,
      pocketId: 'cash_uzs',
      direction: 'out',
      currency: 'UZS',
      amount: amountUzs,
      label: `В сейф (инкассация ${colId})`,
      actor: state.adminName,
    });
    newTx.push({
      id: makeId('tx'),
      propertyId: state.propertyId,
      timestamp: nowIso,
      pocketId: 'safe',
      direction: 'in',
      currency: 'UZS',
      amount: amountUzs,
      label: `Поступление в сейф UZS (${colId})`,
      actor: state.adminName,
    });
  }
  if (amountUsd > 0) {
    newTx.push({
      id: makeId('tx'),
      propertyId: state.propertyId,
      timestamp: nowIso,
      pocketId: 'cash_usd',
      direction: 'out',
      currency: 'USD',
      amount: amountUsd,
      label: `В сейф (инкассация ${colId})`,
      actor: state.adminName,
    });
    newTx.push({
      id: makeId('tx'),
      propertyId: state.propertyId,
      timestamp: nowIso,
      pocketId: 'safe',
      direction: 'in',
      currency: 'USD',
      amount: amountUsd,
      label: `Поступление в сейф USD (${colId})`,
      actor: state.adminName,
    });
  }
  if (amountEur > 0) {
    newTx.push({
      id: makeId('tx'),
      propertyId: state.propertyId,
      timestamp: nowIso,
      pocketId: 'cash_eur',
      direction: 'out',
      currency: 'EUR',
      amount: amountEur,
      label: `В сейф (инкассация ${colId})`,
      actor: state.adminName,
    });
    newTx.push({
      id: makeId('tx'),
      propertyId: state.propertyId,
      timestamp: nowIso,
      pocketId: 'safe',
      direction: 'in',
      currency: 'EUR',
      amount: amountEur,
      label: `Поступление в сейф EUR (${colId})`,
      actor: state.adminName,
    });
  }

  return {
    ...state,
    pockets: nextPockets,
    transactions: [...newTx, ...state.transactions],
    safeCollections: [
      {
        id: colId,
        propertyId: state.propertyId,
        timestamp: nowIso,
        amountUzs,
        amountUsd,
        amountEur,
        status: 'pending',
        createdBy: state.adminName,
      },
      ...state.safeCollections,
    ],
    auditLog: [
      {
        id: makeId('aud'),
        propertyId: state.propertyId,
        timestamp: nowIso,
        actor: state.adminName,
        action: 'Инкассация владельцу',
        diff: `${formatUzs(amountUzs)} · ${formatUsd(amountUsd)} · ${formatEur(amountEur)}`,
        reason: 'Передано в сейф, ожидает подтверждения владельца',
      },
      ...state.auditLog,
    ],
  };
}

export function handleConfirmSafeCollection(
  state: AppState,
  payload: { id: string },
  nowIso = new Date().toISOString()
): AppState {
  const collection = state.safeCollections.find((c) => c.id === payload.id);
  // Strict guard: collection must exist and still be pending (prevents double-confirm!)
  if (!collection || collection.status !== 'pending') {
    return state;
  }

  const currentSafe = getSafeBreakdown(state);
  const nextSafe: SafeCurrencyBreakdown = {
    UZS: Math.max(0, Math.round(currentSafe.UZS - collection.amountUzs)),
    USD: Math.max(0, round2(currentSafe.USD - collection.amountUsd)),
    EUR: Math.max(0, round2(currentSafe.EUR - collection.amountEur)),
  };

  const nextPockets = state.pockets.map((p) =>
    p.id === 'safe' ? { ...p, balance: nextSafe.USD, safeBalances: nextSafe } : p
  );

  const handoffTx: CashTransaction[] = [];
  if (collection.amountUzs > 0) {
    handoffTx.push({
      id: makeId('tx'),
      propertyId: state.propertyId,
      timestamp: nowIso,
      pocketId: 'safe',
      direction: 'out',
      currency: 'UZS',
      amount: collection.amountUzs,
      label: `Передано владельцу UZS (${collection.id})`,
      actor: 'Владелец хостела',
    });
  }
  if (collection.amountUsd > 0) {
    handoffTx.push({
      id: makeId('tx'),
      propertyId: state.propertyId,
      timestamp: nowIso,
      pocketId: 'safe',
      direction: 'out',
      currency: 'USD',
      amount: collection.amountUsd,
      label: `Передано владельцу USD (${collection.id})`,
      actor: 'Владелец хостела',
    });
  }
  if (collection.amountEur > 0) {
    handoffTx.push({
      id: makeId('tx'),
      propertyId: state.propertyId,
      timestamp: nowIso,
      pocketId: 'safe',
      direction: 'out',
      currency: 'EUR',
      amount: collection.amountEur,
      label: `Передано владельцу EUR (${collection.id})`,
      actor: 'Владелец хостела',
    });
  }

  return {
    ...state,
    pockets: nextPockets,
    transactions: [...handoffTx, ...state.transactions],
    safeCollections: state.safeCollections.map((c) =>
      c.id === payload.id ? { ...c, status: 'confirmed' as const, confirmedAt: nowIso } : c
    ),
    auditLog: [
      {
        id: makeId('aud'),
        propertyId: state.propertyId,
        timestamp: nowIso,
        actor: 'Владелец хостела',
        action: 'Подтверждение инкассации',
        diff: `${collection.id}: ${formatUzs(collection.amountUzs)} · ${formatUsd(collection.amountUsd)} · ${formatEur(collection.amountEur)}`,
        reason: 'Средства получены владельцем и списаны из сейфа ресепшн',
      },
      ...state.auditLog,
    ],
  };
}
