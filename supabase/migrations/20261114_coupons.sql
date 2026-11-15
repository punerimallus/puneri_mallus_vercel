-- Coupons: a code a buyer types at checkout for money off, free passes, or both.
--
-- The hard part here is not the discount arithmetic, it is the usage cap. A coupon limited to
-- ten uses, typed by forty people in the same minute during a sale, must be accepted exactly
-- ten times. That is the same problem the seat reservation already solves, and it is solved the
-- same way: the count lives in one row, the row is locked, and the check and the increment
-- happen inside that lock. A read-then-write from the application would hand out forty.
--
-- A claim is tied to the RESERVATION, not the booking, because it has to be taken before the
-- buyer reaches Razorpay — at the same moment as the seats — and given back by the same paths
-- that give seats back: an abandoned checkout, a sweep, a refund.
--
-- Safe to run more than once.

begin;

-- 1. The coupons themselves ------------------------------------------------------------------
create table if not exists public.coupons (
  id              uuid primary key default gen_random_uuid(),
  -- Always upper case. The application upper-cases on the way in and on the way out, and this
  -- constraint is what stops a lower-case row sneaking in by another route and never matching.
  code            text not null unique check (code = upper(code) and length(code) between 3 and 24),
  -- Which event it works on. Null means every event, which is deliberate: a "WELCOME10" that
  -- outlives one show is a reasonable thing to want.
  event_id        text,
  kind            text not null check (kind in ('DISCOUNT', 'FREE_TICKET', 'BOTH')),
  -- What the free passes are counted against.
  --   INDIVIDUAL  free_qty passes, once, however much was bought
  --   BUNDLE      free_qty passes PER BUNDLE UNIT bought: two bundles and free_qty 2 is four
  -- A BUNDLE coupon on a cart with no bundles gives nothing and says so, rather than quietly
  -- being worth less than the buyer was told.
  scope           text not null default 'INDIVIDUAL' check (scope in ('INDIVIDUAL', 'BUNDLE')),

  -- Money off. Percent is capped at 100 by the check; flat is in rupees.
  discount_type   text check (discount_type in ('PERCENT', 'FLAT')),
  discount_value  numeric(10, 2) check (discount_value is null or discount_value > 0),

  -- Free passes, from a category the admin picks.
  free_category_id uuid references public.event_ticket_categories (id) on delete set null,
  free_qty         integer check (free_qty is null or free_qty >= 1),

  -- Null max_uses means unlimited. `uses` only ever moves through claim_coupon/release_coupon.
  max_uses        integer check (max_uses is null or max_uses >= 1),
  uses            integer not null default 0 check (uses >= 0),
  -- How many times ONE account may use it. 1 is the common case.
  per_account_uses integer not null default 1 check (per_account_uses >= 1),

  active          boolean not null default true,
  expires_at      timestamptz,
  note            text,
  created_by      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- A coupon has to actually be able to do something.
  constraint coupons_discount_shape check (
    (kind in ('DISCOUNT', 'BOTH')) = (discount_type is not null and discount_value is not null)
  ),
  constraint coupons_free_shape check (
    (kind in ('FREE_TICKET', 'BOTH')) = (free_category_id is not null and free_qty is not null)
  ),
  constraint coupons_percent_range check (
    discount_type is distinct from 'PERCENT' or discount_value <= 100
  )
);

create index if not exists coupons_event_idx on public.coupons (event_id) where active;

-- 2. Who used it -------------------------------------------------------------------------------
-- One row per claim. Held against the reservation while a checkout is open, and stamped with
-- the booking once the payment is fulfilled, so the box office can answer "who used WELCOME10"
-- and "which REGULAR-n went out free".
create table if not exists public.coupon_redemptions (
  id              uuid primary key default gen_random_uuid(),
  coupon_id       uuid not null references public.coupons (id) on delete cascade,
  reservation_id  text not null,
  user_id         uuid,
  email           text,
  booking_id      uuid,
  event_id        text,
  discount_amount numeric(10, 2) not null default 0,
  -- The pass numbers this coupon gave away, filled in at fulfilment: ["REGULAR-047"].
  free_numbers    jsonb not null default '[]'::jsonb,
  created_at      timestamptz not null default now(),
  confirmed_at    timestamptz
);

-- One claim per reservation: replaying the checkout call must not take a second use.
create unique index if not exists coupon_redemptions_reservation_idx
  on public.coupon_redemptions (reservation_id);
create index if not exists coupon_redemptions_coupon_idx on public.coupon_redemptions (coupon_id);
create index if not exists coupon_redemptions_booking_idx on public.coupon_redemptions (booking_id);
create index if not exists coupon_redemptions_user_idx on public.coupon_redemptions (user_id);

-- 3. Claiming ---------------------------------------------------------------------------------
-- Checks and increments under one lock, exactly like the seat reservation. Raises rather than
-- returning a flag so a refusal can never be mistaken for a success by a careless caller:
--   COUPON_UNKNOWN            no such code
--   COUPON_INACTIVE           switched off by an admin
--   COUPON_EXPIRED            past its date
--   COUPON_WRONG_EVENT        not valid on this event
--   COUPON_EXHAUSTED          all its uses are gone
--   COUPON_ALREADY_USED:<n>   this account has had its <n> allowed uses
create or replace function public.claim_coupon(
  p_code           text,
  p_reservation_id text,
  p_user_id        uuid,
  p_event_id       text,
  p_email          text default null
)
returns public.coupons
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  c    public.coupons%rowtype;
  mine integer;
