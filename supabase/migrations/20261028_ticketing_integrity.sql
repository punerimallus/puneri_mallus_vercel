-- Ticketing integrity.
--
-- What changes, and why:
--   1. Seats are reserved BEFORE the buyer is sent to Razorpay, not after they pay. Nobody can
--      pay for a seat that no longer exists, so the "paid but sold out" case disappears.
--   2. Ticket numbers live in a real table with a unique key instead of being recomputed by
--      scanning every order's JSON. Allocation is an indexed lookup, not an O(n^2) sweep under
--      a lock, and a freed number goes back into the pool by being deleted.
--   3. Per-account ticket limits and loyalty points are reserved in the same transaction as the
--      seats, under a lock on the buyer's own profile row, so two tabs cannot both pass a check.
--   4. Gate scans are attributed to whoever made them and bound to one event.
--   5. Volunteers can scan passes without being full admins.
--
-- Safe to run more than once. Existing categories, bookings and passes keep working unchanged.

begin;

-- 0. A marker the application checks -------------------------------------------------------
-- Until this row exists the payment routes refuse to take money rather than quietly running in
-- a degraded mode. That silent degrading is exactly what this migration removes.
create table if not exists public.app_schema_markers (
  name       text primary key,
  applied_at timestamptz not null default now()
);

-- 1. Reservations --------------------------------------------------------------------------
-- One row per checkout attempt. It owns the seats and the points until it is confirmed
-- (payment fulfilled) or released (abandoned, failed, expired or refunded).
create table if not exists public.inventory_reservations (
  reservation_id text primary key,
  user_id        uuid,
  event_id       text,
  points_held    integer     not null default 0,
  state          text        not null default 'HELD',
  expires_at     timestamptz not null,
  created_at     timestamptz not null default now(),
  confirmed_at   timestamptz,
  released_at    timestamptz
);

alter table public.inventory_reservations drop constraint if exists inventory_reservations_state_check;
alter table public.inventory_reservations
  add constraint inventory_reservations_state_check check (state in ('HELD', 'CONFIRMED', 'RELEASED'));

create index if not exists inventory_reservations_sweep_idx on public.inventory_reservations (state, expires_at);
create index if not exists inventory_reservations_user_idx  on public.inventory_reservations (user_id, event_id);

-- 2. Ticket numbers ------------------------------------------------------------------------
-- The primary key is what makes a duplicate ticket number impossible, whatever the application
-- does. A number nobody holds simply has no row, which is how a refunded number is reused.
create table if not exists public.ticket_numbers (
  category_id    uuid    not null references public.event_ticket_categories (id) on delete cascade,
  number         integer not null,
  reservation_id text    not null references public.inventory_reservations (reservation_id) on delete cascade,
  user_id        uuid,
  state          text    not null default 'HELD',
  created_at     timestamptz not null default now(),
  primary key (category_id, number)
);

alter table public.ticket_numbers drop constraint if exists ticket_numbers_state_check;
alter table public.ticket_numbers
  add constraint ticket_numbers_state_check check (state in ('HELD', 'ISSUED'));

create index if not exists ticket_numbers_reservation_idx on public.ticket_numbers (reservation_id);
create index if not exists ticket_numbers_user_idx        on public.ticket_numbers (user_id);

-- `sold` now means "seats in use" and is kept equal to the live row count, so the existing
-- capacity formula (sold - released) and every screen reading it stay correct with `released`
-- pinned at 0. `issued_total` only ever goes up, and is what tells the admin screens that a
-- category has had passes issued at some point.
alter table public.event_ticket_categories
  add column if not exists issued_total integer not null default 0;

-- Which reservation a payment order owns, and what happened to any automatic refund.
alter table public.payment_orders
  add column if not exists reservation_id text,
  add column if not exists auto_refund_id text,
  add column if not exists auto_refund_at timestamptz;

create index if not exists payment_orders_reservation_idx on public.payment_orders (reservation_id);

-- Loyalty points promised to an open checkout but not yet spent. Available = points - held.
alter table public.profiles
  add column if not exists loyalty_points_held integer not null default 0;

-- 3. Gate staff and the scan audit trail ---------------------------------------------------
-- A volunteer on the gate needs to scan passes and nothing else. `event_id` null means every
-- event; a value restricts them to that one.
create table if not exists public.event_staff (
  id         uuid primary key default gen_random_uuid(),
  email      text    not null,
  role       text    not null default 'SCANNER',
  event_id   text,
  active     boolean not null default true,
  note       text,
  added_by   text,
  created_at timestamptz not null default now()
);

alter table public.event_staff drop constraint if exists event_staff_role_check;
alter table public.event_staff add constraint event_staff_role_check check (role in ('SCANNER'));

