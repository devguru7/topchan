import type { AppState } from '../types/ops';
import type { OpsAction } from './types';
import {
  handleAddLedgerCharge,
  handleAddPayment,
  handleCheckIn,
  handleCheckOut,
  handleCommitParsedCommand,
  handleCompleteNightAudit,
  handleExtendOrMoveStay,
  handleIssueRefund,
  handleMarkEmehmonRegistered,
  handleMoveOrResizeSegment,
  handleRestoreBookingsAndRooms,
  handleSplitStayBooking,
} from './handlers/bookingHandlers';
import {
  handleAddPettyCash,
  handleConfirmSafeCollection,
  handleCreateSafeCollection,
  handleRecordCashCalc,
} from './handlers/cashHandlers';
import {
  handleAddLostFound,
  handleAddLuggage,
  handleAddMailInquiry,
  handleAddTransfer,
  handleAdjustStock,
  handleAdminApproveHousekeeping,
  handleCompleteLaundryJob,
  handleCycleTransferStatus,
  handleDismissMailInquiry,
  handleFinishHousekeepingTask,
  handleMaidMarkCleaned,
  handleReleaseLuggage,
  handleResolveLostFound,
  handleResolveTelegramAlert,
  handleSetRoomHousekeepingStatus,
  handleSpeedUpLaundry,
  handleStartHousekeepingTask,
  handleStartLaundry,
  handleSubmitGuestQrRequest,
  handleToggleChecklist,
  handleUpdateTelegramAlertDraft,
  handleUpsertGuestProfile,
} from './handlers/serviceHandlers';
import {
  handleAddPhysicalRoom,
  handleApplyLiveCbuRates,
  handleArchivePhysicalRoom,
  handleHydrateState,
  handleResetDemoData,
  handleUpdateCategoryPrice,
  handleUpdateCurrencySettings,
  handleUpdateIntegrationSettings,
} from './handlers/settingsHandlers';

