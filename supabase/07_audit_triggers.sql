-- Audit triggers for all key business tables.
-- Fires AFTER INSERT / UPDATE / DELETE and appends a row to audit_logs.
-- user_id is NULL because server actions use the service-role admin client
-- (auth.uid() is not available in that context).
-- The "who" is captured inside new_value / old_value JSON via created_by,
-- received_by, voided_by, etc. fields already on each table.

create or replace function public.audit_trigger_func()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_logs (action, table_name, record_id, old_value, new_value)
  values (
    TG_OP,
    TG_TABLE_NAME,
    case when TG_OP = 'DELETE' then OLD.id else NEW.id end,
    case when TG_OP in ('UPDATE', 'DELETE') then to_jsonb(OLD) else null end,
    case when TG_OP in ('INSERT', 'UPDATE') then to_jsonb(NEW) else null end
  );
  return coalesce(NEW, OLD);
end;
$$;

-- customers
drop trigger if exists audit_customers on public.customers;
create trigger audit_customers
  after insert or update or delete on public.customers
  for each row execute function public.audit_trigger_func();

-- orders
drop trigger if exists audit_orders on public.orders;
create trigger audit_orders
  after insert or update or delete on public.orders
  for each row execute function public.audit_trigger_func();

-- payments
drop trigger if exists audit_payments on public.payments;
create trigger audit_payments
  after insert or update or delete on public.payments
  for each row execute function public.audit_trigger_func();

-- invoices
drop trigger if exists audit_invoices on public.invoices;
create trigger audit_invoices
  after insert or update or delete on public.invoices
  for each row execute function public.audit_trigger_func();

-- customer_subscriptions
drop trigger if exists audit_subscriptions on public.customer_subscriptions;
create trigger audit_subscriptions
  after insert or update or delete on public.customer_subscriptions
  for each row execute function public.audit_trigger_func();