-- One row per person per scope, case-insensitively.
create unique index if not exists event_staff_email_scope_uq
  on public.event_staff (lower(email), coalesce(event_id, '*'));

-- Every admission, and who let them in. Append-only.
create table if not exists public.scan_log (
  id            bigserial primary key,
  booking_id    uuid    not null,
  ticket_number text    not null,
  event_id      text,
  admitted      integer not null,
  action        text    not null default 'ADMIT',
  actor_email   text,
  actor_id      uuid,
  actor_role    text,
  signed        boolean not null default false,
  at            timestamptz not null default now()
);

create index if not exists scan_log_booking_idx on public.scan_log (booking_id, at desc);
create index if not exists scan_log_event_idx   on public.scan_log (event_id, at desc);

-- 4. Helpers -------------------------------------------------------------------------------

-- Keeps `sold` equal to the seats actually held or issued for a category.
create or replace function public.refresh_category_counts(p_category_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  live integer;
begin
  select count(*) into live from public.ticket_numbers where category_id = p_category_id;
  update public.event_ticket_categories
     set sold = live, released = 0
   where id = p_category_id;
  return live;
end $function$;

-- 5. Releasing -----------------------------------------------------------------------------
-- Gives the seats back and undoes the points, from either state, exactly once:
--   from HELD      the checkout was abandoned / failed / expired; the points were never spent.
--   from CONFIRMED the order was refunded; the points that were spent are returned.
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

  update public.inventory_reservations
     set state = 'RELEASED', released_at = now()
   where reservation_id = p_reservation_id;

  return freed;
end $function$;

-- Drops holds nobody completed, giving their seats and points straight back.
create or replace function public.expire_stale_holds()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r       record;
  touched integer := 0;
begin
  for r in
    select reservation_id from public.inventory_reservations
     where state = 'HELD' and expires_at < now()
     order by reservation_id
     limit 500
  loop
    perform public.release_order_inventory(r.reservation_id);
    touched := touched + 1;
  end loop;
  return touched;
end $function$;

-- 6. Reserving -----------------------------------------------------------------------------
-- Takes the seats, picks the numbers, enforces the per-account limits and reserves the loyalty
-- points, all in one transaction. Raises on anything that should stop the sale BEFORE payment:
--   SOLD_OUT:<category>     the category filled up
--   LIMIT_SINGLE:<max>      this account already holds its maximum single passes for the event
--   LIMIT_GROUP:<max>       ditto for group passes
--   POINTS_UNAVAILABLE:<n>  fewer points available than asked for (n = actually available)
create or replace function public.reserve_order_inventory(
  p_reservation_id text,
  p_user_id        uuid,
  p_items          jsonb,
  p_points         integer default 0,
  p_ttl_seconds    integer default 900,
  p_max_single     integer default 7,
  p_max_group      integer default 2
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  item      jsonb;
  cat       public.event_ticket_categories%rowtype;
  qty       integer;
  in_use    integer;
  nums      integer[];
  ev        text;
  singles   integer;
  groups    integer;
  available integer;
  result    jsonb := '[]'::jsonb;
begin
  if p_reservation_id is null or p_reservation_id = '' then
    raise exception 'RESERVATION_ID_REQUIRED';
  end if;

  -- Idempotent: the same reservation id never takes seats twice.
  if exists (select 1 from public.inventory_reservations where reservation_id = p_reservation_id) then
    select coalesce(jsonb_agg(jsonb_build_object(
             'categoryId', t.category_id,
             'qty',        t.cnt,
             'numbers',    to_jsonb(t.numbers))), '[]'::jsonb)
      into result
      from (
        select category_id, count(*) as cnt, array_agg(number order by number) as numbers
          from public.ticket_numbers
         where reservation_id = p_reservation_id
         group by category_id
      ) t;
    return result;
  end if;

  -- NOTE: expiring stale holds is deliberately NOT done here. Sweeping takes locks on other
  -- people's reservations and categories, which could deadlock against a concurrent reserve
  -- that already holds one of them. The application calls expire_stale_holds() as its own
  -- transaction just before reserving, and the reconcile job runs it on a schedule.

  -- Everything this buyer does is serialised on their own profile row, so two tabs cannot both
  -- slip past the per-account limit or spend the same points.
  if p_user_id is not null then
    perform 1 from public.profiles where id = p_user_id for update;
  end if;

  select c.event_id into ev
    from public.event_ticket_categories c
   where c.id::text = (p_items->0->>'categoryId');

  insert into public.inventory_reservations (reservation_id, user_id, event_id, points_held, state, expires_at)
  values (p_reservation_id, p_user_id, ev, 0, 'HELD', now() + make_interval(secs => greatest(60, p_ttl_seconds)));

  -- Categories are always locked in id order so two carts holding the same pair cannot deadlock.
  for item in
    select e from jsonb_array_elements(p_items) e order by (e->>'categoryId')
  loop
    qty := coalesce((item->>'qty')::int, 0);
    if qty <= 0 then
      continue;
    end if;

    select * into cat from public.event_ticket_categories where id::text = item->>'categoryId' for update;
    if not found then
      raise exception 'UNKNOWN_CATEGORY:%', item->>'categoryId';
    end if;
    if cat.active is false then
      raise exception 'SOLD_OUT:%', cat.name;
    end if;
    if cat.event_id is distinct from ev then
      raise exception 'MIXED_EVENT_CART';
    end if;

    select count(*) into in_use from public.ticket_numbers where category_id = cat.id;
    if cat.capacity is not null and in_use + qty > cat.capacity then
      raise exception 'SOLD_OUT:%', cat.name;
    end if;

    -- The `qty` lowest numbers nobody holds. Each candidate is a primary-key probe.
    select array_agg(g order by g) into nums
      from (
        select g
          from generate_series(1, in_use + qty) g
         where not exists (
                 select 1 from public.ticket_numbers t
                  where t.category_id = cat.id and t.number = g)
         order by g
         limit qty
      ) free;

    if nums is null or array_length(nums, 1) <> qty then
      raise exception 'SOLD_OUT:%', cat.name;
    end if;

    insert into public.ticket_numbers (category_id, number, reservation_id, user_id, state)
    select cat.id, n, p_reservation_id, p_user_id, 'HELD' from unnest(nums) n;

    update public.event_ticket_categories
       set sold = in_use + qty, released = 0, issued_total = issued_total + qty
     where id = cat.id;

    result := result || jsonb_build_object(
      'categoryId', cat.id,
      'qty',        qty,
      'numbers',    to_jsonb(nums),
      'endSold',    in_use + qty
    );
  end loop;

  if jsonb_array_length(result) = 0 then
    raise exception 'EMPTY_CART';
  end if;

  -- Per-account limits, counted over everything this account holds or has been issued for this
  -- event, including the rows just inserted.
  if p_user_id is not null and ev is not null then
    select
      count(*) filter (where coalesce(c.group_size, 1) <= 1),
      count(*) filter (where coalesce(c.group_size, 1) > 1)
      into singles, groups
      from public.ticket_numbers t
      join public.event_ticket_categories c on c.id = t.category_id
     where t.user_id = p_user_id and c.event_id = ev;

    if singles > p_max_single then
      raise exception 'LIMIT_SINGLE:%', p_max_single;
    end if;
    if groups > p_max_group then
      raise exception 'LIMIT_GROUP:%', p_max_group;
    end if;
  end if;

  -- Loyalty points: reserved now, actually spent only when the payment is fulfilled.
  if p_points > 0 then
    if p_user_id is null then
      raise exception 'POINTS_UNAVAILABLE:0';
    end if;
    select greatest(0, coalesce(loyalty_points, 0) - coalesce(loyalty_points_held, 0))
      into available
      from public.profiles where id = p_user_id;
    if coalesce(available, 0) < p_points then
      raise exception 'POINTS_UNAVAILABLE:%', coalesce(available, 0);
    end if;
    update public.profiles
       set loyalty_points_held = coalesce(loyalty_points_held, 0) + p_points
     where id = p_user_id;
    update public.inventory_reservations
       set points_held = p_points
     where reservation_id = p_reservation_id;
  end if;

  return result;
end $function$;

-- 7. Confirming ----------------------------------------------------------------------------
-- The payment was captured and fulfilled: the held numbers become issued and the reserved
-- points are actually spent. Idempotent. Raises RESERVATION_LOST if the hold had already been
-- released, which the application turns into an automatic refund.
create or replace function public.confirm_order_inventory(p_reservation_id text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  res   public.inventory_reservations%rowtype;
  moved integer;
begin
  select * into res from public.inventory_reservations
   where reservation_id = p_reservation_id for update;
  if not found then
    raise exception 'RESERVATION_LOST:%', p_reservation_id;
  end if;
  if res.state = 'CONFIRMED' then
    return jsonb_build_object('alreadyConfirmed', true, 'pointsSpent', res.points_held);
  end if;
  if res.state = 'RELEASED' then
    raise exception 'RESERVATION_LOST:%', p_reservation_id;
  end if;

  update public.ticket_numbers set state = 'ISSUED' where reservation_id = p_reservation_id;
  get diagnostics moved = row_count;

  if res.points_held > 0 and res.user_id is not null then
    update public.profiles
       set loyalty_points      = greatest(0, coalesce(loyalty_points, 0) - res.points_held),
           loyalty_points_held = greatest(0, coalesce(loyalty_points_held, 0) - res.points_held)
     where id = res.user_id;
  end if;

  update public.inventory_reservations
     set state = 'CONFIRMED', confirmed_at = now()
   where reservation_id = p_reservation_id;

  return jsonb_build_object('alreadyConfirmed', false, 'issued', moved, 'pointsSpent', res.points_held);
end $function$;

-- Frees one pass (an admin voiding a single ticket) and puts its number back in the pool.
create or replace function public.void_ticket_number(p_reservation_id text, p_category_id uuid, p_number integer)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  gone integer;
begin
  delete from public.ticket_numbers
   where reservation_id = p_reservation_id and category_id = p_category_id and number = p_number;
  get diagnostics gone = row_count;
  if gone > 0 then
    perform public.refresh_category_counts(p_category_id);
  end if;
  return gone;
end $function$;

-- 8. Backfill: every pass that already exists must own its number -------------------------
-- Otherwise the allocator would hand out numbers that are already printed on someone's PDF.
-- Legacy passes get one CONFIRMED reservation per booking, with no points held (their points
-- were already settled by the old code, so a refund must not return them twice).
do $$
declare
  b        record;
  t        jsonb;
  cat      public.event_ticket_categories%rowtype;
  res_id   text;
  num      integer;
  digits   text;
  made     integer := 0;
  skipped  integer := 0;
begin
  for b in
    select id, event_id, user_id, tickets_data
      from public.ticket_bookings
     where coalesce(status, 'CONFIRMED') <> 'REFUNDED'
       and tickets_data is not null
  loop
    res_id := 'legacy-' || b.id::text;

    insert into public.inventory_reservations (reservation_id, user_id, event_id, points_held, state, expires_at, confirmed_at)
    values (res_id, b.user_id, b.event_id, 0, 'CONFIRMED', now(), now())
    on conflict (reservation_id) do nothing;

    for t in select e from jsonb_array_elements(b.tickets_data) e loop
      if coalesce(t->>'status', 'ISSUED') = 'REFUNDED' then
        continue;
      end if;

      select * into cat from public.event_ticket_categories
       where event_id = b.event_id and name = (t->>'categoryName')
       limit 1;
      if not found then
        skipped := skipped + 1;
        continue;
      end if;

      -- "GA-013" with prefix "GA-" is number 13. Fall back to the trailing digits.
      digits := regexp_replace(coalesce(t->>'ticketNumber', ''), '^.*?([0-9]+)$', '\1');
      if digits = '' or digits !~ '^[0-9]+$' then
        skipped := skipped + 1;
        continue;
      end if;
      num := digits::int;

      insert into public.ticket_numbers (category_id, number, reservation_id, user_id, state)
      values (cat.id, num, res_id, b.user_id, 'ISSUED')
      on conflict (category_id, number) do nothing;

      if found then
        made := made + 1;
      end if;
    end loop;
  end loop;

  -- Point the orders at the reservations their bookings now own, so a refund frees the numbers.
  update public.payment_orders o
     set reservation_id = 'legacy-' || o.booking_id::text
   where o.booking_id is not null
     and o.reservation_id is null
     and exists (select 1 from public.inventory_reservations r
                  where r.reservation_id = 'legacy-' || o.booking_id::text);

  raise notice 'ticket number backfill: % claimed, % skipped (unmatched category or unparseable number)', made, skipped;
end $$;

-- Counters now mean "seats in use", straight from the rows above.
update public.event_ticket_categories c
   set sold         = coalesce((select count(*) from public.ticket_numbers t where t.category_id = c.id), 0),
       released     = 0,
       issued_total = greatest(c.issued_total, coalesce((select count(*) from public.ticket_numbers t where t.category_id = c.id), 0));

-- 9. Nobody but the service role runs these -----------------------------------------------
revoke all on function public.reserve_order_inventory(text, uuid, jsonb, integer, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.confirm_order_inventory(text)           from public, anon, authenticated;
revoke all on function public.release_order_inventory(text)           from public, anon, authenticated;
revoke all on function public.void_ticket_number(text, uuid, integer) from public, anon, authenticated;
revoke all on function public.refresh_category_counts(uuid)           from public, anon, authenticated;
revoke all on function public.expire_stale_holds()                    from public, anon, authenticated;

-- These tables are only ever touched by the service role, never from the browser.
alter table public.ticket_numbers          enable row level security;
alter table public.inventory_reservations  enable row level security;
alter table public.event_staff             enable row level security;
alter table public.scan_log                enable row level security;

insert into public.app_schema_markers (name) values ('ticketing_integrity_v1')
  on conflict (name) do update set applied_at = now();

commit;
