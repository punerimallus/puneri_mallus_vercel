-- Run the reconcile job every five minutes, from the database.
--
-- ============================================================================================
-- READ THE SETUP STEP FIRST. This migration needs a secret pasted in before it will work.
-- It schedules an HTTP call. It writes to no table of yours and changes no ticketing logic.
-- ============================================================================================
--
-- Why from here and not from Vercel: the project is on the free plan, where cron jobs may run
-- at most once a day — which is why reconcile currently runs at 03:30 and a checkout that dies
-- at noon can sit on its seats until the following morning. Supabase has no such limit.
--
-- Why reconcile rather than the seat sweeper directly: reconcile is the only part of the system
-- that ASKS RAZORPAY what happened. Given an unfinished checkout it can tell a buyer who walked
-- away from one whose payment is still travelling — the first loses its seats, the second gets
-- its tickets. A plain SQL sweep cannot tell those apart, and running one on a timer would
-- refund real buyers (see 20261119_holds_wait_for_the_money.sql).
--
-- What each run does, in this order:
--   1. every unfinished order of the last 7 days is checked against Razorpay, and any that was
--      paid is fulfilled — passes issued, seats made permanent
--   2. only then are the seats of checkouts that were NOT paid given back
--   3. any fulfilled order whose email failed is sent again
--
-- So a dead checkout's seats return within about five minutes, and a payment that arrives late
-- is turned into a ticket instead of a refund.

-- ============================================================================================
-- SETUP — do this ONCE, before running the rest of the file.
--
-- Copy CRON_SECRET out of Vercel (Project → Settings → Environment Variables → CRON_SECRET,
-- click the eye to reveal it) and paste it in place of PASTE_CRON_SECRET_HERE below. It is
-- stored encrypted in Supabase Vault, not in this file — do not commit it anywhere.
-- ============================================================================================

-- An upsert, so running this a second time replaces the value instead of failing on the
-- unique name — which is what you want when rotating the secret.
do $secret$
declare
  sid uuid;
begin
  select id into sid from vault.secrets where name = 'reconcile_cron_secret';
  if sid is null then
    perform vault.create_secret(
      'PASTE_CRON_SECRET_HERE',
      'reconcile_cron_secret',
      'Bearer token for POST /api/razorpay/reconcile'
    );
  else
    perform vault.update_secret(sid, 'PASTE_CRON_SECRET_HERE');
  end if;
end
$secret$;


begin;

create extension if not exists pg_net;
create extension if not exists pg_cron;

-- Refuses to schedule a job that could only ever return 401.
do $guard$
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'reconcile_cron_secret') then
    raise exception 'Run the SETUP block above first: no reconcile_cron_secret in the vault';
  end if;
  if (select decrypted_secret from vault.decrypted_secrets where name = 'reconcile_cron_secret')
     in ('PASTE_CRON_SECRET_HERE', '') then
    raise exception 'The vault still holds the placeholder. Put the real CRON_SECRET in first';
  end if;
end
$guard$;

-- cron.schedule upserts on the job name, so running this file again re-points one job rather
-- than leaving two behind.
--
-- The secret is read at RUN time, not baked into the job, so rotating it in the vault is enough.
select cron.schedule(
  'reconcile-payments',
  '*/5 * * * *',
  $job$
  -- GET, not POST. proxy.ts allows this route for GET only — a POST is rejected by the
  -- middleware with "Unauthorized: Global Security Enforced" before the route is even reached,
  -- whatever the bearer token says. Vercel's own cron also uses GET, which is why the
  -- allowlist was written that way.
  select net.http_get(
    -- www, NOT the bare domain. punerimallus.com is an alias that REDIRECTS to
    -- www.punerimallus.com, and curl — which pg_net uses — strips the Authorization header on a
    -- redirect to a different host. The request then reaches the route with no bearer token and
    -- is refused, which looks exactly like a wrong secret and is not.
    -- maxAgeDays=1: every order in the window is re-checked against Razorpay on every run,
    -- and this one runs 288 times a day. A day's window keeps a run to a handful of orders;
    -- the full seven-day sweep is left to the nightly Vercel cron. A run that grew long enough
    -- to hit the sixty-second limit would never reach the hold sweep at its end, which is the
    -- one thing this job exists to do.
    url     := 'https://www.punerimallus.com/api/razorpay/reconcile?maxAgeDays=1',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets
                                      where name = 'reconcile_cron_secret')
    ),
    timeout_milliseconds := 55000
  );
  $job$
);

insert into public.app_schema_markers (name) values ('reconcile_every_5_min_v1')
  on conflict (name) do update set applied_at = now();

commit;

-- Check — the job is there:
--   select jobname, schedule, active from cron.job where jobname = 'reconcile-payments';
--
-- It fired (a row every five minutes):
--   select start_time, status from cron.job_run_details
--    where jobid = (select jobid from cron.job where jobname = 'reconcile-payments')
--    order by start_time desc limit 5;
--
-- Razorpay answered 200 rather than 401 — this is the one that proves the secret is right:
--   select created, status_code, content from net._http_response order by created desc limit 5;
--
-- Nothing is left stuck:
--   select count(*) from public.inventory_reservations where state = 'HELD' and expires_at < now();
--
-- To stop it:  select cron.unschedule('reconcile-payments');
