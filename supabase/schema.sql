-- ============================================================================
-- Topchan Ops — Production Multi-Tenant PostgreSQL / Supabase Schema
-- 18 normalized operational tables + property_snapshots sync table + RLS
-- ============================================================================

create extension if not exists "pgcrypto";

-- Helper: extract property_id from JWT claims (or fallback to current_setting)
create or replace function public.current_property_id()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'property_id', ''),
    nullif(current_setting('app.property_id', true), ''),
    'topchan-tashkent-01'
  );
$$;

-- 1. Properties (Multi-tenant root)
create table if not exists public.properties (
  id text primary key,
  name text not null,
  timezone text not null default 'Asia/Tashkent',
  bnovo_account_id text,
  yandex_email text,
  telegram_chat_id text,
  wifi_pass text not null default '',
  door_code text not null default '',
  cbu_usd numeric(12, 2) not null default 12004.48,
  acc_rate integer not null default 12200,
  ex_rate integer not null default 11800,
  bcv_uzs integer not null default 440000,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Snapshot sync table used by SupabaseStorageAdapter for offline-first full state sync
create table if not exists public.property_snapshots (
  property_id text primary key references public.properties(id) on delete cascade,
  schema_version integer not null default 3,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

-- 2. Room Categories
create table if not exists public.room_categories (
  id text primary key,
  property_id text not null references public.properties(id) on delete cascade,
  code text not null,
  name text not null,
  bnovo_category_id text not null default '',
  is_dorm boolean not null default false,
  max_guests integer not null default 2,
  prices_usd jsonb not null default '{}'::jsonb,
  color_hex text not null default '#3B82F6',
  created_at timestamptz not null default now()
);

-- 3. Physical Rooms
create table if not exists public.physical_rooms (
  id text primary key,
  property_id text not null references public.properties(id) on delete cascade,
  category_id text not null references public.room_categories(id) on delete restrict,
  code text not null,
  floor integer not null default 1,
  status text not null check (status in ('free', 'occupied', 'checkout_today', 'dirty', 'maintenance')),
  archived boolean not null default false,
  created_at timestamptz not null default now()
);

-- 4. Dorm Beds
create table if not exists public.dorm_beds (
  id text primary key,
  property_id text not null references public.properties(id) on delete cascade,
  room_id text not null references public.physical_rooms(id) on delete cascade,
  label text not null,
  tier text not null check (tier in ('lower', 'upper')),
  status text not null check (status in ('free', 'occupied', 'checkout_today', 'dirty', 'maintenance'))
);

-- 5. Guest Profiles (MRZ / E-mehmon compliant; passport photos NEVER stored)
create table if not exists public.guest_profiles (
  id text primary key,
  property_id text not null references public.properties(id) on delete cascade,
  full_name text not null,
  surname text not null,
  given_name text not null,
  passport_no text not null default '',
  nationality text not null default 'UZB',
  dob date,
  age integer not null default 30,
  sex text not null default 'M' check (sex in ('M', 'F')),
  is_foreigner boolean not null default false,
  phone text not null default '',
  created_at timestamptz not null default now()
);

-- 6. Booking Groups
create table if not exists public.booking_groups (
  id text primary key,
  property_id text not null references public.properties(id) on delete cascade,
  bnovo_id text,
  source text not null check (source in ('Booking.com', 'Bnovo', 'Direct', 'Walk-in', 'Airbnb')),
  status text not null check (status in ('active', 'checked_out', 'cancelled')),
  emehmon_status text not null default 'pending' check (emehmon_status in ('pending', 'registered', 'kvitok_issued')),
  kvitok_number text,
  check_in_date date not null,
  check_out_date date not null,
  notes text not null default '',
  created_at timestamptz not null default now()
);

-- 7. Stay Segments (supports mid-stay room moves & extensions)
create table if not exists public.stay_segments (
  id text primary key,
  property_id text not null references public.properties(id) on delete cascade,
  booking_id text not null references public.booking_groups(id) on delete cascade,
  room_id text not null references public.physical_rooms(id) on delete restrict,
  bed_id text references public.dorm_beds(id) on delete restrict,
  from_date date not null,
  to_date date not null,
  nightly_rate_usd numeric(10, 2) not null
);

-- 8. Stay Guests (Many-to-Many link between bookings & guest profiles)
create table if not exists public.stay_guests (
  booking_id text not null references public.booking_groups(id) on delete cascade,
  guest_id text not null references public.guest_profiles(id) on delete cascade,
  property_id text not null references public.properties(id) on delete cascade,
  is_primary boolean not null default false,
  primary key (booking_id, guest_id)
);

-- 9. Ledger Entries (Immutable charges & payments — debt is ALWAYS SUM(charges) - SUM(payments))
create table if not exists public.ledger_entries (
  id text primary key,
  property_id text not null references public.properties(id) on delete cascade,
  booking_id text not null references public.booking_groups(id) on delete cascade,
  kind text not null check (kind in ('charge', 'payment', 'refund')),
  category text not null,
  description text not null,
  amount_usd numeric(12, 2) not null,
  original_amount numeric(14, 2),
  original_currency text check (original_currency in ('UZS', 'USD', 'EUR')),
  pocket_id text,
  actor text not null,
  created_at timestamptz not null default now()
);

-- 10. Cash Pockets (6-Pocket Cash Desk)
create table if not exists public.cash_pockets (
  id text primary key,
  property_id text not null references public.properties(id) on delete cascade,
  name text not null,
  currency text not null check (currency in ('UZS', 'USD', 'EUR')),
  kind text not null check (kind in ('cash', 'card', 'bank')),
  balance numeric(14, 2) not null default 0,
  updated_at timestamptz not null default now()
);

-- 11. Cash Transactions
create table if not exists public.cash_transactions (
  id text primary key,
  property_id text not null references public.properties(id) on delete cascade,
  pocket_id text not null references public.cash_pockets(id) on delete restrict,
  direction text not null check (direction in ('in', 'out')),
  amount numeric(14, 2) not null,
  currency text not null check (currency in ('UZS', 'USD', 'EUR')),
  label text not null,
  booking_id text references public.booking_groups(id) on delete set null,
  actor text not null,
  created_at timestamptz not null default now()
);

-- 12. Petty Cash Expenses
create table if not exists public.petty_cash_expenses (
  id text primary key,
  property_id text not null references public.properties(id) on delete cascade,
  category text not null,
  pocket_id text not null references public.cash_pockets(id) on delete restrict,
  amount numeric(14, 2) not null,
  currency text not null check (currency in ('UZS', 'USD', 'EUR')),
  note text not null default '',
  receipt_url text,
  actor text not null,
  created_at timestamptz not null default now()
);

-- 13. Cash Collections (Safe / Owner Handover)
create table if not exists public.cash_collections (
  id text primary key,
  property_id text not null references public.properties(id) on delete cascade,
  pocket_id text not null references public.cash_pockets(id) on delete restrict,
  amount numeric(14, 2) not null,
  currency text not null check (currency in ('UZS', 'USD', 'EUR')),
  status text not null default 'pending_owner' check (status in ('pending_owner', 'confirmed')),
  note text not null default '',
  created_by text not null,
  confirmed_by text,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz
);

-- 14. Shift Reconciliations (Z-Reports)
create table if not exists public.shift_reconciliations (
  id text primary key,
  property_id text not null references public.properties(id) on delete cascade,
  business_date date not null,
  expected_uzs bigint not null,
  actual_uzs bigint not null,
  diff_uzs bigint not null,
  expected_usd numeric(12, 2) not null,
  actual_usd numeric(12, 2) not null,
  diff_usd numeric(12, 2) not null,
  denomination_counts jsonb not null default '{}'::jsonb,
  note text not null default '',
  actor text not null,
  created_at timestamptz not null default now()
);

-- 15. Housekeeping Tasks (2-step Maid -> Admin sign-off)
create table if not exists public.housekeeping_tasks (
  id text primary key,
  property_id text not null references public.properties(id) on delete cascade,
  room_id text not null references public.physical_rooms(id) on delete cascade,
  bed_id text references public.dorm_beds(id) on delete cascade,
  room_label text not null,
  status text not null check (status in ('dirty', 'maid_done', 'approved')),
  maid_name text,
  photo_attached boolean not null default false,
  notes text not null default '',
  updated_at timestamptz not null default now()
);

-- 16. Laundry Jobs
create table if not exists public.laundry_jobs (
  id text primary key,
  property_id text not null references public.properties(id) on delete cascade,
  booking_id text references public.booking_groups(id) on delete set null,
  guest_name text not null,
  room_label text not null,
  mode text not null check (mode in ('fast', 'medium')),
  price_usd numeric(8, 2) not null,
  total_seconds integer not null,
  started_at timestamptz not null default now(),
  ends_at timestamptz not null,
  status text not null check (status in ('running', 'completed'))
);

-- 17. Luggage & Airport Transfers
create table if not exists public.luggage_transfers (
  id text primary key,
  property_id text not null references public.properties(id) on delete cascade,
  record_type text not null check (record_type in ('luggage', 'transfer')),
  tag_code text,
  guest_name text not null,
  room_label text not null default '',
  direction text check (direction in ('to_airport', 'from_airport')),
  flight_number text,
  scheduled_time text,
  bags_count integer,
  price_usd numeric(8, 2) default 0,
  driver_name text,
  status text not null,
  notes text not null default '',
  created_at timestamptz not null default now()
);

-- 18. Immutable Audit Log
create table if not exists public.audit_log (
  id text primary key,
  property_id text not null references public.properties(id) on delete cascade,
  actor text not null,
  action text not null,
  diff text not null,
  reason text not null default '',
  created_at timestamptz not null default now()
);

-- ============================================================================
-- B-Tree Indexes on property_id + hot lookup keys
-- ============================================================================
create index if not exists idx_room_categories_prop on public.room_categories (property_id);
create index if not exists idx_physical_rooms_prop on public.physical_rooms (property_id, status);
create index if not exists idx_dorm_beds_prop on public.dorm_beds (property_id, room_id);
create index if not exists idx_guest_profiles_prop on public.guest_profiles (property_id, passport_no);
create index if not exists idx_booking_groups_prop on public.booking_groups (property_id, status, check_in_date, check_out_date);
create index if not exists idx_stay_segments_prop on public.stay_segments (property_id, room_id, from_date, to_date);
create index if not exists idx_stay_guests_prop on public.stay_guests (property_id);
create index if not exists idx_ledger_entries_prop on public.ledger_entries (property_id, booking_id, created_at desc);
create index if not exists idx_cash_pockets_prop on public.cash_pockets (property_id);
create index if not exists idx_cash_transactions_prop on public.cash_transactions (property_id, pocket_id, created_at desc);
create index if not exists idx_petty_cash_prop on public.petty_cash_expenses (property_id, created_at desc);
create index if not exists idx_cash_collections_prop on public.cash_collections (property_id, status);
create index if not exists idx_shift_recon_prop on public.shift_reconciliations (property_id, business_date desc);
create index if not exists idx_housekeeping_prop on public.housekeeping_tasks (property_id, status);
create index if not exists idx_laundry_jobs_prop on public.laundry_jobs (property_id, status);
create index if not exists idx_luggage_transfers_prop on public.luggage_transfers (property_id, record_type, status);
create index if not exists idx_audit_log_prop on public.audit_log (property_id, created_at desc);

-- ============================================================================
-- Row-Level Security (RLS) Multi-Tenant Isolation Policies
-- ============================================================================
do $$
declare
  tbl text;
  tables text[] := array[
    'property_snapshots',
    'room_categories',
    'physical_rooms',
    'dorm_beds',
    'guest_profiles',
    'booking_groups',
    'stay_segments',
    'stay_guests',
    'ledger_entries',
    'cash_pockets',
    'cash_transactions',
    'petty_cash_expenses',
    'cash_collections',
    'shift_reconciliations',
    'housekeeping_tasks',
    'laundry_jobs',
    'luggage_transfers',
    'audit_log'
  ];
begin
  execute 'alter table public.properties enable row level security';
  execute 'drop policy if exists prop_isolation on public.properties';
  execute 'create policy prop_isolation on public.properties for all using (id = public.current_property_id()) with check (id = public.current_property_id())';

  foreach tbl in array tables loop
    execute format('alter table public.%I enable row level security', tbl);
    execute format('drop policy if exists tenant_isolation on public.%I', tbl);
    execute format(
      'create policy tenant_isolation on public.%I for all using (property_id = public.current_property_id()) with check (property_id = public.current_property_id())',
      tbl
    );
  end loop;
end $$;

-- Seed default Topchan Hostel property row
insert into public.properties (id, name, bnovo_account_id, yandex_email, wifi_pass, door_code)
values (
  'topchan-tashkent-01',
  'Topchan Hostel (Ташкент)',
  'BNV-UZ-88412',
  'topchan.hostel@yandex.ru',
  'Topchan2026!',
  '#4589*'
)
on conflict (id) do nothing;
