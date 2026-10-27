-- A refunded ticket order gives its seats back.
--
-- Until now `event_ticket_categories.sold` only ever went up: a refund voided the passes but the seat stayed
-- "sold", so refunded seats could never be bought again. And because ticket numbers (VIP011, VIP012 ...) come from
-- `sold`, simply lowering it would hand out numbers that already exist.
--
-- So there are now two counters:
--   sold      stays the ticket-number sequence and only ever goes up.
--   released  goes up when a fully refunded order gives its seats back.
-- Seats in use = sold - released. Capacity checks (here and in the app) use that.
--
-- Safe to run more than once.

begin;

-- 1. Columns ------------------------------------------------------------------------------------------------
alter table public.event_ticket_categories
  add column if not exists released integer not null default 0;

alter table public.payment_orders
  add column if not exists seats_released   boolean not null default false,
  add column if not exists loyalty_reversed boolean not null default false;

-- 2. Reserving seats: capacity now counts seats in use, not everything ever sold ---------------------------------
create or replace function public.allocate_tickets(p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
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
       and (capacity is null
            or coalesce(sold, 0) - least(coalesce(released, 0), coalesce(sold, 0)) + (item->>'qty')::int <= capacity)
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
end $function$;

revoke all on function public.allocate_tickets(jsonb) from public, anon, authenticated;

-- 3. Giving seats back after a full refund: exactly once per order ----------------------------------------------
-- Locks the order, does nothing if it already released (a repeated refund event) or never took seats (refunded
-- before the passes were issued), otherwise frees the seats and flags the order, all in one transaction.
create or replace function public.release_order_seats(p_order_id text)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  ord       public.payment_orders%rowtype;
  alloc     jsonb;
  freed     integer := 0;
  give      integer;
begin
  select * into ord from public.payment_orders where razorpay_order_id = p_order_id for update;
  if not found or ord.seats_released or ord.allocated_tickets is null then
    return 0;
  end if;

  for alloc in select * from jsonb_array_elements(ord.allocated_tickets) loop
    update public.event_ticket_categories
       set released = coalesce(released, 0)
                      + least((alloc->>'qty')::int, coalesce(sold, 0) - coalesce(released, 0))
     where id::text = alloc->>'categoryId'
       and coalesce(sold, 0) - coalesce(released, 0) > 0;
    get diagnostics give = row_count;
    if give > 0 then freed := freed + (alloc->>'qty')::int; end if;
  end loop;

  update public.payment_orders set seats_released = true where razorpay_order_id = p_order_id;
  return freed;
end $function$;

revoke all on function public.release_order_seats(text) from public, anon, authenticated;

-- 4. One-time catch-up -----------------------------------------------------------------------------------------
-- Seats already refunded (and rows deleted by hand while testing) never came back, so the counters are too high.
-- Set `released` so that seats in use = the valid tickets that really exist. Ticket numbers keep going from `sold`.
-- Orders already refunded are marked as done so a repeated refund event cannot release or reverse them again.
update public.event_ticket_categories c
   set released = greatest(0, coalesce(c.sold, 0) - coalesce((
         select count(*)
           from public.ticket_bookings b
           cross join lateral jsonb_array_elements(b.tickets_data) t
          where b.event_id = c.event_id
            and b.status <> 'REFUNDED'
            and coalesce(t->>'status', '') <> 'REFUNDED'
            and t->>'categoryName' = c.name
       ), 0));

-- (Their points are left exactly as they are: only refunds from now on adjust points.)
update public.payment_orders
   set seats_released = true, loyalty_reversed = true
 where status = 'REFUNDED' and payment_type = 'EVENT_TICKET';

commit;
