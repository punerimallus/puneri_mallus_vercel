-- A cancelled ticket's number goes back into the pool: the next buyer gets the lowest number nobody holds.
--
-- Example: VIP001..VIP005 are sold and VIP005 is refunded. The next ticket is VIP005 again.
-- If VIP002 is refunded instead, the next ticket is VIP002 (never VIP006, never a duplicate of a number still in use).
--
-- How it stays safe:
--   * A number counts as "held" while the order that took it has not been refunded (orders flag `seats_released`
--     when a full refund frees them). Refunded numbers are free; everything else is held.
--   * The chosen numbers are written onto the order INSIDE the same transaction that picks them, and the category
--     row is locked while it happens, so two buyers at the same moment can never be handed the same number.
--   * Orders from before this change only stored `endSold` + `qty`; their numbers are read as that range, which is
--     exactly how they were issued. Nothing already sold changes.
--   * A refunded booking's QR code stays dead: scanning looks the ticket up in its own booking, which is REFUNDED,
--     so the new holder of the same number is unaffected and the old holder cannot get in.
--
-- Run AFTER 20261024_seat_release.sql. Safe to run more than once.

begin;

-- The old one-argument version has to go: keeping both would make calls ambiguous.
drop function if exists public.allocate_tickets(jsonb);

create or replace function public.allocate_tickets(p_items jsonb, p_order_id text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  item      jsonb;
  qty       integer;
  new_sold  integer;
  cat_name  text;
  held      integer[];
  nums      integer[];
  result    jsonb := '[]'::jsonb;
begin
  for item in select * from jsonb_array_elements(p_items) loop
    qty := (item->>'qty')::int;

    -- Takes the seats and locks this category's row until the transaction ends.
    update public.event_ticket_categories
       set sold = coalesce(sold, 0) + qty
     where id::text = item->>'categoryId'
       and (capacity is null
            or coalesce(sold, 0) - least(coalesce(released, 0), coalesce(sold, 0)) + qty <= capacity)
    returning sold into new_sold;

    if new_sold is null then
      select name into cat_name from public.event_ticket_categories where id::text = item->>'categoryId';
      raise exception 'SOLD_OUT:%', coalesce(cat_name, item->>'categoryId');
    end if;

    -- Numbers held right now by this category: every order that took seats and has not given them back.
    select coalesce(array_agg(distinct n), '{}') into held
      from (
        -- orders that recorded their exact numbers
        select nt::int as n
          from public.payment_orders o
          cross join lateral jsonb_array_elements(o.allocated_tickets) a
          cross join lateral jsonb_array_elements_text(a->'numbers') nt
         where not coalesce(o.seats_released, false)
           and a->>'categoryId' = item->>'categoryId'
           and a ? 'numbers'
        union
        -- older orders: numbers are the range ending at endSold
        select g as n
          from public.payment_orders o
          cross join lateral jsonb_array_elements(o.allocated_tickets) a
          cross join lateral generate_series((a->>'endSold')::int - (a->>'qty')::int + 1, (a->>'endSold')::int) g
         where not coalesce(o.seats_released, false)
           and a->>'categoryId' = item->>'categoryId'
           and not (a ? 'numbers')
      ) s;

    -- The `qty` lowest positive numbers that are not held.
    select array_agg(g order by g) into nums
      from (
        select g
          from generate_series(1, coalesce((select max(x) from unnest(held) x), 0) + qty) g
         where g <> all (held)
         order by g
         limit qty
      ) free;

    result := result || jsonb_build_object(
      'categoryId', item->>'categoryId',
      'qty', qty,
      'endSold', new_sold,
      'numbers', to_jsonb(nums)
    );
    new_sold := null;
  end loop;

  -- Saved with the order in the same transaction, so the numbers count as held from this instant.
  if p_order_id is not null then
    update public.payment_orders set allocated_tickets = result where razorpay_order_id = p_order_id;
  end if;

  return result;
end $function$;

revoke all on function public.allocate_tickets(jsonb, text) from public, anon, authenticated;

-- Tidy-up for orders whose booking row was deleted by hand: those tickets no longer exist, and the seat catch-up in
-- 20261024 already counted their seats as free, so let their numbers go back into the pool too.
update public.payment_orders o
   set seats_released = true
 where o.payment_type = 'EVENT_TICKET'
   and o.status = 'FULFILLED'
   and not coalesce(o.seats_released, false)
   and not exists (select 1 from public.ticket_bookings b where b.id = o.booking_id);

commit;
