import type { AppState } from '../../types/ops';
import { formatUsd, formatUzs, round2 } from '../../utils/math';
import { makeId, type RecordCashCalcPayload } from '../types';

export function handleAddPettyCash(
  state: AppState,
  payload: { category: string; amountUzs: number; note: string },
  nowIso = new Date().toISOString()
): AppState {
  if (payload.amountUzs <= 0) return state;

  return {
    ...state,
    pockets: state.pockets.map((p) =>
      p.id === 'cash_uzs' ? { ...p, balance: Math.round(p.balance - payload.amountUzs) } : p
    ),
    transactions: [
      {
        id: makeId('tx'),
        propertyId: state.propertyId,
        timestamp: nowIso,
        pocketId: 'cash_uzs',
        direction: 'out',
        currency: 'UZS',
        amount: payload.amountUzs,
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
        diff: `-${formatUzs(payload.amountUzs)} (Нал UZS)`,
        reason: `${payload.category}${payload.note ? ` — ${payload.note}` : ''}`,
      },
      ...state.auditLog,
    ],
  };
}

export function handleRecordCashCalc(
  state: AppState,
  params: RecordCashCalcPayload,
  nowIso = new Date().toISOString()
): AppState {
  const nextPockets = state.pockets.map((p) => {
    let bal = p.balance;
    if (p.id === params.pocketId) {
      bal = round2(bal + params.receivedAmount);
    }
    if (params.changeUzs > 0 && p.id === 'cash_uzs') {
      bal = Math.round(bal - params.changeUzs);
    }
    if (params.changeUsd > 0 && p.id === 'cash_usd') {
      bal = round2(bal - params.changeUsd);
    }
    return { ...p, balance: bal };
  });

  const nextTx = [
    {
      id: makeId('tx'),
      propertyId: state.propertyId,
      timestamp: nowIso,
      pocketId: params.pocketId,
      direction: 'in' as const,
      currency: params.currency,
      amount: params.receivedAmount,
      label: params.label,
      actor: state.adminName,
    },
    ...state.transactions,
  ];

  if (params.changeUzs > 0) {
    nextTx.unshift({
      id: makeId('tx'),
      propertyId: state.propertyId,
      timestamp: nowIso,
      pocketId: 'cash_uzs',
      direction: 'out',
      currency: 'UZS',
      amount: params.changeUzs,
      label: `Сдача сумами · ${params.label}`,
      actor: state.adminName,
    });
  } else if (params.changeUsd > 0) {
    nextTx.unshift({
      id: makeId('tx'),
      propertyId: state.propertyId,
      timestamp: nowIso,
      pocketId: 'cash_usd',
      direction: 'out',
      currency: 'USD',
      amount: params.changeUsd,
      label: `Сдача долларами · ${params.label}`,
      actor: state.adminName,
    });
  }

  return {
    ...state,
    pockets: nextPockets,
    transactions: nextTx,
  };
}

export function handleCreateSafeCollection(
  state: AppState,
  payload: { amountUzs: number; amountUsd: number; amountEur: number },
  nowIso = new Date().toISOString()
): AppState {
  const { amountUzs, amountUsd, amountEur } = payload;
  if (amountUzs <= 0 && amountUsd <= 0 && amountEur <= 0) return state;

  return {
    ...state,
    pockets: state.pockets.map((p) => {
      if (p.id === 'cash_uzs' && amountUzs > 0) {
        return { ...p, balance: Math.max(0, Math.round(p.balance - amountUzs)) };
      }
      if (p.id === 'cash_usd' && amountUsd > 0) {
        return { ...p, balance: Math.max(0, round2(p.balance - amountUsd)) };
      }
      if (p.id === 'cash_eur' && amountEur > 0) {
        return { ...p, balance: Math.max(0, round2(p.balance - amountEur)) };
      }
      if (p.id === 'safe' && amountUsd > 0) {
        return { ...p, balance: round2(p.balance + amountUsd) };
      }
      return p;
    }),
    safeCollections: [
      {
        id: makeId('col'),
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
        diff: `${formatUzs(amountUzs)} · ${formatUsd(amountUsd)} · €${amountEur}`,
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
  return {
    ...state,
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
        diff: `Инкассация ${payload.id} подтверждена`,
        reason: 'Средства получены',
      },
      ...state.auditLog,
    ],
  };
}
