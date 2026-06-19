-- Run in Supabase SQL Editor → New query
-- Adds next_payment_number() function (format: PAY-00001)

create or replace function next_payment_number()
returns text
language sql
security definer
set search_path = public
as $$
  select (select payment_prefix from app_settings where id = 1)
    || lpad(nextval('payments_seq')::text, 5, '0')
$$;
