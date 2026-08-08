-- 031_balance_aggregates.sql
--
-- PERFORMANCE: server-side aggregation for outstanding / debtor figures.
--
-- Before this migration the dashboard fetched EVERY order row and EVERY payment
-- row (paginated 1,000 at a time) on every page load, just to sum them per
-- customer in JavaScript. That cost grew forever as the business added orders
-- and was the single biggest cause of slow page loads.
--
-- These functions do the same aggregation inside Postgres and return one row
-- per customer / per day instead of one row per order.
--
-- Run this whole file in the Supabase SQL editor.

-- ── 1. Per-customer all-time balances ────────────────────────────────────────
-- Charges = credit orders that were not cancelled/voided/draft.
-- Credits  = payments that were not voided.
-- Matches the filters used by the Outstanding report.

create or replace function public.customer_balances()
returns table (
  customer_id   uuid,
  order_total   numeric,
  payment_total numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with order_totals as (
    select o.customer_id, sum(o.total_amount) as total
    from orders o
    where o.order_status::text not in ('cancelled', 'voided', 'draft')
      and o.is_credit = true
      and o.customer_id is not null
    group by o.customer_id
  ),
  payment_totals as (
    select p.customer_id, sum(p.amount) as total
    from payments p
    where p.voided_at is null
      and p.customer_id is not null
    group by p.customer_id
  )
  select
    coalesce(ot.customer_id, pt.customer_id)   as customer_id,
    coalesce(ot.total, 0)::numeric             as order_total,
    coalesce(pt.total, 0)::numeric             as payment_total
  from order_totals ot
  full outer join payment_totals pt on pt.customer_id = ot.customer_id;
$$;

-- ── 2. Order total for a date range ──────────────────────────────────────────
-- p_to is EXCLUSIVE, matching the half-open ranges used throughout the app.

create or replace function public.order_total_in_range(p_from date, p_to date)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(o.total_amount), 0)::numeric
  from orders o
  where o.order_date >= p_from
    and o.order_date <  p_to
    and o.order_status::text not in ('cancelled', 'voided', 'draft');
$$;

-- ── 3. Daily order totals (for the 30-day billed chart) ──────────────────────
-- p_to is INCLUSIVE here because the chart plots a closed range of days.

create or replace function public.order_daily_totals(p_from date, p_to date)
returns table (
  day   date,
  total numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select o.order_date as day, sum(o.total_amount)::numeric as total
  from orders o
  where o.order_date >= p_from
    and o.order_date <= p_to
    and o.order_status::text not in ('cancelled', 'voided', 'draft')
  group by o.order_date
  order by o.order_date;
$$;

-- ── 4. Per-customer order totals for a date range ────────────────────────────
-- Used by the Outstanding report so it no longer pages through every order.
-- Both bounds INCLUSIVE — the report filters on a closed [from, to] range.

create or replace function public.customer_balances_in_range(p_from date, p_to date)
returns table (
  customer_id   uuid,
  order_total   numeric,
  payment_total numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with order_totals as (
    select o.customer_id, sum(o.total_amount) as total
    from orders o
    where o.order_status::text not in ('cancelled', 'voided', 'draft')
      and o.is_credit = true
      and o.customer_id is not null
      and o.order_date >= p_from
      and o.order_date <= p_to
    group by o.customer_id
  ),
  payment_totals as (
    select p.customer_id, sum(p.amount) as total
    from payments p
    where p.voided_at is null
      and p.customer_id is not null
      and p.payment_date >= p_from
      and p.payment_date <= p_to
    group by p.customer_id
  )
  select
    coalesce(ot.customer_id, pt.customer_id)   as customer_id,
    coalesce(ot.total, 0)::numeric             as order_total,
    coalesce(pt.total, 0)::numeric             as payment_total
  from order_totals ot
  full outer join payment_totals pt on pt.customer_id = ot.customer_id;
$$;

-- ── 5. Supporting indexes ────────────────────────────────────────────────────
-- These make the aggregates above (and the existing date-filtered list pages)
-- index scans instead of sequential scans.

create index if not exists idx_orders_customer_id        on public.orders (customer_id);
create index if not exists idx_orders_order_date         on public.orders (order_date);
create index if not exists idx_orders_date_status        on public.orders (order_date, order_status);
create index if not exists idx_order_items_order_id      on public.order_items (order_id);

create index if not exists idx_payments_customer_id      on public.payments (customer_id);
create index if not exists idx_payments_payment_date     on public.payments (payment_date);

create index if not exists idx_invoices_status           on public.invoices (status);
create index if not exists idx_invoices_invoice_date     on public.invoices (invoice_date desc);
create index if not exists idx_invoice_items_invoice_id  on public.invoice_items (invoice_id);

create index if not exists idx_cust_subs_customer_id     on public.customer_subscriptions (customer_id);
create index if not exists idx_cust_subs_status          on public.customer_subscriptions (status);

-- ── 6. Grants ────────────────────────────────────────────────────────────────
-- The app calls these with the service-role key, but grant to authenticated
-- as well so they can be used from RLS-scoped clients later.

grant execute on function public.customer_balances()                    to authenticated, service_role;
grant execute on function public.order_total_in_range(date, date)       to authenticated, service_role;
grant execute on function public.order_daily_totals(date, date)         to authenticated, service_role;
grant execute on function public.customer_balances_in_range(date, date) to authenticated, service_role;