begin
  -- Idempotent: the same reservation claiming twice gets the same answer and takes no second use.
  if exists (select 1 from public.coupon_redemptions where reservation_id = p_reservation_id) then
    select * into c from public.coupons
     where id = (select coupon_id from public.coupon_redemptions where reservation_id = p_reservation_id);
    return c;
  end if;

  select * into c from public.coupons where code = upper(btrim(p_code)) for update;
  if not found then
    raise exception 'COUPON_UNKNOWN';
  end if;
  if not c.active then
    raise exception 'COUPON_INACTIVE';
  end if;
  if c.expires_at is not null and c.expires_at <= now() then
    raise exception 'COUPON_EXPIRED';
  end if;
  if c.event_id is not null and c.event_id is distinct from p_event_id then
    raise exception 'COUPON_WRONG_EVENT';
  end if;
  if c.max_uses is not null and c.uses >= c.max_uses then
    raise exception 'COUPON_EXHAUSTED';
  end if;

  if p_user_id is not null then
    select count(*) into mine from public.coupon_redemptions
     where coupon_id = c.id and user_id = p_user_id;
    if mine >= c.per_account_uses then
      raise exception 'COUPON_ALREADY_USED:%', c.per_account_uses;
    end if;
  end if;

  insert into public.coupon_redemptions (coupon_id, reservation_id, user_id, email, event_id)
  values (c.id, p_reservation_id, p_user_id, p_email, p_event_id);

  update public.coupons set uses = uses + 1, updated_at = now() where id = c.id
  returning * into c;

  return c;
end $function$;

-- 4. Giving it back ---------------------------------------------------------------------------
-- Called wherever seats are given back: an abandoned checkout, the stale-hold sweeper, a
-- refund. Safe from any state and safe to call repeatedly.
create or replace function public.release_coupon(p_reservation_id text)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r public.coupon_redemptions%rowtype;
begin
  delete from public.coupon_redemptions
   where reservation_id = p_reservation_id
  returning * into r;

  if not found then
    return false;
  end if;

  -- greatest(): the count can never be talked below zero, whatever order things unwind in.
  update public.coupons
     set uses = greatest(0, uses - 1), updated_at = now()
   where id = r.coupon_id;

  return true;
end $function$;

-- 5. Confirming -------------------------------------------------------------------------------
-- The payment landed: tie the claim to the booking and record what it actually gave away.
create or replace function public.confirm_coupon(
  p_reservation_id  text,
  p_booking_id      uuid,
  p_discount_amount numeric,
  p_free_numbers    jsonb
)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  update public.coupon_redemptions
     set booking_id = p_booking_id,
         discount_amount = coalesce(p_discount_amount, 0),
         free_numbers = coalesce(p_free_numbers, '[]'::jsonb),
         confirmed_at = now()
   where reservation_id = p_reservation_id;
  return found;
end $function$;

-- 6. The sweeper also lets coupons go -----------------------------------------------------------
-- release_order_inventory is what every "give it back" path funnels through, so the coupon is
-- released there rather than at a dozen call sites that would each have to remember.
create or replace function public.release_order_inventory(p_reservation_id text)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  res   public.inventory_reservations%rowtype;
  cats  uuid[];
  c     uuid;
  freed integer := 0;
begin
  select * into res from public.inventory_reservations
   where reservation_id = p_reservation_id for update;
  if not found or res.state = 'RELEASED' then
    return 0;
  end if;

  -- Always in id order: two releases touching the same categories cannot deadlock.
  select coalesce(array_agg(distinct category_id order by category_id), '{}') into cats
    from public.ticket_numbers where reservation_id = p_reservation_id;

  delete from public.ticket_numbers where reservation_id = p_reservation_id;
  get diagnostics freed = row_count;

  foreach c in array cats loop
    perform public.refresh_category_counts(c);
  end loop;

  if res.points_held > 0 and res.user_id is not null then
    if res.state = 'CONFIRMED' then
      -- Already spent: give the points back to the balance.
      update public.profiles
         set loyalty_points = coalesce(loyalty_points, 0) + res.points_held
       where id = res.user_id;
    else
      -- Never spent: just stop promising them.
      update public.profiles
         set loyalty_points_held = greatest(0, coalesce(loyalty_points_held, 0) - res.points_held)
       where id = res.user_id;
    end if;
  end if;

  -- A coupon claimed by this checkout goes back on the shelf with the seats.
  perform public.release_coupon(p_reservation_id);

  update public.inventory_reservations
     set state = 'RELEASED', released_at = now()
   where reservation_id = p_reservation_id;

  return freed;
end $function$;

-- 7. Locked down --------------------------------------------------------------------------------
-- Only the service role touches any of this. A browser that could read `coupons` could read
-- every unused code in the table.
alter table public.coupons             enable row level security;
alter table public.coupon_redemptions  enable row level security;

revoke all on table public.coupons            from anon, authenticated;
revoke all on table public.coupon_redemptions from anon, authenticated;

revoke all on function public.claim_coupon(text, text, uuid, text, text) from public, anon, authenticated;
revoke all on function public.release_coupon(text)                       from public, anon, authenticated;
revoke all on function public.confirm_coupon(text, uuid, numeric, jsonb) from public, anon, authenticated;

insert into public.app_schema_markers (name) values ('coupons_v1')
  on conflict (name) do update set applied_at = now();

commit;

-- Afterwards:
--   select name from public.app_schema_markers where name = 'coupons_v1';   -- 1 row
--   select count(*) from public.coupons;                                    -- 0, nothing seeded
--   select count(*) from public.coupon_redemptions;                         -- 0
