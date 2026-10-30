-- The production schema as it stands BEFORE 20261028_ticketing_integrity.sql, reduced to the
-- tables and columns the ticketing migration touches. Used only by tests/sql/*.test.ts, which
-- apply this and then the real migration file to a throwaway in-process Postgres, so the
-- migration is executed for real rather than eyeballed.
--
-- Column types here were read off the live project (uuid category ids, text Mongo event ids).

create schema if not exists public;

-- Supabase ships these roles; plain Postgres does not, and the migration revokes from them.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end $$;

create table public.profiles (
  id             uuid primary key,
  email          text,
  phone_number   text,
  dob            date,
  is_member      boolean not null default false,
  mart_unlocked  boolean not null default false,
  loyalty_points integer not null default 0
);

create table public.authorized_admins (
  email text primary key
);

-- Supabase ships auth.jwt(); plain Postgres does not, and the RLS policies in the venue-map
-- migration are defined in terms of it. Stubbed so those policies can be created for real here.
create schema if not exists auth;
create or replace function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;

create table public.app_settings (
  id              integer primary key default 1,
  membership_price integer,
  membership_enabled boolean default true
);

create table public.event_ticket_categories (
  id         uuid primary key default gen_random_uuid(),
  event_id   text    not null,
  name       text    not null,
  prefix     text    not null default '',
  price      numeric not null default 0,
  capacity   integer,
  sold       integer default 0,
  released   integer not null default 0,
  active     boolean default true,
  group_size integer not null default 1
);

create unique index event_ticket_categories_event_prefix_uq
  on public.event_ticket_categories (event_id, upper(prefix));

create table public.ticket_bookings (
  id                  uuid primary key default gen_random_uuid(),
  event_id            text not null,
  user_id             uuid references public.profiles (id) on delete set null,
  email               text,
  amount_paid         numeric not null default 0,
  razorpay_order_id   text,
  razorpay_payment_id text,
  tickets_data        jsonb,
  status              text default 'CONFIRMED',
  scan_version        integer not null default 0,
  email_status        text default 'PENDING',
  email_attempts      integer not null default 0,
  last_emailed_at     timestamptz,
  created_at          timestamptz not null default now()
);

create unique index ticket_bookings_order_uidx
  on public.ticket_bookings (razorpay_order_id) where razorpay_order_id is not null;

create table public.payment_orders (
  razorpay_order_id     text primary key,
  razorpay_payment_id   text,
  user_id               uuid,
  payment_type          text not null,
  plan                  text,
  event_id              text,
  cart                  jsonb,
  event_snapshot        jsonb,
  points_to_redeem      integer not null default 0,
  is_member_at_order    boolean not null default false,
  receipt_email         text,
  base_amount           numeric not null default 0,
  amount_paise          integer not null default 0,
  currency              text not null default 'INR',
  status                text not null default 'CREATED',
  status_reason         text,
  processing_started_at timestamptz,
  allocated_tickets     jsonb,
  booking_id            uuid,
  loyalty_applied       boolean not null default false,
  loyalty_reversed      boolean not null default false,
  seats_released        boolean not null default false,
  ledger_recorded       boolean not null default false,
  email_status          text not null default 'PENDING',
  email_attempts        integer not null default 0,
  email_error           text,
  last_emailed_at       timestamptz,
  fulfilled_via         text,
  fulfilled_at          timestamptz,
  refunded_amount_paise integer not null default 0,
  whatsapp_opt_in       boolean default false,
  whatsapp_to           text,
  whatsapp_status       text,
  whatsapp_message_id   text,
  whatsapp_error        text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create table public.payments (
  razorpay_payment_id text primary key,
  razorpay_order_id   text,
  user_id             uuid,
  email               text,
  phone_number        text,
  payment_type        text,
  plan                text,
  amount              numeric,
  status              text,
  created_at          timestamptz not null default now()
);

create table public.payment_webhook_events (
  event_id   text primary key,
  event_type text,
  order_id   text,
  payment_id text,
  payload    jsonb,
  created_at timestamptz not null default now()
);

create table public.memberships (
  user_id    uuid primary key,
  email      text,
  status     text,
  payment_id text
);

create table public.mart_subscriptions (
  user_id         uuid primary key,
  plan            text,
  status          text,
  expires_at      timestamptz,
  last_payment_id text
);

create or replace function public.adjust_loyalty_points(p_user_id uuid, p_delta integer)
returns integer
language sql
security definer
set search_path = public
as $$
  update public.profiles
     set loyalty_points = greatest(0, coalesce(loyalty_points, 0) + p_delta)
   where id = p_user_id
  returning loyalty_points;
$$;
