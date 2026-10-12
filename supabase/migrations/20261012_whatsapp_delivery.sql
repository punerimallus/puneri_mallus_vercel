-- WhatsApp copy of the tickets. Safe to run more than once; nothing changes until WhatsApp is switched on.
alter table public.payment_orders add column if not exists whatsapp_opt_in    boolean not null default false;
alter table public.payment_orders add column if not exists whatsapp_to        text;
alter table public.payment_orders add column if not exists whatsapp_status    text;   -- SENT | FAILED | SKIPPED
alter table public.payment_orders add column if not exists whatsapp_message_id text;
alter table public.payment_orders add column if not exists whatsapp_error     text;
