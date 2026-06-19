-- Run this in Supabase SQL editor (dashboard → SQL Editor → New query)

-- 1. Drop the order-to-ledger trigger — ledger is INVOICES-ONLY per business rule.
--    Ledger debits happen only when an invoice is created, never on raw order entry.
drop trigger if exists trg_order_to_ledger on orders;
drop function if exists post_order_to_ledger();

-- 2. Order number generator: AC-A-YYMMDD-00042 (date in Asia/Dubai timezone)
create or replace function next_order_number()
returns text
language sql
security definer
set search_path = public
as $$
  select (select order_prefix from app_settings where id = 1)
    || to_char(now() at time zone 'Asia/Dubai', 'YYMMDD')
    || '-'
    || lpad(nextval('orders_seq')::text, 5, '0')
$$;
