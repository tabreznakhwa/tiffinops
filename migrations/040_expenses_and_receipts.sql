-- ============================================================================
-- Expenses ledger + receipt storage — for the AI bill scanner (/scan-bill).
-- Run this in Supabase SQL Editor.
--
-- Non-inventory business spending (fuel, utilities, rent, salaries…) gets its
-- own simple ledger; raw-material bills keep posting through the existing
-- purchases module (032). Both can carry a scanned receipt image, stored in a
-- private `receipts` storage bucket accessed only via service-role signed
-- URLs server-side.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- ENUM
-- ---------------------------------------------------------------------------
create type expense_category as enum (
  'ingredients', 'fuel', 'utilities', 'rent', 'salaries',
  'maintenance', 'packaging', 'marketing', 'other'
);

-- ---------------------------------------------------------------------------
-- EXPENSES
-- ---------------------------------------------------------------------------
create table expenses (
  id uuid primary key default gen_random_uuid(),
  expense_number text not null unique,       -- e.g. EXP-260821-00001
  expense_date date not null default current_date,
  category expense_category not null default 'other',
  vendor_name text,
  description text,
  amount numeric(12,2) not null check (amount > 0),
  payment_method payment_mode,
  receipt_path text,                          -- storage path in the receipts bucket
  notes text,
  created_by uuid not null references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_expenses_date on expenses(expense_date desc);
create index idx_expenses_category on expenses(category, expense_date desc);

-- Scanned receipt attached to a raw-material purchase
alter table purchases add column if not exists receipt_path text;

-- ---------------------------------------------------------------------------
-- APP SETTINGS + NUMBERING (mirrors next_purchase_number from 032)
-- ---------------------------------------------------------------------------
alter table app_settings
  add column if not exists expense_prefix text not null default 'EXP-';

create sequence if not exists expenses_seq;

create or replace function next_expense_number()
returns text
language sql
security definer
set search_path = public
as $$
  select (select expense_prefix from app_settings where id = 1)
    || to_char(now() at time zone 'Asia/Dubai', 'YYMMDD')
    || '-'
    || lpad(nextval('expenses_seq')::text, 5, '0')
$$;

-- ---------------------------------------------------------------------------
-- TRIGGERS (timestamp + audit, same as other header tables)
-- ---------------------------------------------------------------------------
create trigger trg_touch_expenses before update on expenses
  for each row execute function touch_updated_at();

create trigger audit_expenses after insert or update or delete on public.expenses
  for each row execute function public.audit_trigger_func();

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- Read: any active user. Write: owner/manager/accounts (money records, same
-- tier as the cash/bank views).
-- ---------------------------------------------------------------------------
alter table expenses enable row level security;

create policy expenses_read on expenses
  for select using (is_active_user());
create policy expenses_write on expenses
  for all using (has_role(array['owner','manager','accounts']::user_role[]));

-- ---------------------------------------------------------------------------
-- STORAGE BUCKET — private; the app reads/writes it exclusively through the
-- service-role client and hands out short-lived signed URLs.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', false)
on conflict (id) do nothing;
