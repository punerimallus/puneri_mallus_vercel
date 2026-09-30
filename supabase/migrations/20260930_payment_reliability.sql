-- Payment reliability: server-side fulfilment, idempotency and reconciliation.
-- Run this once in the Supabase SQL editor BEFORE deploying the matching code.
-- Safe to re-run: every statement is guarded with IF NOT EXISTS / OR REPLACE.

-- ---------------------------------------------------------------------------
-- 1. payment_orders: the server's record of what each Razorpay order is for.
--    Written when the order is created, so fulfilment never trusts the browser.
-- ---------------------------------------------------------------------------
create table if not exists public.payment_orders (
  id                     uuid primary key default gen_random_uuid(),
  razorpay_order_id      text not null unique,
  razorpay_payment_id    text,
  user_id                uuid,
  payment_type           text not null,             -- EVENT_TICKET | LIFETIME | MART
  plan                   text,
  event_id               text,
  cart                   jsonb,                      -- [{categoryId, name, prefix, qty, unitPrice}]
  event_snapshot         jsonb,                      -- {title, date, time, location, memberPoints, nonMemberPoints}
  points_to_redeem       integer not null default 0,
  is_member_at_order     boolean not null default false,
  receipt_email          text,
  base_amount            numeric not null,           -- rupees, before gateway fee
  amount_paise           integer not null,           -- exactly what Razorpay was asked to collect
  currency               text not null default 'INR',
  -- CREATED -> PROCESSING -> FULFILLED
  -- CREATED -> FAILED (may still go to PROCESSING if a retry succeeds)
  -- PROCESSING -> PAID (payment confirmed but a fulfilment step errored; retried automatically)
  -- PROCESSING -> NEEDS_ATTENTION (sold out / amount mismatch / already a member)
  -- FULFILLED | NEEDS_ATTENTION -> REFUNDED | PARTIALLY_REFUNDED
  status                 text not null default 'CREATED',
  status_reason          text,
  processing_started_at  timestamptz,
  allocated_tickets      jsonb,                      -- saved right after seats are reserved, so retries reuse them
  booking_id             uuid,
  loyalty_applied        boolean not null default false,
  ledger_recorded        boolean not null default false,
  email_status           text not null default 'PENDING', -- PENDING | SENT | FAILED | SKIPPED
  email_attempts         integer not null default 0,
  email_error            text,
  last_emailed_at        timestamptz,
  fulfilled_via          text,                       -- CLIENT | WEBHOOK | RECONCILE | STATUS_POLL
  fulfilled_at           timestamptz,
  refunded_amount_paise  integer not null default 0,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index if not exists payment_orders_status_idx on public.payment_orders (status, created_at);
create index if not exists payment_orders_email_idx on public.payment_orders (email_status) where email_status = 'FAILED';
create index if not exists payment_orders_payment_idx on public.payment_orders (razorpay_payment_id);
create index if not exists payment_orders_user_idx on public.payment_orders (user_id, created_at desc);

alter table public.payment_orders enable row level security; -- service role only; no policies on purpose

-- ---------------------------------------------------------------------------
-- 2. payment_webhook_events: Razorpay retries webhooks, so each event id is
--    stored once and duplicates are acknowledged without re-processing.
-- ---------------------------------------------------------------------------
create table if not exists public.payment_webhook_events (
  event_id     text primary key,
  event_type   text not null,
  order_id     text,
  payment_id   text,
  payload      jsonb,
  received_at  timestamptz not null default now()
);

alter table public.payment_webhook_events enable row level security;

-- ---------------------------------------------------------------------------
-- 3. ticket_bookings: booking status (for refunds) and email delivery state.
-- ---------------------------------------------------------------------------
alter table public.ticket_bookings add column if not exists status text not null default 'CONFIRMED';
alter table public.ticket_bookings add column if not exists email_status text;
alter table public.ticket_bookings add column if not exists email_attempts integer not null default 0;
alter table public.ticket_bookings add column if not exists last_emailed_at timestamptz;

-- One booking per Razorpay order. Replaying the old /api/tickets/verify call
-- could create duplicates; if any exist the index is skipped with a notice.
-- Find them with:
--   select razorpay_order_id, count(*) from ticket_bookings
--   where razorpay_order_id is not null group by 1 having count(*) > 1;
do $$
begin
  if exists (
    select 1 from public.ticket_bookings
    where razorpay_order_id is not null
    group by razorpay_order_id having count(*) > 1
  ) then
    raise notice 'Duplicate ticket_bookings per razorpay_order_id exist; unique index NOT created. Clean them up and re-run.';
  else
    create unique index if not exists ticket_bookings_order_uidx
      on public.ticket_bookings (razorpay_order_id) where razorpay_order_id is not null;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. allocate_tickets: reserve seats for a whole cart in ONE transaction.
--    The old code read `sold`, added in JS and wrote it back, so two buyers at
--    the same moment got the same ticket numbers and could oversell.
--    p_items: [{"categoryId": "...", "qty": 2}, ...]
--    Returns [{"categoryId": "...", "endSold": 42, "qty": 2}, ...]
--    Raises 'SOLD_OUT:<category name>' and reserves nothing if any category is full.
-- ---------------------------------------------------------------------------
create or replace function public.allocate_tickets(p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  item      jsonb;
  new_sold  integer;
  cat_name  text;
  result    jsonb := '[]'::jsonb;
begin
  for item in select * from jsonb_array_elements(p_items) loop
    update public.event_ticket_categories
       set sold = coalesce(sold, 0) + (item->>'qty')::int
     where id::text = item->>'categoryId'
       and (capacity is null or coalesce(sold, 0) + (item->>'qty')::int <= capacity)
    returning sold into new_sold;

    if new_sold is null then
      select name into cat_name from public.event_ticket_categories where id::text = item->>'categoryId';
      raise exception 'SOLD_OUT:%', coalesce(cat_name, item->>'categoryId');
    end if;

    result := result || jsonb_build_object(
      'categoryId', item->>'categoryId',
      'qty', (item->>'qty')::int,
      'endSold', new_sold
    );
    new_sold := null;
  end loop;
  return result;
end $$;

revoke all on function public.allocate_tickets(jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. adjust_loyalty_points: atomic add/subtract, never below zero.
-- ---------------------------------------------------------------------------
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

revoke all on function public.adjust_loyalty_points(uuid, integer) from public, anon, authenticated;
