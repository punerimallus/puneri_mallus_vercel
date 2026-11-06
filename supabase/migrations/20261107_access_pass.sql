-- Categories that exist only to be given away.
--
-- An ACCESS PASS is a comp with no seating category attached: the guest is let in and a
-- volunteer seats them wherever there is room. It still has to be a real category, because that
-- is where pass numbers and capacity come from — reserve_order_inventory knows nothing else.
--
-- But a real category at zero rupees would appear on the public booking page, and anyone could
-- help themselves to free tickets. Hence this flag: `active` stays true (the reservation refuses
-- an inactive category outright), and the booking page leaves comp_only rows out of the list
-- entirely — not even as "coming soon", because they are not coming, they are not for sale.
--
-- Safe to run more than once.

begin;

alter table public.event_ticket_categories
  add column if not exists comp_only boolean not null default false;

-- Finding "is there an access pass for this event yet" happens every time the comp form opens.
create index if not exists event_ticket_categories_comp_only_idx
  on public.event_ticket_categories (event_id)
  where comp_only;

insert into public.app_schema_markers (name) values ('access_pass_v1')
  on conflict (name) do update set applied_at = now();

commit;

-- Afterwards:
--   select column_name from information_schema.columns
--    where table_name = 'event_ticket_categories' and column_name = 'comp_only';  -- 1 row
--   select count(*) from public.event_ticket_categories where comp_only;          -- 0, correct
--   select name from public.app_schema_markers where name = 'access_pass_v1';     -- 1 row
