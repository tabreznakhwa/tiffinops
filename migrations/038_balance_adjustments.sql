-- 038: Balance adjustments — discounts / write-offs that settle small
-- residual customer balances without recording a fake payment.
-- The Outstanding report subtracts these from what the customer owes.

create table if not exists balance_adjustments (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id),
  -- positive amount = reduces what the customer owes
  amount numeric(12,2) not null check (amount > 0),
  adjustment_type text not null default 'discount'
    check (adjustment_type in ('discount', 'write_off', 'correction')),
  reason text not null check (length(trim(reason)) >= 3),
  adjustment_date date not null default current_date,
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_balance_adjustments_customer
  on balance_adjustments(customer_id);
create index if not exists idx_balance_adjustments_date
  on balance_adjustments(adjustment_date);

alter table balance_adjustments enable row level security;

create policy balance_adjustments_read on balance_adjustments
  for select using (is_active_user());
create policy balance_adjustments_write on balance_adjustments
  for all using (has_role(array['owner']::user_role[]))
  with check (has_role(array['owner']::user_role[]));
