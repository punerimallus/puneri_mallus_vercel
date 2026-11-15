-- `ticket_bundles.sold` never counted a sale.
--
-- 20261115 wired refresh_bundle_counts() into release_order_inventory only, so the counter
-- moved when a checkout was ABANDONED and at no other time. A group ticket could be bought and
-- the offer still read "0 sold".
--
-- That is not only a wrong number on the admin card. bundlesLeft() is `max_bundles - sold`, and
-- that is what refuses a sale once a limited run is gone — so an offer capped at two units
-- could be sold an unlimited number of times, each buyer being promised something exclusive.
--
-- Fixed by refreshing wherever the set of seats carrying a bundle reference can change:
-- reserving (a unit goes out), voiding a seat (a unit may lose its last seat), and releasing
-- (already done).
--
-- Run AFTER 20261115_ticket_bundles.sql. Safe to run more than once.

begin;

-- 1. A trigger, so nothing has to remember ------------------------------------------------------
--
-- Chosen over editing every caller on purpose. The counter has now been wrong once because one
-- of four code paths forgot to update it; a trigger cannot forget. Per statement, not per row,
-- and it recounts only the bundles whose seats actually moved.
--
-- Two functions rather than one: a transition table only exists for the operation that declares
-- it, so a single body naming both new_rows and old_rows fails at runtime on either trigger.
create or replace function public.ticket_numbers_bundle_ins()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare b uuid;
begin
  for b in
    select distinct split_part(bundle_ref, ':', 1)::uuid
      from new_rows where bundle_ref is not null
  loop
    perform public.refresh_bundle_counts(b);
  end loop;
  return null;
end $function$;

create or replace function public.ticket_numbers_bundle_del()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare b uuid;
begin
  for b in
    select distinct split_part(bundle_ref, ':', 1)::uuid
      from old_rows where bundle_ref is not null
  loop
    perform public.refresh_bundle_counts(b);
  end loop;
  return null;
end $function$;

drop trigger if exists ticket_numbers_bundle_sync_ins on public.ticket_numbers;
create trigger ticket_numbers_bundle_sync_ins
  after insert on public.ticket_numbers
  referencing new table as new_rows
  for each statement execute function public.ticket_numbers_bundle_ins();

drop trigger if exists ticket_numbers_bundle_sync_del on public.ticket_numbers;
create trigger ticket_numbers_bundle_sync_del
  after delete on public.ticket_numbers
  referencing old table as old_rows
  for each statement execute function public.ticket_numbers_bundle_del();

-- 2. Put right what is already wrong ------------------------------------------------------------
-- Every existing offer recounted from the seats that actually carry its reference.
update public.ticket_bundles b
   set sold = (
     select count(distinct t.bundle_ref)
       from public.ticket_numbers t
      where t.bundle_ref like b.id::text || ':%'
   ),
   updated_at = now();

revoke all on function public.ticket_numbers_bundle_ins() from public, anon, authenticated;
revoke all on function public.ticket_numbers_bundle_del() from public, anon, authenticated;

insert into public.app_schema_markers (name) values ('bundle_sold_counter_v1')
on conflict (name) do nothing;

commit;

-- Check:
--   select name, sold, max_bundles from public.ticket_bundles;   -- sold matches reality
--   select name from public.app_schema_markers where name = 'bundle_sold_counter_v1';
