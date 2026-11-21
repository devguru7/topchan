export type TabId = 'grid' | 'shift' | 'cash' | 'services' | 'settings';

export type RoomStatus = 'available' | 'occupied' | 'dirty' | 'maintenance';

export type BathroomType = 'shared' | 'private';

export type CashPocketId =
  | 'cash_uzs'
  | 'cash_usd'
  | 'cash_eur'
  | 'terminal'
  | 'transfer'
  | 'safe';

export type CurrencyCode = 'USD' | 'UZS' | 'EUR';

export type GuestTag = 'regular' | 'vip' | 'blacklist';

export type TransferStatus = 'assigned' | 'en_route' | 'picked_up';

export type GuestLang = 'ru' | 'en' | 'uz' | 'zh';

export type AdminRole = 'owner' | 'senior_admin' | 'reception';

export interface RoomCategory {
  id: string;
  propertyId: string;
  name: string;
  shortName: string;
  colorHex: string;
  bathroomType: BathroomType;
  isDorm: boolean;
  maxOccupancy: number;
  pricesUsd: Record<number, number>; // occupancy (1,2,3,4) -> USD per night (or 1 -> per bed for dorm)
  bnovoCategoryId: string;
}

export interface DormBed {
  id: string;
  label: string; // "#1" .. "#6"
  tier: 'Нижняя' | 'Верхняя';
  status: RoomStatus;
}

export interface PhysicalRoom {
  id: string;
  propertyId: string;
  categoryId: string;
  code: string; // e.g. "Small #1", "Yellow #1", "Mix Dorm"
  number: number;
  status: RoomStatus;
  archived?: boolean;
  beds?: DormBed[];
}

export interface StaySegment {
  id: string;
  roomId: string;
  bedId?: string;
  fromDate: string; // YYYY-MM-DD
  toDate: string; // YYYY-MM-DD
  nights: number;
  nightlyRateUsd: number;
}

export interface StayGuest {
  id: string;
  fullName: string;
  citizenship: string; // ISO3 e.g. ITA, KOR, UZB, RUS, FRA, DEU
  age: number;
  passportNo: string;
  dob: string; // YYYY-MM-DD
  sex?: 'M' | 'F';
  isForeigner: boolean;
  mrzRaw?: string;
  emehmonRegistered: boolean;
  emehmonCheckedOut: boolean;
  registrationSlipPrinted: boolean;
  keyIssued: boolean;
  segmentId?: string;
}

export interface LedgerEntry {
  id: string;
  timestamp: string;
  type: 'charge' | 'payment';
  category:
    | 'accommodation'
    | 'late_breakfast'
    | 'laundry_fast'
    | 'laundry_medium'
    | 'early_late'
    | 'penalty'
    | 'transfer'
    | 'payment';
  label: string;
  amountUsd: number; // positive USD equivalent for both charges and payments
  originalCurrency?: CurrencyCode;
  originalAmount?: number;
  pocketId?: CashPocketId;
  actor: string;
}

export interface BookingGroup {
  id: string;
  propertyId: string;
  bnovoId: string;
  status: 'active' | 'checked_out' | 'cancelled';
  checkOutTime: string; // e.g. "12:00"
  checkingOutToday: boolean;
  source: 'Bnovo' | 'Walk-in' | 'QR Direct' | 'Telegram';
  notes?: string;
  segments: StaySegment[];
  guests: StayGuest[];
  ledgerEntries: LedgerEntry[];
  createdAt: string;
}

export interface GuestProfile {
  id: string;
  propertyId: string;
  fullName: string;
  passportNo: string;
  phone?: string;
  citizenship: string;
  visitsCount: number;
  tag: GuestTag;
  notes: string;
  lastVisitDate: string;
}

export interface SafeCurrencyBreakdown {
  UZS: number;
  USD: number;
  EUR: number;
}

export interface CashPocket {
  id: CashPocketId;
  propertyId: string;
  name: string;
  currency: CurrencyCode;
  balance: number;
  safeBalances?: SafeCurrencyBreakdown;
  description: string;
}

export interface CashTransaction {
  id: string;
  propertyId: string;
  timestamp: string;
  pocketId: CashPocketId;
  direction: 'in' | 'out';
  currency: CurrencyCode;
  amount: number;
  label: string;
  bookingId?: string;
  receiptVerified?: boolean;
  actor: string;
}

export interface SafeCollection {
  id: string;
  propertyId: string;
  timestamp: string;
  amountUzs: number;
  amountUsd: number;
  amountEur: number;
  status: 'pending' | 'confirmed';
  createdBy: string;
  confirmedAt?: string;
}

export interface LaundryJob {
  id: string;
  propertyId: string;
  bookingId?: string;
  guestName: string;
  roomLabel: string;
  mode: 'fast' | 'medium'; // 22 min ($2) | 55 min ($3)
  priceUsd: number;
  totalSeconds: number;
  remainingSeconds: number;
  status: 'running' | 'completed';
  startedAt: string;
}

