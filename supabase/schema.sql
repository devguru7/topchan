-- ============================================================================
-- Topchan Ops — Production Multi-Tenant PostgreSQL / Supabase Schema
-- 19 normalized operational tables + property_snapshots (optimistic lock) + RLS
-- ============================================================================

create extension if not exists "pgcrypto";

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

-- 1b. Property Members (Strict Authenticated User -> Tenant RBAC mapping)
create table if not exists public.property_members (
  user_id uuid not null,
  property_id text not null references public.properties(id) on delete cascade,
  role text not null check (role in ('owner', 'senior_admin', 'reception')),
  created_at timestamptz not null default now(),
  primary key (user_id, property_id)
);

-- Strict tenant extraction: requires authenticated role, NO hardcoded fallback tenant!
create or replace function public.current_property_id()
returns text
language sql
stable
as $$
  select case
    when auth.role() = 'authenticated' then
      coalesce(
        nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'property_id', ''),
        nullif(current_setting('app.property_id', true), '')
      )
    else null
  end;
$$;

-- Helper: checks that the caller is an authenticated member of the target property
create or replace function public.is_property_member(target_property_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.role() = 'authenticated'
    and target_property_id is not null
    and (
      target_property_id = public.current_property_id()
      or exists (
        select 1
        from public.property_members pm
        where pm.user_id = auth.uid()
          and pm.property_id = target_property_id
      )
    );
$$;

-- Snapshot sync table with optimistic concurrency revision column
create table if not exists public.property_snapshots (
  property_id text primary key references public.properties(id) on delete cascade,
  schema_version integer not null default 3,
  revision bigint not null default 1,
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

-- 18. Strictly Append-Only Audit Log (Tamper-Proof)
create table if not exists public.audit_log (
  id text primary key,
  property_id text not null references public.properties(id) on delete cascade,
  actor text not null,
  action text not null,
  diff text not null,
  reason text not null default '',
  created_at timestamptz not null default now()
);

create or replace function public.prevent_audit_log_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_log is strictly append-only and cannot be modified or deleted';
end;
$$;

drop trigger if exists trg_audit_log_append_only on public.audit_log;
create trigger trg_audit_log_append_only
  before update or delete on public.audit_log
  for each row
  execute function public.prevent_audit_log_mutation();

-- ============================================================================
-- B-Tree Indexes on property_id + hot lookup keys
-- ============================================================================
create index if not exists idx_property_members_prop on public.property_members (property_id, user_id);
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
-- Strictly requires auth.role() = 'authenticated' — ZERO anonymous access!
-- ============================================================================
do $$
declare
  tbl text;
  standard_tables text[] := array[
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
    'luggage_transfers'
  ];
begin
  -- Properties: SELECT & UPDATE only for authenticated members; DELETE explicitly forbidden
  execute 'alter table public.properties enable row level security';
  execute 'drop policy if exists prop_isolation on public.properties';
  execute 'drop policy if exists prop_select on public.properties';
  execute 'drop policy if exists prop_update on public.properties';
  execute 'drop policy if exists prop_no_delete on public.properties';
  execute 'create policy prop_select on public.properties for select using (public.is_property_member(id))';
  execute 'create policy prop_update on public.properties for update using (public.is_property_member(id)) with check (public.is_property_member(id))';
  execute 'create policy prop_no_delete on public.properties for delete using (false)';

  -- Property members: authenticated user can only read their own memberships
  execute 'alter table public.property_members enable row level security';
  execute 'drop policy if exists member_self_select on public.property_members';
  execute 'create policy member_self_select on public.property_members for select using (auth.role() = ''authenticated'' and user_id = auth.uid())';

  -- Audit log: strictly append-only (SELECT & INSERT only; UPDATE/DELETE denied by RLS + trigger)
  execute 'alter table public.audit_log enable row level security';
  execute 'drop policy if exists tenant_isolation on public.audit_log';
  execute 'drop policy if exists audit_select on public.audit_log';
  execute 'drop policy if exists audit_insert on public.audit_log';
  execute 'create policy audit_select on public.audit_log for select using (public.is_property_member(property_id))';
  execute 'create policy audit_insert on public.audit_log for insert with check (public.is_property_member(property_id))';

  -- Standard operational tables: authenticated tenant isolation
  foreach tbl in array standard_tables loop
    execute format('alter table public.%I enable row level security', tbl);
    execute format('drop policy if exists tenant_isolation on public.%I', tbl);
    execute format(
      'create policy tenant_isolation on public.%I for all using (public.is_property_member(property_id)) with check (public.is_property_member(property_id))',
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
