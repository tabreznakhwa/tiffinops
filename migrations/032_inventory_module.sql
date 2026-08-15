-- ============================================================================
-- Inventory module — raw material purchases + daily consumption tracking.
-- Run this in Supabase SQL Editor.
-- Stock changes are computed app-side (lib/inventory/actions.ts), not by
-- triggers — see supabase/03_order_enhancements.sql for why this repo moved
-- away from trigger-posted running totals.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- ENUM
-- ---------------------------------------------------------------------------
create type inventory_txn_type as enum ('purchase','consumption','adjustment','damaged','opening_stock');

-- ---------------------------------------------------------------------------
-- SUPPLIERS
-- ---------------------------------------------------------------------------
create table suppliers (
  id uuid primary key default gen_random_uuid(),
  supplier_code text not null unique,        -- e.g. SUP-00001
  name text not null,
  contact_person text,
  phone text,
  email text,
  address text,
  notes text,
  is_active boolean not null default true,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_suppliers_active on suppliers(is_active);

-- ---------------------------------------------------------------------------
-- INVENTORY ITEMS (raw materials master list)
-- current_stock is a denormalized running total kept in sync by app code —
-- every write to it is paired with an inventory_transactions row.
-- ---------------------------------------------------------------------------
create table inventory_items (
  id uuid primary key default gen_random_uuid(),
  item_code text not null unique,            -- e.g. ITM-00001
  name text not null,
  category text,
  unit_of_measure text not null,             -- kg, g, l, ml, pcs, box, packet…
  current_stock numeric(12,3) not null default 0,
  min_stock_level numeric(12,3) not null default 0 check (min_stock_level >= 0),
  purchase_price numeric(12,2) not null default 0 check (purchase_price >= 0),
  storage_location text,
  is_active boolean not null default true,
  notes text,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index idx_inventory_items_name on inventory_items(lower(name));
create index idx_inventory_items_active on inventory_items(is_active);
create index idx_inventory_items_low_stock on inventory_items(current_stock) where current_stock <= min_stock_level;

-- ---------------------------------------------------------------------------
-- PURCHASES (header) + PURCHASE ITEMS
-- ---------------------------------------------------------------------------
create table purchases (
  id uuid primary key default gen_random_uuid(),
  purchase_number text not null unique,      -- e.g. PUR-260814-00001
  supplier_id uuid not null references suppliers(id) on delete restrict,
  purchase_date date not null default current_date,
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid','partial','paid')),
  payment_method payment_mode,
  subtotal numeric(12,2) not null default 0 check (subtotal >= 0),
  total_amount numeric(12,2) not null default 0 check (total_amount >= 0),
  notes text,
  created_by uuid not null references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_purchases_date on purchases(purchase_date desc);
create index idx_purchases_supplier on purchases(supplier_id, purchase_date desc);

create table purchase_items (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references purchases(id) on delete cascade,
  inventory_item_id uuid not null references inventory_items(id),
  quantity numeric(12,3) not null check (quantity > 0),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  total_price numeric(12,2) not null check (total_price >= 0)
);
create index idx_purchase_items_purchase on purchase_items(purchase_id);

-- ---------------------------------------------------------------------------
-- INVENTORY TRANSACTIONS (append-only stock ledger — mirrors ledger_entries'
-- role for customer balances, but for inventory_items.current_stock)
-- quantity is signed: positive = stock in, negative = stock out.
-- ---------------------------------------------------------------------------
create table inventory_transactions (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references inventory_items(id) on delete restrict,
  transaction_type inventory_txn_type not null,
  transaction_date date not null default current_date,
  quantity numeric(12,3) not null check (quantity <> 0),
  stock_before numeric(12,3) not null,
  stock_after numeric(12,3) not null,
  unit_price numeric(12,2),
  total_value numeric(12,2),
  reference_table text,                       -- 'purchases' | null (manual entries)
  reference_id uuid,
  notes text,
  created_by uuid not null references users(id),
  created_at timestamptz not null default now()
);
create index idx_inventory_txns_item_date on inventory_transactions(item_id, transaction_date desc, created_at desc);
create index idx_inventory_txns_reference on inventory_transactions(reference_table, reference_id);
create index idx_inventory_txns_date_type on inventory_transactions(transaction_date, transaction_type);

-- ---------------------------------------------------------------------------
-- APP SETTINGS — numbering prefixes
-- ---------------------------------------------------------------------------
alter table app_settings
  add column if not exists purchase_prefix text not null default 'PUR-',
  add column if not exists supplier_prefix text not null default 'SUP-',
  add column if not exists inventory_item_prefix text not null default 'ITM-';

-- ---------------------------------------------------------------------------
-- SEQUENCES + NUMBERING RPCS (mirror next_order_number / next_customer_code)
-- ---------------------------------------------------------------------------
create sequence if not exists purchases_seq;
create sequence if not exists suppliers_seq;
create sequence if not exists inventory_items_seq;

create or replace function next_purchase_number()
returns text
language sql
security definer
set search_path = public
as $$
  select (select purchase_prefix from app_settings where id = 1)
    || to_char(now() at time zone 'Asia/Dubai', 'YYMMDD')
    || '-'
    || lpad(nextval('purchases_seq')::text, 5, '0')
$$;

create or replace function next_supplier_code()
returns text
language sql
security definer
set search_path = public
as $$
  select (select supplier_prefix from app_settings where id = 1)
    || lpad(nextval('suppliers_seq')::text, 5, '0')
$$;

create or replace function next_inventory_item_code()
returns text
language sql
security definer
set search_path = public
as $$
  select (select inventory_item_prefix from app_settings where id = 1)
    || lpad(nextval('inventory_items_seq')::text, 5, '0')
$$;

-- ---------------------------------------------------------------------------
-- TIMESTAMP TRIGGERS
-- ---------------------------------------------------------------------------
create trigger trg_touch_inventory_items before update on inventory_items for each row execute function touch_updated_at();
create trigger trg_touch_suppliers       before update on suppliers       for each row execute function touch_updated_at();
create trigger trg_touch_purchases       before update on purchases       for each row execute function touch_updated_at();

-- ---------------------------------------------------------------------------
-- AUDIT TRIGGERS — master/header tables only (purchase_items and
-- inventory_transactions are line-item/ledger tables, same exclusion as
-- order_items and ledger_entries).
-- ---------------------------------------------------------------------------
create trigger audit_inventory_items after insert or update or delete on public.inventory_items
  for each row execute function public.audit_trigger_func();
create trigger audit_suppliers after insert or update or delete on public.suppliers
  for each row execute function public.audit_trigger_func();
create trigger audit_purchases after insert or update or delete on public.purchases
  for each row execute function public.audit_trigger_func();

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- Read: any active user. Write: inventory_items/suppliers → owner/manager
-- (master data, same tier as menu_write). purchases/purchase_items/
-- inventory_transactions → owner/manager/data_entry (same tier as orders).
-- ---------------------------------------------------------------------------
alter table suppliers               enable row level security;
alter table inventory_items         enable row level security;
alter table purchases               enable row level security;
alter table purchase_items          enable row level security;
alter table inventory_transactions  enable row level security;

create policy suppliers_read on suppliers for select using (is_active_user());
create policy suppliers_write on suppliers for all using (has_role(array['owner','manager']::user_role[]));

create policy inventory_items_read on inventory_items for select using (is_active_user());
create policy inventory_items_write on inventory_items for all using (has_role(array['owner','manager']::user_role[]));

create policy purchases_read on purchases for select using (is_active_user());
create policy purchases_write on purchases for all using (has_role(array['owner','manager','data_entry']::user_role[]));

create policy purchase_items_read on purchase_items for select using (is_active_user());
create policy purchase_items_write on purchase_items for all using (has_role(array['owner','manager','data_entry']::user_role[]));

create policy inventory_txns_read on inventory_transactions for select using (is_active_user());
create policy inventory_txns_write on inventory_transactions for all using (has_role(array['owner','manager','data_entry']::user_role[]));
