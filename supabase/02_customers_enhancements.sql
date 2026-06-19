-- =============================================================================
-- TiffinOps — 02 Customers enhancements
-- Run once in Supabase SQL editor (safe to re-run — all statements are idempotent)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Area / delivery zone column
--    Used for grouping customers by neighbourhood and for list filtering.
-- ---------------------------------------------------------------------------
alter table customers add column if not exists area text;
create index if not exists idx_customers_area on customers(area) where area is not null;

-- ---------------------------------------------------------------------------
-- 2. Atomic sequential customer code generator
--    Returns e.g. "AC-CUST-00042" using the customers_seq sequence.
--    SECURITY DEFINER so it can read app_settings (which has RLS) from any context.
-- ---------------------------------------------------------------------------
create or replace function next_customer_code()
returns text
language sql
security definer
set search_path = public
as $$
  select coalesce(
    (select customer_prefix from app_settings where id = 1),
    'AC-CUST-'
  ) || lpad(nextval('customers_seq')::text, 5, '0')
$$;
