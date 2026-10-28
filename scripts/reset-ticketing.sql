-- Reset ticketing to a clean slate, so a fresh booking test starts from zero.
--
-- Run it in the Supabase SQL editor with "Run without RLS" (the privileged role), as one block.
-- It is wrapped in a transaction: if any statement fails, nothing is applied.
--
-- WHAT IT REMOVES  (all of it is test data)
--   ticket_bookings              every booking
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
