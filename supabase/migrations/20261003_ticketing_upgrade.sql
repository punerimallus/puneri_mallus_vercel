-- Ticketing upgrade: group tickets, safe gate scanning, no duplicate ticket numbers.
-- Safe to run more than once. Every existing category and booking keeps working unchanged.

-- 1. Group tickets -----------------------------------------------------------------------
-- group_size = 1 is an ordinary ticket. 2 or more is ONE ticket (one QR code) that admits that
-- many people, who can enter together or in parts. The admin chooses the number per category.
alter table public.event_ticket_categories
  add column if not exists group_size integer not null default 1;

alter table public.event_ticket_categories
  drop constraint if exists event_ticket_categories_group_size_check;
alter table public.event_ticket_categories
  add constraint event_ticket_categories_group_size_check check (group_size between 1 and 50);

-- 2. Safe scanning -----------------------------------------------------------------------
-- Bumped on every gate scan. Two staff scanning the same pass at the same instant can't both
-- succeed: a scan only saves if nobody else changed the booking since it was read.
alter table public.ticket_bookings
  add column if not exists scan_version integer not null default 0;

-- 3. Ticket numbers can never repeat within an event --------------------------------------
-- Ticket numbers are built from the category prefix, so two categories with the same prefix
-- would issue the same number twice. (Checked beforehand: no duplicates exist today.)
create unique index if not exists event_ticket_categories_event_prefix_uq
  on public.event_ticket_categories (event_id, upper(prefix));
