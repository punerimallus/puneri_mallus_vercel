-- Deleting a user from Supabase → Authentication → Users must remove everything they own.
--
-- Before this: profiles/memberships/payments cascaded, but
--   * directory_owners and mallu_invoice pointed at auth.users with NO ACTION, which makes the
--     whole delete fail ("Database error deleting user") whenever the user owns a listing, and
--   * payment_orders and ticket_bookings had no foreign key at all, so their rows were left behind.
--
-- After this every table below is removed together with the auth user.
-- (payments and memberships already cascade via profiles; profiles cascades from auth.users.)
--
-- Re-runnable: each constraint is dropped if present and re-added.

begin;

-- 1. The two foreign keys that were blocking the delete: make them cascade.
alter table public.directory_owners drop constraint if exists directory_owners_user_id_fkey;
alter table public.directory_owners
  add constraint directory_owners_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;

alter table public.mallu_invoice drop constraint if exists mallu_invoice_user_id_fkey;
alter table public.mallu_invoice
  add constraint mallu_invoice_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;

-- 2. Tables that had no link at all (checked beforehand: no orphaned rows, so the constraints validate).
alter table public.payment_orders drop constraint if exists payment_orders_user_id_fkey;
alter table public.payment_orders
  add constraint payment_orders_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;

alter table public.ticket_bookings drop constraint if exists ticket_bookings_user_id_fkey;
alter table public.ticket_bookings
  add constraint ticket_bookings_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;

commit;

-- Not covered by a foreign key (they only store an email, no user id): football_teams, post_registration,
-- email_unsubscribes, admin_audit_logs. Left as is on purpose: unsubscribes must survive so the person
-- is not emailed again, and audit logs are a record of admin actions.
