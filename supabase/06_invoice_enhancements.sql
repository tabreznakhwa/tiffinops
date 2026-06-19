-- Invoice number sequence and helper function
-- Run in Supabase SQL Editor

create sequence if not exists invoices_seq start 1;

create or replace function next_invoice_number()
returns text
language sql security definer set search_path = public
as $$
  select (select invoice_prefix from app_settings where id = 1)
    || lpad(nextval('invoices_seq')::text, 5, '0')
$$;
