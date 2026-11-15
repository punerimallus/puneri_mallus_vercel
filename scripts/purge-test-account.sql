-- Remove one TEST account's ticketing records. Scoped to a single account id, on purpose.
--
-- ============================================================================================
-- READ THIS BEFORE RUNNING. Tickets are on sale; this deletes from live tables.
-- ============================================================================================
--
-- Two things make a "just delete the test rows" script dangerous, and both are handled here:
--
--   1. DELETING SEATS WITHOUT RECOUNTING withholds stock. `event_ticket_categories.sold` is a
--      cached number, not a count. Deleting from ticket_numbers by hand leaves `sold` high and
--      the site then hides seats nobody holds — exactly the 10-seat drift found on REGULAR on
--      2026-11-14. Part 5 recounts every category this touched. Do not remove it.
--
--   2. MATCHING ON "email OR phone" CAN HIT THE WRONG ACCOUNT. On this database
--      rohitanish86@gmail.com and +918669865623 are TWO DIFFERENT USERS:
--
--        516ae46d-8b08-4bb8-95c8-1bce70721f29   rohitanish86@gmail.com     (no profile, no data)
--        cb2936df-bbc2-4c52-90e3-05ef8a1301d6   rohitanish8626@gmail.com   +918669865623
--
--      So this takes ONE account id and refuses to guess. Change it in the one place marked
--      `acct uuid :=` inside the DO block, and in the dry run above it.
--
-- Run PART A first and read what it prints. Nothing is deleted until you run PART B.

-- ============================================================================================
-- PART A — DRY RUN. Read-only. Shows exactly what PART B would remove.
-- ============================================================================================
with acct as (select 'cb2936df-bbc2-4c52-90e3-05ef8a1301d6'::uuid as id)
select 'ticket_bookings'        as table_name, count(*) as rows_to_delete from public.ticket_bookings        where user_id = (select id from acct)
union all select 'ticket_numbers',         count(*) from public.ticket_numbers         where user_id = (select id from acct)
union all select 'inventory_reservations', count(*) from public.inventory_reservations where user_id = (select id from acct)
union all select 'coupon_redemptions',     count(*) from public.coupon_redemptions     where user_id = (select id from acct)
union all select 'payment_orders',         count(*) from public.payment_orders         where user_id = (select id from acct)
union all select 'payments',               count(*) from public.payments               where user_id = (select id from acct)
union all select 'scan_log (via booking)', count(*) from public.scan_log s
            where s.booking_id in (select id from public.ticket_bookings where user_id = (select id from acct))
order by table_name;

-- The money trail. If either number is above zero, STOP and decide deliberately: these rows are
-- the record that a real charge happened, and deleting them cannot be undone from here.
with acct as (select 'cb2936df-bbc2-4c52-90e3-05ef8a1301d6'::uuid as id)
select count(*) filter (where status = 'SUCCESS')                  as successful_payments,
       count(*) filter (where status in ('FULFILLED','REFUNDED'))  as settled_orders
  from (
    select status from public.payments       where user_id = (select id from acct)
    union all
    select status from public.payment_orders where user_id = (select id from acct)
  ) x;

-- The passes themselves, so you can see what would be destroyed.
with acct as (select 'cb2936df-bbc2-4c52-90e3-05ef8a1301d6'::uuid as id)
select b.id, b.email, b.status, b.created_at,
       (select string_agg(t->>'ticketNumber', ', ' order by t->>'ticketNumber')
          from jsonb_array_elements(b.tickets_data) t) as pass_numbers
  from public.ticket_bookings b
 where b.user_id = (select id from acct)
 order by b.created_at;


-- ============================================================================================
-- PART B — THE DELETE. One DO block, so it is all-or-nothing.
--
-- `keep_money` is the safety: left true, the payment and order rows survive and only the
-- ticketing is removed. Set it to false only when you are sure the charges were test charges.
-- ============================================================================================
do $purge$
declare
  acct       uuid    := 'cb2936df-bbc2-4c52-90e3-05ef8a1301d6';
  keep_money boolean := true;
  cats       uuid[];
  c          uuid;
  n          integer;
begin
  -- Which categories lose seats, read BEFORE the seats go so they can be recounted after.
  select coalesce(array_agg(distinct category_id), '{}') into cats
    from public.ticket_numbers where user_id = acct;

  -- 1. Gate records, which hang off the bookings.
  delete from public.scan_log
   where booking_id in (select id from public.ticket_bookings where user_id = acct);

  -- 2. Coupon claims, and the count that goes with them.
  --
  --    `coupons.uses` is a cached count of coupon_redemptions, exactly as `sold` is a cached
  --    count of seats. Deleting the rows without recounting leaves a coupon reading "used up"
  --    with no record of anybody using it — burnt, and impossible to put right from the admin
  --    screen. Recounted below rather than decremented, so it comes out right however the rows
  --    went away.
  delete from public.coupon_redemptions where user_id = acct;
  get diagnostics n = row_count;
  raise notice 'coupon claims removed: %', n;

  -- 3. Seats, bookings, reservations.
  delete from public.ticket_numbers where user_id = acct;
  get diagnostics n = row_count;
  raise notice 'seats removed: %', n;

  delete from public.ticket_bookings where user_id = acct;
  get diagnostics n = row_count;
  raise notice 'bookings removed: %', n;

  delete from public.inventory_reservations where user_id = acct;

  -- 4. The money trail, only if explicitly asked for.
  if not keep_money then
    delete from public.payment_orders where user_id = acct;
    delete from public.payments      where user_id = acct;
    raise notice 'payment records removed';
  else
    raise notice 'payment records KEPT (keep_money = true)';
  end if;

  -- 5. Put the seats back on sale. NOT OPTIONAL. refresh_category_counts recounts `sold` from
  --    the rows that actually remain, which is the only thing standing between a hand-deletion
  --    and silently withheld stock.
  foreach c in array cats loop
    perform public.refresh_category_counts(c);
  end loop;
  raise notice 'categories recounted: %', coalesce(array_length(cats, 1), 0);

  -- 5b. And put the coupons right, for the same reason. Every code recounted from the claims
  --     that actually remain, so one whose only claim was this test account is usable again.
  update public.coupons c
     set uses = (select count(*) from public.coupon_redemptions r where r.coupon_id = c.id),
         updated_at = now()
   where c.uses <> (select count(*) from public.coupon_redemptions r where r.coupon_id = c.id);
  get diagnostics n = row_count;
  raise notice 'coupons recounted: %', n;

  -- 6. Loyalty: the account must not keep points earned by deleted orders, nor be left holding
  --    points against reservations that no longer exist.
  update public.profiles set loyalty_points = 0, loyalty_points_held = 0 where id = acct;
end
$purge$;


-- ============================================================================================
-- PART C — CONFIRM. Every row of both must read ok = true.
-- ============================================================================================
select c.name, c.sold,
       (select count(*) from public.ticket_numbers t where t.category_id = c.id) as actual_seats,
       c.sold = (select count(*) from public.ticket_numbers t where t.category_id = c.id) as ok
  from public.event_ticket_categories c
 order by c.name;

select c.code, c.uses,
       (select count(*) from public.coupon_redemptions r where r.coupon_id = c.id) as actual_claims,
       c.uses = (select count(*) from public.coupon_redemptions r where r.coupon_id = c.id) as ok
  from public.coupons c
 order by c.code;
