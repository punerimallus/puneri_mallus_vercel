-- reserve_order_inventory is callable by anyone with the public key. Close it.
--
-- ============================================================================================
-- Tickets are on sale while this is open. Grants only: no table, no booking, no pass is touched.
-- ============================================================================================
--
-- How it opened:
--
--   20261028 revoked EXECUTE on reserve_order_inventory(text, uuid, jsonb, int, int, int, int)
--            — the SEVEN-argument signature it created.
--   20261115 DROPPED that signature and created an EIGHT-argument one (p_max_bundles). A newly
--            created function gets EXECUTE to PUBLIC by default, and a revoke naming the old
--            argument list does not follow it. `create or replace` keeps a function's grants;
--            drop-and-create resets them, which is why this one slipped and the others did not.
--
-- What that allows, concretely: the anon key ships in the browser bundle, so anybody can POST
-- to /rest/v1/rpc/reserve_order_inventory and take seats without paying. Passing p_user_id null
-- skips the per-account limits as well — the function only applies them when a user id is given
-- — so the whole remaining stock of an event can be held at once. The holds expire and the
-- sweeper returns them, so it is not permanent damage, but it can be repeated, and an event
-- that reads SOLD OUT to real buyers all evening is the same thing as lost sales.
--
-- It cannot issue a pass, take or move money, or read anybody's data.
--
-- And it is not obscure: this repository is public, so 20261028_ticketing_integrity.sql — which
-- spells out the function and every one of its argument names — can be read by anyone. The
-- only thing standing between that and the seats is this grant.
--
-- Why the application is unaffected: every caller uses the SERVICE ROLE key, held on the server
-- and never shipped to a browser (see reserveForCheckout in lib/payments/server.ts). The service
-- role is not exempt from grants — it bypasses row-level security, which is a different thing —
-- so this script hands EXECUTE back to it explicitly rather than assuming it is covered.
--
-- Safe to run more than once.

begin;

-- Every signature of these names, not one spelling of one of them. The bug was a revoke that
-- named an argument list; naming them again would set the same trap for the next migration.
do $lock$
declare
  fn record;
begin
  -- These exist on every Supabase project. Checked anyway, so a missing one is a readable
  -- message rather than a bare "role does not exist" halfway through.
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    raise exception 'service_role is missing — stop, this is not a Supabase database';
  end if;

  for fn in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       -- Read off the live database rather than from memory. An earlier draft of this list
       -- named 'confirm_coupon_redemption', which does not exist — the function is called
       -- confirm_coupon — and so would have locked nothing while appearing to.
       and p.proname in (
         'reserve_order_inventory',
         'release_order_inventory',
         'confirm_order_inventory',
         'claim_coupon',
         'release_coupon',
         'confirm_coupon',
         'refresh_category_counts',
         'refresh_bundle_counts',
         'void_ticket_number',
         'expire_stale_holds',
         'adjust_loyalty_points',
         'email_sources'
       )
       -- get_auth_email_by_phone is deliberately NOT here: phone sign-in calls it from the
       -- browser with the anon key, and locking it would break logging in.
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn.sig);
    -- Then handed straight back to the one role that must have it.
    --
    -- Belt and braces. On this database every one of these already carries an explicit
    -- service_role grant, so the revoke above could not have taken it away — but "could not"
    -- is the kind of reasoning that put reserve_order_inventory on the public API in the first
    -- place. Granting it outright means the application keeps working whatever the ACL looked
    -- like before, including for any function added later that inherited EXECUTE from PUBLIC
    -- rather than being granted it.
    execute format('grant execute on function %s to service_role', fn.sig);
    raise notice 'locked: %', fn.sig;
  end loop;
end
$lock$;

insert into public.app_schema_markers (name) values ('reserve_function_locked_v1')
  on conflict (name) do update set applied_at = now();

commit;

-- Check — every row must read false, false:
--
--   select p.proname,
--          pg_get_function_identity_arguments(p.oid) as args,
--          has_function_privilege('anon', p.oid, 'EXECUTE')          as anon_can_run,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') as user_can_run
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and p.proname in ('reserve_order_inventory','release_order_inventory','claim_coupon',
--                        'release_coupon','refresh_bundle_counts','refresh_category_counts',
--                        'void_ticket_number')
--    order by p.proname;
--
-- And the sale still works: buy one ticket. The service role is unaffected by any of this.
