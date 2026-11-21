import type {
  AppState,
  CurrencySettings,
  IntegrationSettings,
  PhysicalRoom,
} from '../../types/ops';
import { createSeedState } from '../../data/seed';
import { calcDefaultAccRate, calcDefaultExRate, round2 } from '../../utils/math';
import { makeId } from '../types';

export function handleAddPhysicalRoom(
  state: AppState,
  payload: { categoryId: string; customCode?: string },
  nowIso = new Date().toISOString()
): AppState {
  const cat = state.roomCategories.find((c) => c.id === payload.categoryId);
  if (!cat) return state;

  const existingInCat = state.physicalRooms.filter((r) => r.categoryId === payload.categoryId);
  const nextNumber = existingInCat.reduce((max, r) => Math.max(max, r.number), 0) + 1;
  const createdCode = payload.customCode?.trim() || `${cat.name} #${nextNumber}`;

  const newRoom: PhysicalRoom = {
    id: makeId('room'),
    propertyId: state.propertyId,
    categoryId: payload.categoryId,
    code: createdCode,
    number: nextNumber,
    status: 'available',
    beds: cat.isDorm
      ? [1, 2, 3, 4, 5, 6].map((n) => ({
          id: makeId(`bed-${n}`),
          label: `#${n}`,
          tier: n % 2 === 1 ? 'Нижняя' : 'Верхняя',
          status: 'available',
        }))
      : undefined,
  };

  return {
    ...state,
    physicalRooms: [...state.physicalRooms, newRoom],
    auditLog: [
      {
        id: makeId('aud'),
        propertyId: state.propertyId,
        timestamp: nowIso,
        actor: state.adminName,
        action: 'Инвентарь комнат',
        diff: `Добавлена комната ${createdCode}`,
        reason: 'Динамическое расширение номерного фонда',
      },
      ...state.auditLog,
    ],
  };
}

export function handleArchivePhysicalRoom(
  state: AppState,
  payload: { roomId: string }
): AppState {
  return {
    ...state,
    physicalRooms: state.physicalRooms.map((r) =>
      r.id === payload.roomId ? { ...r, archived: !r.archived } : r
    ),
  };
}

export function handleUpdateCategoryPrice(
  state: AppState,
  payload: { categoryId: string; occupancy: number; priceUsd: number },
  nowIso = new Date().toISOString()
): AppState {
  if (!Number.isFinite(payload.priceUsd) || payload.priceUsd <= 0) return state;
  const cat = state.roomCategories.find((c) => c.id === payload.categoryId);
  if (!cat) return state;
  const oldVal = cat.pricesUsd[payload.occupancy];

  return {
    ...state,
    roomCategories: state.roomCategories.map((c) =>
      c.id === payload.categoryId
        ? { ...c, pricesUsd: { ...c.pricesUsd, [payload.occupancy]: round2(payload.priceUsd) } }
        : c
    ),
    auditLog: [
      {
        id: makeId('aud'),
        propertyId: state.propertyId,
        timestamp: nowIso,
        actor: state.adminName,
        action: 'Редактор тарифов',
        diff: `${cat.name} (${payload.occupancy} чел.): $${oldVal ?? '-'} → $${payload.priceUsd}`,
        reason: 'Обновление прайса в настройках',
      },
      ...state.auditLog,
    ],
  };
}

export function handleUpdateCurrencySettings(
  state: AppState,
  patch: Partial<CurrencySettings>
): AppState {
  return {
    ...state,
    currency: { ...state.currency, ...patch },
  };
}

export function handleApplyLiveCbuRates(
  state: AppState,
  payload: { cbuUsd: number; cbuEur: number; updatedAt?: string }
): AppState {
  if (!Number.isFinite(payload.cbuUsd) || payload.cbuUsd <= 5000) return state;

  return {
    ...state,
    currency: {
      ...state.currency,
      cbuUsd: payload.cbuUsd,
      cbuEur: Number.isFinite(payload.cbuEur) ? payload.cbuEur : state.currency.cbuEur,
      cbuStatus: 'live',
      cbuUpdatedAt: payload.updatedAt || state.currency.cbuUpdatedAt,
      accRate: state.currency.accManualOverride
        ? state.currency.accRate
        : calcDefaultAccRate(payload.cbuUsd),
      exRate: state.currency.exManualOverride
        ? state.currency.exRate
        : calcDefaultExRate(payload.cbuUsd),
    },
  };
}

export function handleUpdateIntegrationSettings(
  state: AppState,
  patch: Partial<IntegrationSettings>
): AppState {
  return {
    ...state,
    integrations: { ...state.integrations, ...patch },
  };
}

export function handleHydrateState(_state: AppState, nextState: AppState): AppState {
  return nextState;
}

export function handleResetDemoData(baseDateIso?: string): AppState {
  return createSeedState(baseDateIso);
}
