-- Bulk email (admin > Email Studio): unsubscribe list and campaign log.
-- Safe to run more than once. Run it in the Supabase SQL editor before using the tool.
-- Both tables are only touched by server routes using the service-role key, so RLS is on with no policies.

create table if not exists public.email_unsubscribes (
  email text primary key,
  source text not null default 'link',
  created_at timestamptz not null default now()
);

create table if not exists public.email_campaigns (
  id uuid primary key default gen_random_uuid(),
  created_by text not null,
  subject text not null,
  heading text,
  body text,
  cta_label text,
  cta_url text,
  recipients_total integer not null default 0,
  sent integer not null default 0,
  failed integer not null default 0,
  skipped_unsubscribed integer not null default 0,
  status text not null default 'SENDING',   -- SENDING | DONE | PARTIAL | FAILED
  failures jsonb not null default '[]'::jsonb, -- [{"email": "...", "error": "..."}], capped at 500
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists email_campaigns_created_idx on public.email_campaigns (created_at desc);

alter table public.email_unsubscribes enable row level security;
alter table public.email_campaigns enable row level security;

-- Lets the Email Studio find every table that stores email addresses (except profiles, where phone-login
-- accounts hold placeholder addresses) so an admin can pick them as a recipient group.
-- Only the service-role key can call it, and it returns table and column names, never data.
create or replace function public.email_sources()
returns table(table_name text, column_name text)
language sql
security definer
set search_path = public
as $$
  select c.table_name::text, c.column_name::text
  from information_schema.columns c
  join information_schema.tables t
    on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
  where c.table_schema = 'public'
    and c.column_name ilike '%email%'
    and c.data_type in ('text', 'character varying', 'citext')
    and c.table_name not in ('profiles', 'email_unsubscribes', 'email_campaigns', 'payment_webhook_events')
  order by c.table_name, c.column_name;
$$;

revoke all on function public.email_sources() from public, anon, authenticated;
grant execute on function public.email_sources() to service_role;
