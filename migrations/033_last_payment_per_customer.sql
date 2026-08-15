-- 033_last_payment_per_customer.sql
--
-- The Outstanding report shows Billed / Paid (in-range) / Outstanding totals
-- per customer, but no way to tell WHEN a customer last paid or HOW MUCH that
-- payment was — so a customer who paid yesterday looks identical to one who
-- hasn't paid in months. This adds a server-side lookup of each customer's
-- single most recent (non-voided) payment, independent of any date-range
-- filter, so it stays meaningful even when the report is filtered to a
-- narrower window than the payment fell in.
--
-- Run this whole file in the Supabase SQL editor.

create or replace function public.customer_last_payments()
returns table (
  customer_id        uuid,
  last_payment_date  date,
  last_payment_amount numeric,
  last_payment_mode  text
)
language sql
stable
security definer
set search_path = public
as $$
  select distinct on (p.customer_id)
    p.customer_id,
    p.payment_date  as last_payment_date,
    p.amount::numeric as last_payment_amount,
    p.mode::text    as last_payment_mode
  from payments p
  where p.voided_at is null
    and p.customer_id is not null
  order by p.customer_id, p.payment_date desc, p.created_at desc;
$$;

grant execute on function public.customer_last_payments() to authenticated, service_role;
