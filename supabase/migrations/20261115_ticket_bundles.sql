-- Bundles: buy several seats of an existing category in one go, at a bundle price.
--
-- The model this replaces kept a separate category with its own stock ("GENERAL GROUP",
-- capacity 20, one QR admitting five). Two pools that could not rebalance, a pass with no
-- sensible number to print, and a gate that had to let a group in piecemeal when friends
-- arrived separately. Nothing ever sold through it.
--
-- A bundle here is a PURCHASE OPTION, not a ticket type. "Squad of 5" on REGULAR takes five
-- REGULAR seats out of the one REGULAR pool and issues five ordinary REGULAR passes, numbered
-- REGULAR-053 to REGULAR-057 like any other. The gate needs no special case, each person can
-- arrive alone with their own QR, and one of the five can be refunded without touching the
-- other four. That is also what the big ticketing sites do: a group booking is a bundle price,
-- not a bundle ticket.
--
-- Safe to run more than once.

begin;

-- 1. The offers --------------------------------------------------------------------------------
create table if not exists public.ticket_bundles (
  id          uuid primary key default gen_random_uuid(),
  event_id    text not null,
  -- The category the seats come out of. Deleting it takes its bundles with it, because a
  -- bundle with no pool to draw from cannot be sold.
  category_id uuid not null references public.event_ticket_categories (id) on delete cascade,
  name        text not null check (length(btrim(name)) between 2 and 40),
  -- How many seats one bundle takes. Two is the smallest thing worth calling a bundle.
  size        integer not null check (size between 2 and 50),
  -- What the whole bundle costs. Not per seat: the saving is the point, and deriving it from a
  -- per-seat figure would round oddly at the sizes people actually use.
  price       numeric(10, 2) not null check (price >= 0),
  -- How many of these bundles exist at all, on top of the category's own capacity. Null means
  -- "as many as the category can supply". Whichever runs out first stops the sale.
  max_bundles integer check (max_bundles is null or max_bundles >= 1),
  sold        integer not null default 0 check (sold >= 0),
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists ticket_bundles_event_idx on public.ticket_bundles (event_id) where active;
create index if not exists ticket_bundles_category_idx on public.ticket_bundles (category_id);

-- 2. Marking the seats a bundle took -------------------------------------------------------------
-- One value per bundle UNIT bought, not per offer: somebody buying two Squads of 5 gets two
-- different refs across their ten seats. That is what lets the per-account bundle allowance be
-- counted exactly, and what lets a pass say which bundle it came from.
alter table public.ticket_numbers
  add column if not exists bundle_ref text;

-- A seat given away by a coupon.
--
-- Marked on the seat, not inferred from the cart, because the per-account allowance is counted
-- in the database over rows that are already there — a flag that lived only in the application
-- would be gone by the time the next checkout counted them. A gift is not something the buyer
-- chose, so it does not spend their allowance; see the limit check below.
alter table public.ticket_numbers
  add column if not exists free_pass boolean not null default false;

create index if not exists ticket_numbers_bundle_idx
  on public.ticket_numbers (bundle_ref) where bundle_ref is not null;

-- 3. Reserving, now aware of bundles ---------------------------------------------------------------
-- Changed from the version in 20261028 in three ways and no others:
--   * an item may carry `bundleRef`, which is written onto the rows it creates
--   * the single-pass allowance counts only seats with no bundleRef
--   * a separate allowance caps how many bundle UNITS one account may hold
--
-- p_max_group stays in the signature although nothing reads it any more. Supabase RPC resolves
-- by ARGUMENT NAME, so dropping it would mean the deployed code (which sends p_max_group) and
-- this function could not both exist: migrate first and every live checkout fails with
-- "function not found"; deploy first and it fails the same way until the migration lands.
-- Either order is an outage, and tickets are on sale. Accepting both names makes the migration
-- and the deploy independent, in any order, with no window. A later migration drops the
-- parameter once nothing sends it.
--
-- Everything else — the locking order, the lowest-free-number allocation, the capacity check,
-- the points — is unchanged, because it was already right.
-- Dropped first, deliberately. "create or replace function" matches on the argument list, so
-- changing a parameter creates an OVERLOAD rather than replacing anything: the old version
-- would survive and existing calls would keep hitting it, bundle-blind and counting bundle
-- seats against the single-pass cap. Once it is gone every call resolves to the new one.
drop function if exists public.reserve_order_inventory(text, uuid, jsonb, integer, integer, integer, integer);

create or replace function public.reserve_order_inventory(
  p_reservation_id text,
  p_user_id        uuid,
  p_items          jsonb,
  p_points         integer default 0,
  p_ttl_seconds    integer default 900,
  p_max_single     integer default 7,
  -- Vestigial. Kept only so a call from the previous deploy still resolves; see above.
  p_max_group      integer default 2,
  p_max_bundles    integer default 2
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
  bundles   integer;
  available integer;
  b_ref     text;
  is_free   boolean;
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

  -- Everything this buyer does is serialised on their own profile row, so two tabs cannot both
  -- slip past the per-account limits or spend the same points.
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
    b_ref := nullif(item->>'bundleRef', '');
    is_free := coalesce((item->>'free')::boolean, false);

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

    insert into public.ticket_numbers (category_id, number, reservation_id, user_id, state, bundle_ref, free_pass)
    select cat.id, n, p_reservation_id, p_user_id, 'HELD', b_ref, is_free from unnest(nums) n;

    update public.event_ticket_categories
       set sold = in_use + qty, released = 0, issued_total = issued_total + qty
     where id = cat.id;

    result := result || jsonb_build_object(
      'categoryId', cat.id,
      'qty',        qty,
      'numbers',    to_jsonb(nums),
      'endSold',    in_use + qty,
      'bundleRef',  b_ref
    );
  end loop;

  if jsonb_array_length(result) = 0 then
    raise exception 'EMPTY_CART';
  end if;

  -- Per-account limits, counted over everything this account holds for this event.
  --
  -- Two things are excluded from the seven-pass allowance, both for the same reason: it caps
  -- what a buyer may BUY, and neither of these was bought one seat at a time.
  --   * bundle seats — a Squad of 5 is one decision, not five, and charging it against the cap
  --     would make a second squad impossible for no good reason
  --   * free seats — a pass the organiser gave away is not the buyer spending their allowance,
  --     and refusing an order because a GIFT pushed it over is the wrong answer
  if p_user_id is not null and ev is not null then
    select count(*) filter (where t.bundle_ref is null and not t.free_pass),
           count(distinct t.bundle_ref) filter (where t.bundle_ref is not null)
      into singles, bundles
      from public.ticket_numbers t
      join public.event_ticket_categories c on c.id = t.category_id
     where t.user_id = p_user_id and c.event_id = ev;

    if singles > p_max_single then
      raise exception 'LIMIT_SINGLE:%', p_max_single;
    end if;
    if p_max_bundles is not null and bundles > p_max_bundles then
      raise exception 'LIMIT_BUNDLES:%', p_max_bundles;
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

-- 4. Keeping the bundle's own counter honest -------------------------------------------------------
-- `sold` on a bundle is how many units are out, derived from the distinct refs its seats carry.
create or replace function public.refresh_bundle_counts(p_bundle_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  live integer;
begin
  select count(distinct t.bundle_ref) into live
    from public.ticket_numbers t
   where t.bundle_ref like p_bundle_id::text || ':%';
  update public.ticket_bundles set sold = live, updated_at = now() where id = p_bundle_id;
  return live;
end $function$;

-- 5. Releasing gives the bundle units back as well -------------------------------------------------
-- Redefined once more on top of the coupon migration. Every "give it back" path funnels through
-- here, so this is the one place that has to remember seats, points, the coupon AND the bundle
-- counters rather than a dozen call sites each remembering a different subset.
create or replace function public.release_order_inventory(p_reservation_id text)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  res   public.inventory_reservations%rowtype;
  cats  uuid[];
  bids  uuid[];
  c     uuid;
  b     uuid;
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

  -- The bundles these seats belonged to, read before the rows go.
  select coalesce(array_agg(distinct split_part(bundle_ref, ':', 1)::uuid), '{}') into bids
    from public.ticket_numbers
   where reservation_id = p_reservation_id and bundle_ref is not null;

  delete from public.ticket_numbers where reservation_id = p_reservation_id;
  get diagnostics freed = row_count;

  foreach c in array cats loop
    perform public.refresh_category_counts(c);
  end loop;
  foreach b in array bids loop
    perform public.refresh_bundle_counts(b);
  end loop;

  if res.points_held > 0 and res.user_id is not null then
    if res.state = 'CONFIRMED' then
      update public.profiles
         set loyalty_points = coalesce(loyalty_points, 0) + res.points_held
       where id = res.user_id;
    else
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

alter table public.ticket_bundles enable row level security;
revoke all on table public.ticket_bundles from anon, authenticated;
revoke all on function public.refresh_bundle_counts(uuid) from public, anon, authenticated;

-- The booking page reads bundles with the anon key, the same way it reads categories.
drop policy if exists "bundles are public to read" on public.ticket_bundles;
create policy "bundles are public to read" on public.ticket_bundles for select to anon, authenticated using (true);
grant select on table public.ticket_bundles to anon, authenticated;

insert into public.app_schema_markers (name) values ('ticket_bundles_v1')
  on conflict (name) do update set applied_at = now();

commit;

-- Afterwards:
--   select name from public.app_schema_markers where name = 'ticket_bundles_v1';   -- 1 row
--   select count(*) from public.ticket_bundles;                                    -- 0, nothing seeded
--   select count(*) from public.ticket_numbers where bundle_ref is not null;       -- 0
