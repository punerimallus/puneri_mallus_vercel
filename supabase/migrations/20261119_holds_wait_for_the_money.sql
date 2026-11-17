-- A hold must not be taken away while the money might still be arriving.
--
-- ============================================================================================
-- Changes one function's WHERE clause. No table, booking, pass, seat or payment is touched.
-- A CONFIRMED reservation — anything paid for — remains unreachable by this code, as before.
-- Safe to run more than once.
-- ============================================================================================
--
-- Two real incidents, pulling in opposite directions:
--
--   17 Nov  A group checkout's payment failed and the buyer's browser never reported it (tab
--           closed). Eleven REGULAR seats stayed held long past the fifteen-minute expiry,
--           because the only things that reclaim them run on the next checkout or once a day.
--           Stock sat idle and the offer read sold out.
--
--   14 Nov  order_TzwewUnX87HTKb. A buyer PAID ₹1074.35. Her hold expired, something swept it,
--           and fulfilment then found the seats gone and auto-refunded her. She had done
--           nothing wrong and got no ticket.
--
-- Sweeping faster fixes the first and makes the second worse, so speed alone is not the answer.
-- What separates the two cases is whether money might still be in flight — and the ORDER says:
--
--   FAILED            Razorpay refused the payment. The seats go back FIVE MINUTES later —
--                     enough for a retry in the window still open in front of the buyer, and
--                     without waiting out the rest of the fifteen-minute hold.
--   no order row      the checkout never reached Razorpay. Nothing can arrive, so the seats go
--                     back as soon as the hold lapses.
--   anything else     CREATED, PROCESSING, PAID: a payment may be on its way, or may already
--                     have been captured with the webhook still to come. Leave it alone and
--                     let the reconcile job — which ASKS Razorpay before deciding — settle it.
--                     A backstop still applies so nothing can be held for ever.
--
-- The reconcile job fulfils before it sweeps, so by the time anything reaches the backstop it
-- has been checked against Razorpay repeatedly.

begin;

-- How long a hold whose payment might still land is left alone after it expires. Fifteen
-- minutes of hold plus this: long enough for a slow UPI collect and a missed webhook to be
-- picked up by reconcile, short enough that a dead checkout is not sitting on stock all night.
-- Raise it if you ever see a legitimate payment refunded for RESERVATION_EXPIRED.
create or replace function public.expire_stale_holds()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r         record;
  touched   integer := 0;
  -- How long after Razorpay refuses a payment the seats are kept, in case the buyer retries in
  -- the window that is still open in front of them. Raise it if you ever see somebody retry
  -- successfully and lose their seats.
  retry_grace interval := interval '5 minutes';
  -- Last resort for a checkout we can learn nothing about, so nothing is ever held for ever.
  backstop    interval := interval '30 minutes';
begin
  for r in
    select res.reservation_id
      from public.inventory_reservations res
      left join lateral (
        select o.status, o.updated_at
          from public.payment_orders o
         where o.reservation_id = res.reservation_id
         order by o.created_at desc
         limit 1
      ) ord on true
     where res.state = 'HELD'
       and (
         -- Razorpay REFUSED the payment. Five minutes for a retry, then the seats go back —
         -- without waiting out the rest of the fifteen-minute hold, which is what left eleven
         -- REGULAR seats idle for thirty-five minutes on 17 Nov.
         (ord.status = 'FAILED' and ord.updated_at < now() - retry_grace)
         -- The checkout never reached Razorpay, so nothing can arrive: release at expiry.
         or (ord.status is null and res.expires_at < now())
         -- Anything else — CREATED, PROCESSING, PAID — may still be paying. Left to reconcile,
         -- which asks Razorpay, with the backstop below so it cannot be held indefinitely.
         or res.expires_at < now() - backstop
       )
     order by res.reservation_id
     limit 500
  loop
    perform public.release_order_inventory(r.reservation_id);
    touched := touched + 1;
  end loop;
  return touched;
end $function$;

revoke all on function public.expire_stale_holds() from public, anon, authenticated;
grant execute on function public.expire_stale_holds() to service_role;

insert into public.app_schema_markers (name) values ('holds_wait_for_money_v1')
  on conflict (name) do update set applied_at = now();

commit;

-- Check — what the sweeper would take right now, and why:
--
--   select res.reservation_id, res.expires_at, ord.status as order_status,
--          case when ord.status = 'FAILED' and ord.updated_at < now() - interval '5 minutes'
--                    then 'releases: payment refused 5+ min ago'
--               when ord.status is null and res.expires_at < now()
--                    then 'releases: never reached Razorpay'
--               when res.expires_at < now() - interval '30 minutes'
--                    then 'releases: backstop'
--               else 'held: the money may still be coming' end as verdict
--     from public.inventory_reservations res
--     left join lateral (select o.status, o.updated_at from public.payment_orders o
--                         where o.reservation_id = res.reservation_id
--                         order by o.created_at desc limit 1) ord on true
--    where res.state = 'HELD';
