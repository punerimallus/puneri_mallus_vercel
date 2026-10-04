-- Group tickets: one ticket (one QR code) can admit several people.
-- group_size = 1 is an ordinary single-entry ticket, so every existing category is unchanged.
alter table public.event_ticket_categories
  add column if not exists group_size integer not null default 1;

alter table public.event_ticket_categories
  drop constraint if exists event_ticket_categories_group_size_check;
alter table public.event_ticket_categories
  add constraint event_ticket_categories_group_size_check check (group_size between 1 and 50);
