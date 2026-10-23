-- Admin → Payments: a switch to open or close Lifetime Membership sign-ups.
-- Off hides the Join button for everyone and makes the server refuse new membership orders.
-- Default true, so nothing changes until an admin turns it off. Safe to run more than once.

alter table public.app_settings
  add column if not exists membership_enabled boolean not null default true;