export interface HousekeepingTask {
  id: string;
  propertyId: string;
  roomId: string;
  bedId?: string;
  roomLabel: string;
  status: 'dirty' | 'maid_done' | 'approved';
  createdAt: string;
  maidCompletedAt?: string;
  photoAttached?: boolean;
  notes?: string;
}

export interface LuggageItem {
  id: string;
  propertyId: string;
  tagCode: string; // #B14
  guestName: string;
  bagsCount: number;
  flightTime: string;
  notes: string;
  status: 'stored' | 'released';
  createdAt: string;
}

export interface TransferJob {
  id: string;
  propertyId: string;
  guestName: string;
  roomLabel: string;
  direction: 'to_airport' | 'from_airport';
  pickupTime: string;
  flightNumber: string;
  priceUsd: number;
  driverName: string;
  status: TransferStatus;
}

export interface StockItem {
  id: string;
  propertyId: string;
  name: string;
  unit: string;
  quantity: number;
  minThreshold: number;
}

export interface EmergencyContact {
  id: string;
  category: string;
  name: string;
  role: string;
  phone: string;
  note: string;
}

export interface TelegramAlertAction {
  id: string;
  label: string;
  kind:
    | 'approve_qr_charge'
    | 'open_checkout'
    | 'copy_draft'
    | 'dismiss'
    | 'open_room';
  payload?: Record<string, string | number>;
}

export interface TelegramAlert {
  id: string;
  propertyId: string;
  timestamp: string;
  source: 'Pre-Checkout' | 'Yandex Spam' | 'QR Concierge' | 'Laundry' | 'Review Booster' | 'Bnovo';
  severity: 'info' | 'warning' | 'danger' | 'success';
  title: string;
  body: string;
  draftReply?: string;
  resolved: boolean;
  actions: TelegramAlertAction[];
}

export interface ShiftChecklistItem {
  id: string;
  time: string;
  title: string;
  description: string;
  done: boolean;
  doneAt?: string;
}

export interface AuditLogEntry {
  id: string;
  propertyId: string;
  timestamp: string;
  actor: string;
  action: string;
  diff: string;
  reason: string;
}

export interface CurrencySettings {
  cbuUsd: number;
  cbuEur: number;
  cbuStatus: 'live' | 'cache';
  cbuUpdatedAt: string;
  accRate: number;
  accManualOverride: boolean;
  exRate: number;
  exManualOverride: boolean;
  bcvUzs: number;
}

export interface IntegrationSettings {
  propertyName: string;
  bnovoAccountId: string;
  bnovoApiKey: string;
  bnovoConnected: boolean;
  yandexEmail: string;
  yandexImapStatus: 'connected' | 'paused';
  telegramChatId: string;
  wifiSsid: string;
  wifiPass: string;
  doorCode: string;
}

export interface AppState {
  schemaVersion: number;
  revision?: number;
  propertyId: string;
  adminName: string;
  adminRole?: AdminRole;
  roomCategories: RoomCategory[];
  physicalRooms: PhysicalRoom[];
  bookings: BookingGroup[];
  guestProfiles: GuestProfile[];
  pockets: CashPocket[];
  transactions: CashTransaction[];
  safeCollections: SafeCollection[];
  laundryJobs: LaundryJob[];
  housekeepingTasks: HousekeepingTask[];
  luggageItems: LuggageItem[];
  transfers: TransferJob[];
  stockItems: StockItem[];
  emergencyContacts: EmergencyContact[];
  telegramAlerts: TelegramAlert[];
  shiftChecklist: ShiftChecklistItem[];
  auditLog: AuditLogEntry[];
  currency: CurrencySettings;
  integrations: IntegrationSettings;
}

export interface ParsedCommand {
  raw: string;
  roomId: string | null;
  roomLabel: string;
  bedId?: string;
  guestName: string;
  nights: number;
  nightlyRateUsd: number;
  paidCurrency: CurrencyCode;
  paidAmount: number;
  changeCurrency: 'UZS' | 'USD';
  extras: Array<{
    type: 'laundry_fast' | 'laundry_medium' | 'late_breakfast' | 'early_late';
    label: string;
    priceUsd: number;
  }>;
  totalUsd: number;
  overpaidUsd: number;
  changeUzs: number;
  changeUsd: number;
  debtUsd: number;
  confidenceNote: string;
}

export interface MrzResult {
  valid: boolean;
  error?: string;
  documentType: string;
  issuingState: string;
  surname: string;
  givenName: string;
  fullName: string;
  passportNo: string;
  nationality: string;
  dob: string; // YYYY-MM-DD
  age: number;
  sex: 'M' | 'F';
  expiryDate: string; // YYYY-MM-DD
  isForeigner: boolean;
  raw: string;
}

export interface ToastItem {
  id: string;
  title: string;
  description?: string;
  tone: 'emerald' | 'amber' | 'rose' | 'cobalt';
}
