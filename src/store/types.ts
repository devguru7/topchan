import type {
  AdminRole,
  AppState,
  BookingGroup,
  CashPocketId,
  CurrencyCode,
  CurrencySettings,
  IntegrationSettings,
  LedgerEntry,
  ParsedCommand,
  StayGuest,
} from '../types/ops';

export interface CheckInPreselect {
  roomId?: string;
  bedId?: string;
  fromDate?: string;
}

export interface CheckInPayload {
  roomId: string;
  bedId?: string;
  fromDate?: string; // YYYY-MM-DD (defaults to Tashkent today)
  nights: number;
  nightlyRateUsd: number;
  guests: Array<Omit<StayGuest, 'id'>>;
  source: BookingGroup['source'];
  notes?: string;
  initialPayment?: {
    amountUsdEquivalent: number;
    originalCurrency: CurrencyCode;
    originalAmount: number;
    pocketId: CashPocketId;
  };
  changeUzsOut?: number;
}

export interface CheckOutPayload {
  bookingId: string;
  debtOverrideReason?: string;
  emehmonOverrideReason?: string;
  slipPrintedConfirmed?: boolean;
  emehmonClosedConfirmed?: boolean;
  actorRole?: AdminRole;
  createLuggage?: {
    bagsCount: number;
    flightTime: string;
    notes: string;
  };
}

export interface AddPaymentPayload {
  bookingId: string;
  pocketId: CashPocketId;
  currency: CurrencyCode;
  originalAmount: number;
  usdEquivalent: number;
  changeUzsOut?: number;
  receiptVerified?: boolean;
}

export interface IssueRefundPayload {
  bookingId: string;
  pocketId: 'cash_usd' | 'cash_uzs';
  currency: 'USD' | 'UZS';
  amountOriginal: number;
  amountUsd: number;
  reason?: string;
}

export interface ExtendOrMovePayload {
  bookingId: string;
  mode: 'extend' | 'move';
  extraNights: number;
  newRoomId?: string;
  newBedId?: string;
  nightlyRateUsd: number;
}

export interface StartLaundryPayload {
  bookingId?: string;
  guestName: string;
  roomLabel: string;
  mode: 'fast' | 'medium';
  chargeToFolio: boolean;
}

export interface AddLuggagePayload {
  guestName: string;
  bagsCount: number;
  flightTime: string;
  notes: string;
}

export interface AddTransferPayload {
  guestName: string;
  roomLabel: string;
  direction: 'to_airport' | 'from_airport';
  pickupTime: string;
  flightNumber: string;
  priceUsd: number;
  driverName: string;
}

export interface RecordCashCalcPayload {
  pocketId: CashPocketId;
  currency: CurrencyCode;
  receivedAmount: number;
  changeUzs: number;
  changeUsd: number;
  label: string;
}

export interface SubmitGuestQrPayload {
  bookingId: string;
  serviceType: 'extend' | 'laundry_fast' | 'laundry_medium' | 'transfer' | 'late_breakfast';
  lang: string;
}

export type OpsAction =
  | { type: 'CHECK_IN'; payload: CheckInPayload; nowIso?: string; todayIso?: string }
  | { type: 'CHECK_OUT'; payload: CheckOutPayload; nowIso?: string; timeHm?: string }
  | {
      type: 'ADD_LEDGER_CHARGE';
      payload: {
        bookingId: string;
        category: LedgerEntry['category'];
        label: string;
        amountUsd: number;
        options?: { startLaundryMode?: 'fast' | 'medium' };
      };
      nowIso?: string;
    }
  | { type: 'ADD_PAYMENT'; payload: AddPaymentPayload; nowIso?: string }
  | { type: 'ISSUE_REFUND'; payload: IssueRefundPayload; nowIso?: string }
  | { type: 'EXTEND_OR_MOVE_STAY'; payload: ExtendOrMovePayload; nowIso?: string; todayIso?: string }
  | { type: 'COMMIT_PARSED_COMMAND'; payload: ParsedCommand; nowIso?: string; todayIso?: string }
  | { type: 'MARK_EMEHMON_REGISTERED'; payload: { bookingId: string; guestId: string } }
  | { type: 'ADD_PETTY_CASH'; payload: { category: string; amountUzs: number; note: string }; nowIso?: string }
  | { type: 'RECORD_CASH_CALC'; payload: RecordCashCalcPayload; nowIso?: string }
  | {
      type: 'CREATE_SAFE_COLLECTION';
      payload: { amountUzs: number; amountUsd: number; amountEur: number };
      nowIso?: string;
    }
  | { type: 'CONFIRM_SAFE_COLLECTION'; payload: { id: string }; nowIso?: string }
  | { type: 'TOGGLE_CHECKLIST'; payload: { id: string }; timeHm?: string }
  | { type: 'START_LAUNDRY'; payload: StartLaundryPayload; nowIso?: string }
  | { type: 'COMPLETE_LAUNDRY_JOB'; payload: { jobId: string }; timeHm?: string }
  | { type: 'SPEED_UP_LAUNDRY'; payload: { jobId: string; minusMinutes?: number }; timeHm?: string }
  | { type: 'MAID_MARK_CLEANED'; payload: { taskId: string }; timeHm?: string }
  | { type: 'ADMIN_APPROVE_HOUSEKEEPING'; payload: { taskId: string } }
  | { type: 'ADD_LUGGAGE'; payload: AddLuggagePayload; nowIso?: string }
  | { type: 'RELEASE_LUGGAGE'; payload: { id: string } }
  | { type: 'ADD_TRANSFER'; payload: AddTransferPayload }
  | { type: 'CYCLE_TRANSFER_STATUS'; payload: { id: string } }
  | { type: 'ADJUST_STOCK'; payload: { id: string; delta: number } }
  | { type: 'SUBMIT_GUEST_QR_REQUEST'; payload: SubmitGuestQrPayload; timeHm?: string }
  | { type: 'UPDATE_TELEGRAM_ALERT_DRAFT'; payload: { alertId: string; draftReply: string } }
  | { type: 'RESOLVE_TELEGRAM_ALERT'; payload: { alertId: string } }
  | { type: 'ADD_PHYSICAL_ROOM'; payload: { categoryId: string; customCode?: string }; nowIso?: string }
  | { type: 'ARCHIVE_PHYSICAL_ROOM'; payload: { roomId: string } }
  | {
      type: 'UPDATE_CATEGORY_PRICE';
      payload: { categoryId: string; occupancy: number; priceUsd: number };
      nowIso?: string;
    }
  | { type: 'UPDATE_CURRENCY'; payload: Partial<CurrencySettings> }
  | {
      type: 'APPLY_LIVE_CBU_RATES';
      payload: { cbuUsd: number; cbuEur: number; updatedAt?: string };
    }
  | { type: 'UPDATE_INTEGRATIONS'; payload: Partial<IntegrationSettings> }
  | { type: 'HYDRATE_STATE'; payload: AppState }
  | { type: 'RESET_DEMO_DATA'; payload?: { baseDateIso?: string } };

export function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}
