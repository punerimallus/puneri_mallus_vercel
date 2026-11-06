-- Complimentary passes: tickets an admin gives away (VIPs, artists, sponsors, crew).
--
-- The pass itself stays in ticket_bookings, alongside every sold pass. That is the whole point:
-- the gate scanner, the signed QR, the PDF, the void button and the attendance counters already
-- read that table, and a parallel "free tickets" table would mean two code paths at the door —
-- with the untested one carrying the guest who matters most.
--
-- What is added:
--   1. ticket_bookings.source       'SALE' (bought) or 'COMP' (given), so free seats are countable
--   2. ticket_bookings.issued_by    which admin handed it over
--   3. comp_ticket_grants           the register: who got it, why, and what it would have cost
--
-- Seats and pass numbers still come from reserve_order_inventory, so a comp cannot oversell a
-- category and cannot collide with a number someone paid for.
--
-- Safe to run more than once.

begin;

-- 1. Mark the booking -------------------------------------------------------------------------
-- Defaulting to SALE is deliberate: every row that exists today was bought, and the box office
-- can therefore tell paid from free without a backfill.
alter table public.ticket_bookings
  add column if not exists source text not null default 'SALE';

alter table public.ticket_bookings
  add column if not exists issued_by text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'ticket_bookings_source_check'
  ) then
    alter table public.ticket_bookings
      add constraint ticket_bookings_source_check check (source in ('SALE', 'COMP'));
  end if;
end $$;

-- Reading "every comp for this event" is the box office's own query, and it must stay cheap
-- while the sold list grows past it.
create index if not exists ticket_bookings_comp_idx
  on public.ticket_bookings (event_id, created_at desc)
  where source = 'COMP';

-- 2. The register -----------------------------------------------------------------------------
-- One row per grant, pointing at the booking that actually carries the passes. Kept separate
-- from ticket_bookings because it answers a different question: not "is this pass valid" but
-- "who did we give seats to, and why". face_value is what the seats would have sold for, so the
-- cost of the guest list is a sum rather than an afterthought.
create table if not exists public.comp_ticket_grants (
  id           uuid primary key default gen_random_uuid(),
  booking_id   uuid not null references public.ticket_bookings(id) on delete cascade,
  event_id     text not null,
  guest_name   text not null,
  guest_email  text not null,
  guest_phone  text,
  reason       text not null default 'OTHER',
  note         text,
  passes       integer not null default 0,
  admits       integer not null default 0,
  face_value   numeric(12, 2) not null default 0,
  issued_by    text not null,
  created_at   timestamptz not null default now(),
  constraint comp_ticket_grants_reason_check
    check (reason in ('VIP', 'INVITEE', 'ARTIST', 'SPONSOR', 'CREW', 'MEDIA', 'OTHER')),
  constraint comp_ticket_grants_passes_check check (passes >= 0 and passes <= 50)
);

-- One grant per booking: the booking is created by the grant and never shared with another.
create unique index if not exists comp_ticket_grants_booking_uidx
  on public.comp_ticket_grants (booking_id);

create index if not exists comp_ticket_grants_event_idx
  on public.comp_ticket_grants (event_id, created_at desc);

-- 3. Lock it down -----------------------------------------------------------------------------
-- The guest list is names, emails and phone numbers of people who did not buy anything. It is
-- only ever read and written by the admin API through the service role, which bypasses RLS, so
-- enabling it with no policies denies anon and authenticated outright and changes no behaviour.
alter table public.comp_ticket_grants enable row level security;
revoke all on table public.comp_ticket_grants from anon, authenticated;

insert into public.app_schema_markers (name) values ('comp_passes_v1')
  on conflict (name) do update set applied_at = now();

commit;

-- Afterwards:
--   select column_name from information_schema.columns
--    where table_name = 'ticket_bookings' and column_name in ('source', 'issued_by');  -- 2 rows
--   select count(*) from public.ticket_bookings where source <> 'SALE';                -- 0
--   select name from public.app_schema_markers where name = 'comp_passes_v1';          -- 1 row