function applyAction(state: AppState, action: OpsAction): AppState {
  switch (action.type) {
    case 'CHECK_IN':
      return handleCheckIn(state, action.payload, action.nowIso, action.todayIso);
    case 'CHECK_OUT':
      return handleCheckOut(state, action.payload, action.nowIso, action.timeHm);
    case 'ADD_LEDGER_CHARGE':
      return handleAddLedgerCharge(state, action.payload, action.nowIso);
    case 'ADD_PAYMENT':
      return handleAddPayment(state, action.payload, action.nowIso);
    case 'ISSUE_REFUND':
      return handleIssueRefund(state, action.payload, action.nowIso);
    case 'EXTEND_OR_MOVE_STAY':
      return handleExtendOrMoveStay(state, action.payload, action.nowIso, action.todayIso);
    case 'MOVE_OR_RESIZE_SEGMENT':
      return handleMoveOrResizeSegment(state, action.payload, action.nowIso, action.todayIso);
    case 'RESTORE_BOOKINGS_AND_ROOMS':
      return handleRestoreBookingsAndRooms(state, action.payload, action.nowIso);
    case 'SPLIT_STAY_BOOKING':
      return handleSplitStayBooking(state, action.payload, action.nowIso, action.todayIso);
    case 'COMPLETE_NIGHT_AUDIT':
      return handleCompleteNightAudit(state, action.payload, action.nowIso, action.todayIso);
    case 'COMMIT_PARSED_COMMAND':
      return handleCommitParsedCommand(state, action.payload, action.nowIso, action.todayIso);
    case 'MARK_EMEHMON_REGISTERED':
      return handleMarkEmehmonRegistered(state, action.payload);

    case 'ADD_PETTY_CASH':
      return handleAddPettyCash(state, action.payload, action.nowIso);
    case 'RECORD_CASH_CALC':
      return handleRecordCashCalc(state, action.payload, action.nowIso);
    case 'CREATE_SAFE_COLLECTION':
      return handleCreateSafeCollection(state, action.payload, action.nowIso);
    case 'CONFIRM_SAFE_COLLECTION':
      return handleConfirmSafeCollection(state, action.payload, action.nowIso);

    case 'TOGGLE_CHECKLIST':
      return handleToggleChecklist(state, action.payload, action.timeHm);
    case 'START_LAUNDRY':
      return handleStartLaundry(state, action.payload, action.nowIso);
    case 'COMPLETE_LAUNDRY_JOB':
      return handleCompleteLaundryJob(state, action.payload, action.timeHm);
    case 'SPEED_UP_LAUNDRY':
      return handleSpeedUpLaundry(state, action.payload, action.timeHm);
    case 'START_HOUSEKEEPING_TASK':
      return handleStartHousekeepingTask(state, action.payload, action.nowIso);
    case 'FINISH_HOUSEKEEPING_TASK':
      return handleFinishHousekeepingTask(state, action.payload, action.nowIso);
    case 'MAID_MARK_CLEANED':
      return handleMaidMarkCleaned(state, action.payload, action.timeHm);
    case 'ADMIN_APPROVE_HOUSEKEEPING':
      return handleAdminApproveHousekeeping(state, action.payload);
    case 'SET_ROOM_HOUSEKEEPING_STATUS':
      return handleSetRoomHousekeepingStatus(state, action.payload, action.nowIso);
    case 'ADD_LUGGAGE':
      return handleAddLuggage(state, action.payload, action.nowIso);
    case 'RELEASE_LUGGAGE':
      return handleReleaseLuggage(state, action.payload);
    case 'ADD_LOST_FOUND':
      return handleAddLostFound(state, action.payload, action.todayIso);
    case 'RESOLVE_LOST_FOUND':
      return handleResolveLostFound(state, action.payload);
    case 'UPSERT_GUEST_PROFILE':
      return handleUpsertGuestProfile(state, action.payload, action.todayIso);
    case 'ADD_MAIL_INQUIRY':
      return handleAddMailInquiry(state, action.payload);
    case 'DISMISS_MAIL_INQUIRY':
      return handleDismissMailInquiry(state, action.payload);
    case 'ADD_TRANSFER':
      return handleAddTransfer(state, action.payload);
    case 'CYCLE_TRANSFER_STATUS':
      return handleCycleTransferStatus(state, action.payload);
    case 'ADJUST_STOCK':
      return handleAdjustStock(state, action.payload);
    case 'SUBMIT_GUEST_QR_REQUEST':
      return handleSubmitGuestQrRequest(state, action.payload, action.timeHm);
    case 'UPDATE_TELEGRAM_ALERT_DRAFT':
      return handleUpdateTelegramAlertDraft(state, action.payload);
    case 'RESOLVE_TELEGRAM_ALERT':
      return handleResolveTelegramAlert(state, action.payload);

    case 'ADD_PHYSICAL_ROOM':
      return handleAddPhysicalRoom(state, action.payload, action.nowIso);
    case 'ARCHIVE_PHYSICAL_ROOM':
      return handleArchivePhysicalRoom(state, action.payload);
    case 'UPDATE_CATEGORY_PRICE':
      return handleUpdateCategoryPrice(state, action.payload, action.nowIso);
    case 'UPDATE_CURRENCY':
      return handleUpdateCurrencySettings(state, action.payload);
    case 'APPLY_LIVE_CBU_RATES':
      return handleApplyLiveCbuRates(state, action.payload);
    case 'UPDATE_INTEGRATIONS':
      return handleUpdateIntegrationSettings(state, action.payload);
    case 'HYDRATE_STATE':
      return handleHydrateState(state, action.payload);
    case 'RESET_DEMO_DATA':
      return handleResetDemoData(action.payload?.baseDateIso);

    default:
      return state;
  }
}

export function opsReducer(state: AppState, action: OpsAction): AppState {
  const next = applyAction(state, action);
  if (next === state) return state;
  if (action.type === 'HYDRATE_STATE' || action.type === 'RESET_DEMO_DATA') {
    return next;
  }
  const baseRevision =
    typeof state.revision === 'number' && Number.isFinite(state.revision) ? state.revision : 1;
  return {
    ...next,
    revision: baseRevision + 1,
  };
}

