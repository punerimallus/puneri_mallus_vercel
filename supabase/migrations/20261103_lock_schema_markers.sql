-- Close the hole Supabase's advisor flagged: app_schema_markers was world-writable.
--
-- 20261028_ticketing_integrity.sql creates app_schema_markers and then enables row level
-- security on the four tables it also creates (ticket_numbers, inventory_reservations,
-- event_staff, scan_log) — but not on app_schema_markers itself. Supabase grants anon and
-- authenticated full DML on public tables by default, and the anon key ships in the browser
-- bundle, so with RLS off that table was readable AND writable by anyone on the internet.
--
-- Why that mattered more than a marker table sounds like it should. /api/razorpay/order calls
-- checkSchema() before creating an order and refuses to take payment when the
-- 'ticketing_integrity_v1' row is absent. So:
--
--     delete from app_schema_markers where name = 'ticketing_integrity_v1';
--
-- with the public anon key would have stopped every new ticket sale. Worse, checkSchema caches
-- a successful answer per process, so running instances would have carried on while new ones
-- refused — an intermittent outage with no obvious cause, during a sale.
--
-- The table is only ever read by the service role (lib/payments/schema-check.ts, always via
-- supabaseAdmin()), which bypasses RLS, so enabling it changes no application behaviour.
-- No policies are added, deliberately: that denies anon and authenticated outright.
--
-- Safe to run more than once.

begin;

alter table public.app_schema_markers enable row level security;

-- Belt and braces: RLS alone would be enough, but removing the grants means a future policy
-- added by mistake cannot re-open write access to the browser-side roles.
revoke all on table public.app_schema_markers from anon, authenticated;

insert into public.app_schema_markers (name) values ('schema_markers_locked')
  on conflict (name) do update set applied_at = now();

commit;

-- Afterwards, this should report rls_enabled = true and no anon/authenticated grants:
--   select relrowsecurity from pg_class
--    where relname = 'app_schema_markers' and relnamespace = 'public'::regnamespace;
--   select grantee, privilege_type from information_schema.role_table_grants
--    where table_name = 'app_schema_markers' and grantee in ('anon','authenticated');
