-- Fill in the seats behind group passes that were issued before the seats were recorded.
--
-- ============================================================================================
-- Additive and reversible in effect: it only ADDS a `groupSeats` array to passes that have none.
-- It never changes a pass number, a status, an admission count or a price, and it skips any
-- pass that already has the field. Safe to run more than once.
-- ============================================================================================
--
-- Why it is needed: a group of five is ONE pass numbered after the first of its five seats.
-- Which five was only ever recorded on ticket_numbers.bundle_ref, so the buyer's PDF showed a
-- single number for everything they paid for. New purchases record the list at fulfilment;
-- passes sold before that have nothing to print, and this reads it back off the seats.
--
-- The match is by lowest seat number: a bundle unit's seats share one bundle_ref, and the pass
-- was numbered after the lowest of them. That is how buildIssuedTickets numbered it, so it is
-- how the seats are found again.

-- ============================================================================================
-- PART A - DRY RUN. Read-only. Shows exactly which passes would gain a seat list.
-- ============================================================================================
with pass as (
  select b.id                                                          as booking_id,
         b.email,
         o.reservation_id,
         t.ord - 1                                                     as idx,
         t.v->>'ticketNumber'                                          as pass_no,
         regexp_replace(t.v->>'ticketNumber', '\d+$', '')              as prefix,
         length((regexp_match(t.v->>'ticketNumber', '(\d+)$'))[1])     as width,
         (((regexp_match(t.v->>'ticketNumber', '(\d+)$'))[1]))::int    as first_no,
         coalesce((t.v->>'groupSize')::int, 1)                         as admits
    from public.ticket_bookings b
    join public.payment_orders o on o.booking_id = b.id
    cross join lateral jsonb_array_elements(b.tickets_data) with ordinality t(v, ord)
   where coalesce((t.v->>'group')::boolean, false)
     and t.v->'groupSeats' is null
     and t.v->>'ticketNumber' ~ '\d+$'
),
units as (
  select tn.reservation_id,
         tn.bundle_ref,
         min(tn.number) as first_no,
         count(*)       as seats
    from public.ticket_numbers tn
   where tn.bundle_ref is not null
   group by tn.reservation_id, tn.bundle_ref
)
select p.email, p.pass_no, p.admits, u.seats as seats_found,
       p.prefix || lpad(u2.number::text, p.width, '0') as seat_numbers
  from pass p
  join units u on u.reservation_id = p.reservation_id and u.first_no = p.first_no
  cross join lateral (
    select tn.number from public.ticket_numbers tn
     where tn.reservation_id = p.reservation_id and tn.bundle_ref = u.bundle_ref
     order by tn.number
  ) u2
 order by p.email, p.pass_no, u2.number;

-- `seats_found` must equal `admits` on every row. If it does not, STOP: a seat has been voided
-- since the sale, and writing a shorter list would quietly tell the buyer they hold fewer seats
-- than they were sold. Decide that case by hand.


-- ============================================================================================
-- PART B - THE WRITE. One pass at a time, skipping anything that does not line up exactly.
-- ============================================================================================
do $backfill$
declare
  r       record;
  seats   jsonb;
  updated integer := 0;
  skipped integer := 0;
begin
  for r in
    with pass as (
      select b.id                                                       as booking_id,
             o.reservation_id,
             t.ord - 1                                                  as idx,
             t.v->>'ticketNumber'                                       as pass_no,
             regexp_replace(t.v->>'ticketNumber', '\d+$', '')           as prefix,
             length((regexp_match(t.v->>'ticketNumber', '(\d+)$'))[1])  as width,
             (((regexp_match(t.v->>'ticketNumber', '(\d+)$'))[1]))::int as first_no,
             coalesce((t.v->>'groupSize')::int, 1)                      as admits
        from public.ticket_bookings b
        join public.payment_orders o on o.booking_id = b.id
        cross join lateral jsonb_array_elements(b.tickets_data) with ordinality t(v, ord)
       where coalesce((t.v->>'group')::boolean, false)
         and t.v->'groupSeats' is null
         and t.v->>'ticketNumber' ~ '\d+$'
    ),
    units as (
      select tn.reservation_id, tn.bundle_ref, min(tn.number) as first_no, count(*) as seats
        from public.ticket_numbers tn
       where tn.bundle_ref is not null
       group by tn.reservation_id, tn.bundle_ref
    )
    select p.*, u.bundle_ref, u.seats
      from pass p
      join units u on u.reservation_id = p.reservation_id and u.first_no = p.first_no
  loop
    -- Only when the seats on record are exactly what the pass says it admits. A mismatch means
    -- something has happened to this booking since; it is left alone and counted.
    if r.seats <> r.admits then
      skipped := skipped + 1;
      continue;
    end if;

    select jsonb_agg(r.prefix || lpad(tn.number::text, r.width, '0') order by tn.number)
      into seats
      from public.ticket_numbers tn
     where tn.reservation_id = r.reservation_id and tn.bundle_ref = r.bundle_ref;

    update public.ticket_bookings
       set tickets_data = jsonb_set(tickets_data, array[r.idx::text, 'groupSeats'], seats, true)
     where id = r.booking_id
       -- Re-checked at write time: another process may have filled it in the meantime.
       -- idx comes back from WITH ORDINALITY as bigint, and jsonb has no -> for bigint.
       and tickets_data->(r.idx::int)->'groupSeats' is null;

    updated := updated + 1;
  end loop;

  raise notice 'group passes given their seat list: %', updated;
  raise notice 'left alone (seat count no longer matches the pass): %', skipped;
end
$backfill$;


-- ============================================================================================
-- PART C - CONFIRM. Every group pass should now carry as many seats as it admits.
-- ============================================================================================
select b.email,
       t.v->>'ticketNumber'                        as pass_no,
       (t.v->>'groupSize')::int                    as admits,
       jsonb_array_length(coalesce(t.v->'groupSeats', '[]'::jsonb)) as seats_listed,
       t.v->'groupSeats'                           as seats,
       jsonb_array_length(coalesce(t.v->'groupSeats', '[]'::jsonb)) = (t.v->>'groupSize')::int as ok
  from public.ticket_bookings b
  cross join lateral jsonb_array_elements(b.tickets_data) t(v)
 where coalesce((t.v->>'group')::boolean, false)
 order by b.email, pass_no;

-- Afterwards, resend the passes from the box office for anyone whose PDF you want corrected:
-- the attachment is rebuilt from tickets_data each time, so a resend is all it takes.
