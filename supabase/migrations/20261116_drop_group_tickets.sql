-- Removes the group-ticket model.
--
-- A category could carry a group_size, which made ONE ticket (one QR) admit that many people,
-- arriving together or in parts. It was never bought: at the time this ran, two categories were
-- configured that way, both on old events, with zero seats sold and zero passes issued against
-- them anywhere.
--
-- What replaced it is a bundle (20261115): a price for several seats, each of which is an
-- ordinary numbered pass with its own QR. The gate needs no special case, friends can arrive
-- separately, and one seat out of five can be refunded without touching the other four.
--
-- Run this AFTER 20261115_ticket_bundles.sql, which drops the only function that read the
-- column. Safe to run more than once.

begin;

-- 1. Refuse to run if a group pass was ever actually issued ----------------------------------
--
-- The check is the point of doing this as a migration rather than a column drop typed into a
-- console: if this ever stops being true, the right answer is to stop, not to drop a column
-- somebody's ticket depends on.
do $do$
declare
  issued integer;
begin
  select count(*) into issued
    from public.ticket_bookings b
   where exists (
     select 1 from jsonb_array_elements(b.tickets_data) t
      where coalesce((t->>'groupSize')::int, 1) > 1
   );
  if issued > 0 then
    raise exception 'GROUP_PASSES_EXIST: % bookings hold a group pass. Do not drop group_size.', issued;
  end if;
end
$do$;

-- 2. Any category still configured as a group becomes an ordinary one ------------------------
--
-- Its capacity already counts seats, not groups (that was always how the column worked), so
-- nothing about its stock changes. Only the "one QR admits five" behaviour goes.
--
-- Guarded on the column existing, not on `if exists` in the statement: plpgsql plans the whole
-- block, so a bare update naming a dropped column fails to parse on a second run even though
-- it would match no rows.
do $do$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'event_ticket_categories'
       and column_name = 'group_size'
  ) then
    execute 'update public.event_ticket_categories set group_size = 1 where coalesce(group_size, 1) <> 1';
  end if;
end
$do$;

-- 3. The column itself -----------------------------------------------------------------------
alter table public.event_ticket_categories
  drop column if exists group_size;

-- 4. Passes already issued -------------------------------------------------------------------
--
-- tickets_data is jsonb, so an old pass may carry a groupSize of 1 written by the code that has
-- just been removed. Harmless — the gate no longer reads it — but tidied so nothing later
-- mistakes it for a live field.
update public.ticket_bookings
   set tickets_data = (
     select jsonb_agg(t - 'groupSize')
       from jsonb_array_elements(tickets_data) t
   )
 where tickets_data is not null
   and jsonb_typeof(tickets_data) = 'array'
   and exists (
     select 1 from jsonb_array_elements(tickets_data) t where t ? 'groupSize'
   );

insert into public.app_schema_markers (name) values ('group_tickets_removed_v1')
on conflict (name) do nothing;

commit;

-- Check:
--   select name from public.app_schema_markers where name = 'group_tickets_removed_v1';  -- 1 row
--   select column_name from information_schema.columns
--    where table_name = 'event_ticket_categories' and column_name = 'group_size';        -- 0 rows
