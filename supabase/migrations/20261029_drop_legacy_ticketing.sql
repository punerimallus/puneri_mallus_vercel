-- Drop the legacy ticketing machinery.
--
-- The reservation system in 20261028 kept two kinds of compatibility, both only needed while
-- passes issued by the old code were still in circulation:
--
--   * `allocate_tickets` and `release_order_seats`, the pre-reservation allocator and seat
--     release. Nothing calls them any more, but while they exist a stale deployment could,
--     and that would move `event_ticket_categories.sold` without creating the matching
--     `ticket_numbers` rows — exactly the drift the reservation system exists to prevent.
--
--   * the `legacy-<booking id>` reservations the backfill created, so passes printed before the
--     change kept their numbers.
--
-- Ticketing is still pre-launch: every booking is a test, and nothing real is in circulation.
-- So the compatibility is dead weight, and dead weight around money is a liability.
--
-- RUN THIS AFTER deploying the code that stops calling them, and ideally after
-- scripts/reset-ticketing.sql. Safe to run more than once.

begin;

-- 1. The old allocator and seat release -----------------------------------------------------
-- Both signatures: 20261024 created allocate_tickets(jsonb) and 20261025 replaced it with
-- allocate_tickets(jsonb, text).
drop function if exists public.allocate_tickets(jsonb);
drop function if exists public.allocate_tickets(jsonb, text);
drop function if exists public.release_order_seats(text);

-- 2. The backfill's legacy reservations ------------------------------------------------------
-- Deleting a reservation cascades to its ticket_numbers, so this also frees any numbers those
-- old test passes were holding. Orders that pointed at them are left with a dangling
-- reservation_id, which is harmless: the orders themselves are test rows being cleared anyway,
-- and fulfilment treats a missing reservation as "cannot deliver" rather than guessing.
update public.payment_orders
   set reservation_id = null
 where reservation_id like 'legacy-%';

delete from public.inventory_reservations
 where reservation_id like 'legacy-%';

-- 3. Counters back in step with the rows that remain -----------------------------------------
update public.event_ticket_categories c
   set sold     = coalesce((select count(*) from public.ticket_numbers t where t.category_id = c.id), 0),
       released = 0;

-- 4. Record it -------------------------------------------------------------------------------
insert into public.app_schema_markers (name) values ('legacy_ticketing_dropped')
  on conflict (name) do update set applied_at = now();

commit;

-- Afterwards these should all be empty / zero:
--   select proname from pg_proc where proname in ('allocate_tickets','release_order_seats');
--   select count(*) from inventory_reservations where reservation_id like 'legacy-%';
