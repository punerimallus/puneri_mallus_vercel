-- Optional. Lets ticket_bookings.amount_paid keep paise (for example 1.60 or 424.15) instead of whole rupees.
-- The app works without it: if the column is still an integer it stores whole rupees and keeps the exact
-- amount in payment_orders.base_amount. Safe to run more than once; widening integer to numeric loses nothing.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'ticket_bookings' and column_name = 'amount_paid'
      and data_type in ('integer', 'bigint', 'smallint')
  ) then
    alter table public.ticket_bookings alter column amount_paid type numeric(12, 2) using amount_paid::numeric;
  end if;
end $$;
