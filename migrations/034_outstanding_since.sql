-- 034_outstanding_since.sql
--
-- "How long has this customer's balance been outstanding?" — per customer, the
-- date of the oldest credit order that is still unpaid, using FIFO matching
-- (payments cover the earliest orders first). Fully-paid customers return no
-- row; the Outstanding report treats that as "nothing outstanding".
--
-- Run this whole file in the Supabase SQL editor.

create or replace function public.customer_outstanding_since()
returns table (
  customer_id        uuid,
  outstanding_since  date
)
language sql
stable
security definer
set search_path = public
as $$
  with debits as (
    select o.customer_id, o.order_date as d, o.total_amount::numeric as amt
    from orders o
    where o.is_credit = true
      and o.customer_id is not null
      and o.order_status::text not in ('cancelled', 'voided', 'draft')
  ),
  cumulative as (
    select
      d.customer_id,
      d.d,
      sum(d.amt) over (
        partition by d.customer_id
        order by d.d, d.amt
        rows between unbounded preceding and current row
      ) as cum_debit
    from debits d
  ),
  payments as (
    select p.customer_id, sum(p.amount)::numeric as paid
    from payments p
    where p.voided_at is null
      and p.customer_id is not null
    group by p.customer_id
  )
  select
    c.customer_id,
    min(c.d) as outstanding_since
  from cumulative c
  left join payments p on p.customer_id = c.customer_id
  where coalesce(p.paid, 0) < c.cum_debit
  group by c.customer_id;
$$;

grant execute on function public.customer_outstanding_since() to authenticated, service_role;

-- Oldest still-unpaid invoice due date per customer — the aging anchor for
-- subscription-only debt (fixed_monthly bills), which the order-based FIFO
-- above can't see because those charges live on invoices, not orders.

create or replace function public.customer_oldest_unpaid_invoice()
returns table (
  customer_id     uuid,
  oldest_due_date date
)
language sql
stable
security definer
set search_path = public
as $$
  select i.customer_id, min(i.due_date) as oldest_due_date
  from invoices i
  where i.customer_id is not null
    and i.status::text in ('issued', 'overdue', 'partial')
  group by i.customer_id;
$$;

grant execute on function public.customer_oldest_unpaid_invoice() to authenticated, service_role;
