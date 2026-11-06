-- Reset ticketing to a clean slate, so a fresh booking test starts from zero.
--
-- Run it in the Supabase SQL editor with "Run without RLS" (the privileged role), as one block.
-- It is wrapped in a transaction: if any statement fails, nothing is applied.
--
-- WHAT IT REMOVES  (all of it is test data)
--   ticket_bookings              every booking, sold and complimentary alike
--   comp_ticket_grants           the register of who was given free passes
--   scan_log                     the admission history for those bookings
--   payment_orders               EVENT_TICKET orders only
--   ticket_numbers               every seat held
--   inventory_reservations       every reservation
--   category counters            back to 0 sold / 0 issued
--
-- WHAT IT DELIBERATELY KEEPS  -- read this before editing the script
--   payments              The financial ledger. It holds football registrations and membership
--                         sales -- real money, nothing to do with ticketing. Event tickets only
--                         started reaching this table with the current change, so there is
--                         nothing of yours to clean out of it.
--   payment_webhook_events  The de-duplication record of every webhook Razorpay has sent. With
--                         the orders gone, a replayed refund event would find no matching order
--                         and raise, so Razorpay would retry it indefinitely and keep alerting
--                         you. These rows are what stop that. Leave them.
--   payment_orders (LIFETIME / MART), memberships, profiles  -- untouched.
--   event_ticket_categories  The categories themselves survive; only their counters are reset
--                         (step 4). That includes the comp-only ACCESS PASS, which is what you
--                         want -- it keeps its capacity and its comp_only flag, and comes back
--                         with every seat available, so there is nothing to re-create by hand.
--
-- TO CONFIRM THE COMPS AFTERWARDS, if you want it in the result grid rather than the notice:
--   select count(*) from public.comp_ticket_grants;                              -- 0
--   select name, sold, comp_only from public.event_ticket_categories
--    where comp_only;                                        -- ACCESS PASS, 0, true

begin;

-- 1. What is about to go -----------------------------------------------------------------
select 'ticket_bookings'        as table_name, count(*) as rows from public.ticket_bookings
union all
select 'payment_orders (ticket)', count(*) from public.payment_orders where payment_type = 'EVENT_TICKET'
union all
select 'ticket_numbers',          count(*) from public.ticket_numbers
union all
select 'inventory_reservations',  count(*) from public.inventory_reservations;

-- 2. Seats and reservations ---------------------------------------------------------------
-- Reservations and ticket numbers only ever exist for event tickets, so clearing them wholesale
-- is safe. Deleting a reservation cascades to its ticket_numbers; both are listed anyway so the
-- intent is explicit and orphans left by earlier hand-deletes are swept up too.
delete from public.ticket_numbers;
delete from public.inventory_reservations;

-- 3. Orders and bookings --------------------------------------------------------------------
-- Only EVENT_TICKET orders. Membership and Mart orders are a different product and stay.
delete from public.payment_orders where payment_type = 'EVENT_TICKET';

-- Complimentary grants first, then the bookings they hang off.
--
-- comp_ticket_grants.booking_id cascades, so deleting the bookings alone would already take
-- these with them. It is spelled out anyway for two reasons: a reader of this script should not
-- have to go and look up a foreign key to find out the VIP guest list is about to be erased,
-- and if that cascade is ever tightened to RESTRICT the booking delete below would start
-- failing and roll the whole reset back. Deleting in this order never depends on it.
--
-- Wrapped in a DO block because this script also has to run on a database that predates the
-- comp migration: a bare `delete from public.comp_ticket_grants` naming a table that does not
-- exist fails when the statement is PARSED, before any branch could skip it. The notice prints
-- how many were removed, since the verification query at the end cannot reference the table
-- for the same reason.
do $$
declare
  n integer := 0;
begin
  if to_regclass('public.comp_ticket_grants') is not null then
    delete from public.comp_ticket_grants;
    get diagnostics n = row_count;
    raise notice 'comp_ticket_grants: % complimentary grant(s) removed', n;
  else
    raise notice 'comp_ticket_grants: table not present, nothing to remove';
  end if;
end $$;

delete from public.ticket_bookings;

-- 3b. The admission history ------------------------------------------------------------
-- scan_log records who admitted whom. It is an audit trail, so it is removed deliberately and
-- separately rather than quietly: with the bookings gone its rows point at nothing, and leaving
-- them means a future "who scanned what" query returns test noise mixed with real admissions.
--
-- Comment this out if you want to keep a record of the test scans.
delete from public.scan_log;

-- 4. Counters ---------------------------------------------------------------------------
-- `sold` means "seats in use" and `released` is pinned at 0 by design. `issued_total` is the
-- monotonic "has this category ever issued a pass" marker, which a fresh start resets too.
update public.event_ticket_categories
   set sold = 0, released = 0, issued_total = 0;

-- 5. Loyalty points --------------------------------------------------------------------
-- Points earned by test purchases are spendable against a real sale, and `loyalty_points_held`
-- MUST be cleared: the reservations that were holding those points have just been deleted, so
-- nothing is left to release them and the balance would stay locked forever.
--
-- Clearing the held column is required. Zeroing the balances is a choice -- comment the first
-- line out if you would rather keep what people have earned.
update public.profiles set loyalty_points = 0       where loyalty_points > 0;
update public.profiles set loyalty_points_held = 0  where loyalty_points_held > 0;

-- 6. Confirm, then commit --------------------------------------------------------------
select
  (select count(*) from public.ticket_bookings)                                    as bookings,
  (select count(*) from public.payment_orders where payment_type = 'EVENT_TICKET') as ticket_orders,
  (select count(*) from public.ticket_numbers)                                     as seats_held,
  (select count(*) from public.inventory_reservations)                             as reservations,
  (select coalesce(sum(sold), 0) from public.event_ticket_categories)              as total_sold,
  (select count(*) from public.payments)                                           as ledger_kept,
  (select count(*) from public.scan_log)                                           as scans,
  (select count(*) from public.payment_webhook_events)                             as webhook_dedupe_kept;

commit;
