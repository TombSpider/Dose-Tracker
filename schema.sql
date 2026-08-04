-- Dose & Test Log — Supabase schema
-- Run this once in your Supabase project's SQL Editor (Project → SQL Editor → New query → paste → Run).

create extension if not exists "pgcrypto";

-- ---------- Supplements ----------
create table if not exists supplements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  dose_amount numeric,
  dose_unit text,
  color text,
  show_on_graph boolean not null default true,
  max_expected_dose numeric,
  created_at timestamptz not null default now()
);

create table if not exists dose_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  supplement_id uuid references supplements(id) on delete set null,
  time timestamptz not null,
  amount numeric,
  unit text,
  body_status text,
  brain_status text,
  notes text
);

-- ---------- Blood tests ----------
create table if not exists test_types (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists test_metrics (
  id uuid primary key default gen_random_uuid(),
  test_type_id uuid not null references test_types(id) on delete cascade,
  name text not null,
  unit text,
  target numeric,
  min numeric,
  max numeric,
  color text,
  is_numeric boolean not null default true,
  show_on_graph boolean not null default true
);

create table if not exists test_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  test_type_id uuid references test_types(id) on delete set null,
  date date not null,
  notes text
);

create table if not exists test_result_values (
  id uuid primary key default gen_random_uuid(),
  test_result_id uuid not null references test_results(id) on delete cascade,
  metric_id uuid references test_metrics(id) on delete set null,
  value numeric,
  text_value text
);

-- ---------- App settings (saved default graph date range) ----------
create table if not exists app_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  default_date_range_mode text not null default 'all',
  default_custom_start date,
  default_custom_end date
);

-- ---------- Row Level Security ----------
-- Every table is locked to the signed-in user. Without this, your anon key
-- (which is safe to expose in client-side code) would let ANYONE read/write
-- your data if they found your project URL. This is the piece that actually
-- makes that safe.

alter table supplements enable row level security;
alter table dose_entries enable row level security;
alter table test_types enable row level security;
alter table test_metrics enable row level security;
alter table test_results enable row level security;
alter table test_result_values enable row level security;
alter table app_settings enable row level security;

create policy "own supplements" on supplements for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own dose_entries" on dose_entries for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own test_types" on test_types for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own test_results" on test_results for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own app_settings" on app_settings for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- test_metrics and test_result_values don't have their own user_id column,
-- so their policies check ownership through the parent row instead.

create policy "own test_metrics" on test_metrics for all
  using (exists (select 1 from test_types tt where tt.id = test_metrics.test_type_id and tt.user_id = auth.uid()))
  with check (exists (select 1 from test_types tt where tt.id = test_metrics.test_type_id and tt.user_id = auth.uid()));

create policy "own test_result_values" on test_result_values for all
  using (exists (select 1 from test_results tr where tr.id = test_result_values.test_result_id and tr.user_id = auth.uid()))
  with check (exists (select 1 from test_results tr where tr.id = test_result_values.test_result_id and tr.user_id = auth.uid()));
