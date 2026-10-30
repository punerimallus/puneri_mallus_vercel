-- The 2D venue map: where each ticket category sits in the room.
--
-- Purely presentational. Nothing here takes part in reserving, numbering or allocating a pass:
-- the reservation system from 20261028 is untouched, and an event with no map sells exactly as
-- it does today. A buyer still buys "2 x VIP"; the map only shows them where VIP is.
--
-- There is deliberately no seat identity. A zone is an area of floor, so no pass can be tied to
-- one chair, and the per-seat concurrency guarantees stay as they are.
--
-- Safe to run more than once.

begin;

-- 1. Each category's painted area ------------------------------------------------------------
-- Shape: { "cells": [[x,y], ...], "color": "#e11d48" }
-- Grid cells, not pixels, so one definition renders on a phone and a desktop alike.
-- Null means "not placed on the map": that category still sells, it is just not drawn.
-- This column rides on event_ticket_categories, which already allows public SELECT, so the
-- booking page reads the map in the query it already makes for prices.
alter table public.event_ticket_categories
  add column if not exists zone jsonb;

-- 2. The room itself -------------------------------------------------------------------------
-- The stage, the doors, the bar, the dance floor: things in the venue that are not for sale and
-- so have no category to hang off. One row per event.
create table if not exists public.event_venue_layouts (
  event_id   text primary key,
  cols       integer not null default 12,
  rows       integer not null default 16,
  -- [{ "kind": "stage", "x":0, "y":0, "w":12, "h":2, "label":"STAGE" }, ...]
  features   jsonb   not null default '[]'::jsonb,
  preset     text,
  -- The venue's own floor plan, drawn under the zones. Optional: it is a backdrop, and the
  -- zones a buyer taps are always the painted cells, never anything read out of the picture.
  plan_url     text,
  plan_opacity integer not null default 45,
  updated_at timestamptz not null default now(),
  constraint event_venue_layouts_cols_check check (cols between 4 and 24),
  constraint event_venue_layouts_rows_check check (rows between 4 and 24),
  constraint event_venue_layouts_features_check check (jsonb_typeof(features) = 'array'),
  constraint event_venue_layouts_opacity_check check (plan_opacity between 10 and 100),
  -- Only http(s): the plan goes into an <image> on a public page, so a javascript: or data:
  -- address must not be storable in the first place.
  constraint event_venue_layouts_plan_url_check check (plan_url is null or plan_url ~* '^https?://')
);

-- Added separately so a database that already has the table from an earlier run picks them up.
alter table public.event_venue_layouts add column if not exists plan_url text;
alter table public.event_venue_layouts add column if not exists plan_opacity integer not null default 45;

alter table public.event_venue_layouts enable row level security;

-- Same two policies the category table carries: a venue map is public information, and only an
-- authorised admin may change it. (The admin API writes with the service role regardless; this
-- keeps the table honest if anything ever reads or writes it with a user's own key.)
drop policy if exists "Allow public read access to venue layouts" on public.event_venue_layouts;
create policy "Allow public read access to venue layouts"
  on public.event_venue_layouts for select
  using (true);

drop policy if exists "Allow admins full access to venue layouts" on public.event_venue_layouts;
create policy "Allow admins full access to venue layouts"
  on public.event_venue_layouts for all
  to authenticated
  using ((auth.jwt() ->> 'email') in (select email from public.authorized_admins))
  with check ((auth.jwt() ->> 'email') in (select email from public.authorized_admins));

insert into public.app_schema_markers (name) values ('venue_layout_v1')
  on conflict (name) do update set applied_at = now();

commit;

-- Afterwards:
--   select column_name from information_schema.columns
--    where table_name = 'event_ticket_categories' and column_name = 'zone';     -- 1 row
--   select * from public.event_venue_layouts;                                   -- empty, that is correct
--   select name from public.app_schema_markers where name = 'venue_layout_v1';  -- 1 row
