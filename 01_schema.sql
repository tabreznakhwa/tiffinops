-- ============================================================================
-- TiffinOps Schema — Apna Chulha Restaurant LLC
-- Run this as a single migration in Supabase SQL editor or via supabase CLI.
-- All money is numeric(12,2) AED. All timestamps timestamptz, app uses Asia/Dubai.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- ENUMS
-- ---------------------------------------------------------------------------
create type user_role         as enum ('owner','manager','data_entry','accounts','viewer');
create type user_status       as enum ('pending','active','inactive');
create type customer_type     as enum ('a_la_carte','fixed_menu','hybrid');
create type customer_status   as enum ('active','paused','inactive','blacklisted');
create type meal_period       as enum ('breakfast','lunch','dinner');
create type order_status      as enum ('draft','confirmed','preparing','out_for_delivery','delivered','cancelled','voided');
create type payment_status    as enum ('unpaid','partial','paid','refunded','written_off');
create type delivery_status   as enum ('pending','out_for_delivery','delivered','skipped','failed','cancelled');
create type payment_mode      as enum ('cash','card','bank_transfer','cheque','online','wallet','other');
create type invoice_type      as enum ('a_la_carte_cycle','fixed_monthly','adhoc');
create type invoice_status    as enum ('draft','issued','partial','paid','overdue','cancelled','written_off');
create type ledger_type       as enum ('order','invoice','payment','discount','refund','write_off','adjustment','opening_balance');
create type approval_request_type as enum ('delete','edit');
create type approval_status   as enum ('pending','approved','rejected');
create type approval_target   as enum ('order','payment','invoice');

-- ---------------------------------------------------------------------------
-- USERS (mirrors auth.users; extra app-level fields)
-- ---------------------------------------------------------------------------
create table users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text not null,
  role user_role not null default 'viewer',
  status user_status not null default 'pending',
  -- per-user override flags (overrides role defaults if non-null)
  can_record_payment boolean,
  can_export_reports boolean,
  can_see_financials boolean,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_users_status on users(status);

-- ---------------------------------------------------------------------------
-- COMPANIES (optional grouping for customers — drives company-wise reports)
-- ---------------------------------------------------------------------------
create table companies (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  default_billing_day smallint check (default_billing_day between 1 and 31),
  notes text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- CUSTOMERS
-- ---------------------------------------------------------------------------
create table customers (
  id uuid primary key default gen_random_uuid(),
  customer_code text not null unique,         -- e.g. AC-CUST-00042
  full_name text not null,
  company_id uuid references companies(id) on delete set null,
  employee_id text,
  mobile_number text not null,
  whatsapp_number text,
  email text,
  delivery_address text,
  delivery_instructions text,
  customer_type customer_type not null default 'a_la_carte',
  status customer_status not null default 'active',
  -- billing config (mix: customer-level wins; falls back to company default; falls back to 26)
  billing_day smallint check (billing_day between 1 and 31),
  notes text,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index idx_customers_mobile on customers(mobile_number);
create index idx_customers_company on customers(company_id);
create index idx_customers_status on customers(status);
create index idx_customers_type on customers(customer_type);

-- effective billing day: customer's > company's > 26 (system default)
create or replace function effective_billing_day(c customers)
returns smallint language sql immutable as $$
  select coalesce(
    c.billing_day,
    (select default_billing_day from companies where id = c.company_id),
    26
  )::smallint;
$$;

-- ---------------------------------------------------------------------------
-- MENU ITEMS (single table, meal_period column drives grouping)
-- ---------------------------------------------------------------------------
create table menu_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  meal_period meal_period not null,
  category text,
  description text,
  default_price numeric(12,2) not null check (default_price >= 0),
  is_available boolean not null default true,
  image_url text,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_menu_items_meal on menu_items(meal_period) where is_available;
create unique index idx_menu_items_name_meal on menu_items(lower(name), meal_period);

-- ---------------------------------------------------------------------------
-- DAILY MENU (optional — overrides default menu for a specific date)
-- ---------------------------------------------------------------------------
create table daily_menus (
  id uuid primary key default gen_random_uuid(),
  menu_date date not null,
  uploaded_file_url text,
  notes text,
  is_published boolean not null default false,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  unique(menu_date)
);

create table daily_menu_items (
  id uuid primary key default gen_random_uuid(),
  daily_menu_id uuid not null references daily_menus(id) on delete cascade,
  menu_item_id uuid not null references menu_items(id),
  price_override numeric(12,2) check (price_override >= 0),
  is_available boolean not null default true,
  unique(daily_menu_id, menu_item_id)
);

-- ---------------------------------------------------------------------------
-- FIXED PLANS + SUBSCRIPTIONS
-- ---------------------------------------------------------------------------
create table fixed_plans (
  id uuid primary key default gen_random_uuid(),
  plan_name text not null unique,
  description text,
  meal_periods meal_period[] not null,         -- e.g. {lunch} or {lunch,dinner}
  default_monthly_price numeric(12,2) not null check (default_monthly_price >= 0),
  is_active boolean not null default true,
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);

create table customer_subscriptions (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete restrict,
  fixed_plan_id uuid not null references fixed_plans(id) on delete restrict,
  start_date date not null,
  end_date date,
  agreed_monthly_price numeric(12,2) not null check (agreed_monthly_price >= 0),
  status text not null default 'active' check (status in ('active','paused','cancelled','completed')),
  notes text,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  check (end_date is null or end_date >= start_date)
);
create index idx_subs_customer on customer_subscriptions(customer_id, status);

-- ---------------------------------------------------------------------------
-- ORDERS (a la carte + extra orders from hybrid customers)
-- The meal_period column is what drives packing reports AND monthly statements.
-- ---------------------------------------------------------------------------
create table orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,         -- e.g. AC-A-260613-00031
  customer_id uuid not null references customers(id) on delete restrict,
  order_date date not null default current_date,
  meal_period meal_period not null,          -- <<< the key tag
  subtotal numeric(12,2) not null default 0 check (subtotal >= 0),
  discount_amount numeric(12,2) not null default 0 check (discount_amount >= 0),
  delivery_charge numeric(12,2) not null default 0 check (delivery_charge >= 0),
  total_amount numeric(12,2) not null default 0,
  payment_status payment_status not null default 'unpaid',
  order_status order_status not null default 'confirmed',
  is_credit boolean not null default true,   -- true = goes on monthly bill, false = paid at entry
  notes text,
  created_by uuid not null references users(id),
  created_at timestamptz not null default now(),
  updated_by uuid references users(id),
  updated_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid references users(id),
  void_reason text
);
create index idx_orders_customer_date on orders(customer_id, order_date desc);
create index idx_orders_date_meal on orders(order_date, meal_period) where order_status <> 'voided';
create index idx_orders_created_by on orders(created_by, created_at desc);

create table order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  menu_item_id uuid references menu_items(id),
  item_name_snapshot text not null,          -- captured at entry time (price/name can change later)
  quantity numeric(10,2) not null check (quantity > 0),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  total_price numeric(12,2) not null check (total_price >= 0),
  notes text
);
create index idx_order_items_order on order_items(order_id);

-- ---------------------------------------------------------------------------
-- DELIVERIES
-- ---------------------------------------------------------------------------
create table deliveries (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete restrict,
  order_id uuid references orders(id) on delete cascade,
  subscription_id uuid references customer_subscriptions(id),
  delivery_date date not null default current_date,
  meal_period meal_period,
  status delivery_status not null default 'pending',
  skip_reason text,
  skip_note text,
  delivered_at timestamptz,
  updated_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'skipped' and skip_reason is not null) or status <> 'skipped')
);
create index idx_deliveries_date_status on deliveries(delivery_date, status);
create index idx_deliveries_customer on deliveries(customer_id, delivery_date desc);

-- ---------------------------------------------------------------------------
-- INVOICES + INVOICE ITEMS
-- One row per billing cycle per customer. Idempotent: unique key prevents dupes.
-- ---------------------------------------------------------------------------
create table invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_number text not null unique,
  customer_id uuid not null references customers(id) on delete restrict,
  invoice_date date not null default current_date,
  due_date date not null,
  invoice_type invoice_type not null,
  billing_period_start date,
  billing_period_end date,
  subtotal numeric(12,2) not null default 0,
  discount_amount numeric(12,2) not null default 0,
  tax_amount numeric(12,2) not null default 0,
  total_amount numeric(12,2) not null default 0,
  status invoice_status not null default 'issued',
  notes text,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- prevent duplicate invoices when the monthly job re-runs
create unique index idx_invoices_idempotent on invoices(customer_id, invoice_type, billing_period_start)
  where billing_period_start is not null;
create index idx_invoices_customer on invoices(customer_id, invoice_date desc);
create index idx_invoices_status on invoices(status);

create table invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices(id) on delete cascade,
  order_id uuid references orders(id),
  description text not null,
  quantity numeric(10,2) not null default 1,
  unit_price numeric(12,2) not null,
  total_price numeric(12,2) not null
);

-- ---------------------------------------------------------------------------
-- PAYMENTS
-- ---------------------------------------------------------------------------
create table payments (
  id uuid primary key default gen_random_uuid(),
  payment_number text not null unique,        -- PAY-00001
  customer_id uuid not null references customers(id) on delete restrict,
  invoice_id uuid references invoices(id),    -- nullable: payment can be applied to ledger generally
  payment_date date not null default current_date,
  amount numeric(12,2) not null check (amount > 0),
  mode payment_mode not null,
  reference_number text,                       -- bank txn / cheque # / card last 4 / online txn id
  notes text,
  received_by uuid not null references users(id),
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid references users(id),
  void_reason text
);
create index idx_payments_customer on payments(customer_id, payment_date desc);
create index idx_payments_date on payments(payment_date);

-- bank/cheque/online require reference_number; cash/card optional
create or replace function check_payment_reference() returns trigger language plpgsql as $$
begin
  if new.mode in ('bank_transfer','cheque','online') and (new.reference_number is null or btrim(new.reference_number) = '') then
    raise exception 'reference_number is required for payments of mode %', new.mode;
  end if;
  return new;
end$$;
create trigger trg_payment_reference before insert or update on payments
  for each row execute function check_payment_reference();

-- ---------------------------------------------------------------------------
-- LEDGER ENTRIES (the source of truth for every balance)
-- Posted automatically by triggers; balance = sum(debit) - sum(credit).
-- Never updated, only appended. Reversal = new opposing entry.
-- ---------------------------------------------------------------------------
create table ledger_entries (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete restrict,
  entry_date date not null default current_date,
  entry_type ledger_type not null,
  debit_amount numeric(12,2) not null default 0 check (debit_amount >= 0),
  credit_amount numeric(12,2) not null default 0 check (credit_amount >= 0),
  description text not null,
  reference_table text,                         -- 'orders' | 'invoices' | 'payments' etc
  reference_id uuid,
  reversal_of uuid references ledger_entries(id),
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  check (debit_amount + credit_amount > 0)
);
create index idx_ledger_customer_date on ledger_entries(customer_id, entry_date, created_at);
create index idx_ledger_reference on ledger_entries(reference_table, reference_id);

-- live balance view
create or replace view customer_balances as
select
  c.id as customer_id,
  c.full_name,
  c.company_id,
  coalesce(sum(le.debit_amount - le.credit_amount), 0)::numeric(12,2) as balance
from customers c
left join ledger_entries le on le.customer_id = c.id
group by c.id, c.full_name, c.company_id;

-- ---------------------------------------------------------------------------
-- LEDGER AUTO-POSTING — the ONLY way ledger gets written
-- Rule: credit-orders (is_credit=true, status confirmed) post a debit.
-- Statements post a debit for the cycle total. Payments post a credit.
-- Voided / refunded entries get a reversal.
-- ---------------------------------------------------------------------------
create or replace function post_order_to_ledger() returns trigger language plpgsql as $$
begin
  -- post when order becomes confirmed AND is credit (not paid-now)
  if (tg_op = 'INSERT' or old.order_status <> new.order_status or old.total_amount <> new.total_amount)
     and new.order_status = 'confirmed' and new.is_credit then
    -- if a prior debit exists, do nothing (we don't double-post on price-only updates here for simplicity;
    -- in production, reverse + re-post when total changes — handled in app code via service)
    if not exists (select 1 from ledger_entries
                   where reference_table='orders' and reference_id=new.id and entry_type='order' and reversal_of is null) then
      insert into ledger_entries(customer_id, entry_date, entry_type, debit_amount, description, reference_table, reference_id, created_by)
      values (new.customer_id, new.order_date, 'order', new.total_amount,
              'Order ' || new.order_number, 'orders', new.id, new.created_by);
    end if;
  end if;

  -- on void: reverse with a credit
  if tg_op = 'UPDATE' and old.order_status <> 'voided' and new.order_status = 'voided' then
    insert into ledger_entries(customer_id, entry_date, entry_type, credit_amount, description, reference_table, reference_id, reversal_of, created_by)
    select new.customer_id, current_date, 'order', le.debit_amount,
           'Reversal · order ' || new.order_number || ' voided', 'orders', new.id, le.id, new.voided_by
    from ledger_entries le
    where le.reference_table='orders' and le.reference_id=new.id and le.entry_type='order' and le.reversal_of is null;
  end if;

  return new;
end$$;
create trigger trg_order_to_ledger after insert or update on orders
  for each row execute function post_order_to_ledger();

create or replace function post_payment_to_ledger() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    insert into ledger_entries(customer_id, entry_date, entry_type, credit_amount, description, reference_table, reference_id, created_by)
    values (new.customer_id, new.payment_date, 'payment', new.amount,
            'Payment ' || new.payment_number || ' · ' || new.mode::text, 'payments', new.id, new.received_by);
  end if;
  if tg_op = 'UPDATE' and old.voided_at is null and new.voided_at is not null then
    insert into ledger_entries(customer_id, entry_date, entry_type, debit_amount, description, reference_table, reference_id, reversal_of, created_by)
    select new.customer_id, current_date, 'payment', le.credit_amount,
           'Reversal · payment ' || new.payment_number || ' voided', 'payments', new.id, le.id, new.voided_by
    from ledger_entries le
    where le.reference_table='payments' and le.reference_id=new.id and le.reversal_of is null;
  end if;
  return new;
end$$;
create trigger trg_payment_to_ledger after insert or update on payments
  for each row execute function post_payment_to_ledger();

-- ---------------------------------------------------------------------------
-- APPROVAL REQUESTS (deletes AND edits, polymorphic by target_table)
-- Data Entry executive triggers; Owner/Manager resolves.
-- ---------------------------------------------------------------------------
create table approval_requests (
  id uuid primary key default gen_random_uuid(),
  request_type approval_request_type not null,
  target_table approval_target not null,
  target_id uuid not null,
  reason text not null,
  proposed_changes jsonb,                     -- for edits: {field: newValue, ...}
  status approval_status not null default 'pending',
  requested_by uuid not null references users(id),
  requested_at timestamptz not null default now(),
  resolved_by uuid references users(id),
  resolved_at timestamptz,
  resolution_note text
);
create index idx_approvals_pending on approval_requests(status, requested_at) where status='pending';

-- ---------------------------------------------------------------------------
-- AUDIT LOG (system-wide trail for sensitive actions)
-- ---------------------------------------------------------------------------
create table audit_logs (
  id bigserial primary key,
  user_id uuid references users(id),
  action text not null,
  table_name text,
  record_id uuid,
  old_value jsonb,
  new_value jsonb,
  ip_address inet,
  created_at timestamptz not null default now()
);
create index idx_audit_record on audit_logs(table_name, record_id);
create index idx_audit_user_date on audit_logs(user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- APP SETTINGS (org-wide config — single row table)
-- ---------------------------------------------------------------------------
create table app_settings (
  id smallint primary key default 1 check (id = 1),
  business_name text not null default 'Apna Chulha Restaurant LLC',
  currency text not null default 'AED',
  timezone text not null default 'Asia/Dubai',
  default_billing_day smallint not null default 26 check (default_billing_day between 1 and 31),
  invoice_prefix text not null default 'AC-INV-',
  order_prefix text not null default 'AC-A-',
  payment_prefix text not null default 'PAY-',
  customer_prefix text not null default 'AC-CUST-',
  vat_percent numeric(5,2) not null default 0,
  contact_phone text default '+971 50 225 5710',
  contact_email text default 'orders@apnachulha.com',
  updated_at timestamptz not null default now()
);
insert into app_settings(id) values (1) on conflict do nothing;

-- ---------------------------------------------------------------------------
-- TIMESTAMP TRIGGERS
-- ---------------------------------------------------------------------------
create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end$$;

create trigger trg_touch_users        before update on users        for each row execute function touch_updated_at();
create trigger trg_touch_customers    before update on customers    for each row execute function touch_updated_at();
create trigger trg_touch_menu_items   before update on menu_items   for each row execute function touch_updated_at();
create trigger trg_touch_orders       before update on orders       for each row execute function touch_updated_at();
create trigger trg_touch_deliveries   before update on deliveries   for each row execute function touch_updated_at();
create trigger trg_touch_invoices     before update on invoices     for each row execute function touch_updated_at();
create trigger trg_touch_app_settings before update on app_settings for each row execute function touch_updated_at();

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- All tables locked down. Default deny. Policies enable per role.
-- App-server actions also enforce role checks (defense in depth).
-- ---------------------------------------------------------------------------
alter table users                  enable row level security;
alter table companies              enable row level security;
alter table customers              enable row level security;
alter table menu_items             enable row level security;
alter table daily_menus            enable row level security;
alter table daily_menu_items       enable row level security;
alter table fixed_plans            enable row level security;
alter table customer_subscriptions enable row level security;
alter table orders                 enable row level security;
alter table order_items            enable row level security;
alter table deliveries             enable row level security;
alter table invoices               enable row level security;
alter table invoice_items          enable row level security;
alter table payments               enable row level security;
alter table ledger_entries         enable row level security;
alter table approval_requests      enable row level security;
alter table audit_logs             enable row level security;
alter table app_settings           enable row level security;

-- helper: get current user's row
create or replace function current_app_user()
returns users language sql security definer set search_path = public as $$
  select * from users where id = auth.uid()
$$;

create or replace function is_active_user() returns boolean language sql stable as $$
  select exists (select 1 from users where id = auth.uid() and status = 'active')
$$;
create or replace function has_role(roles user_role[]) returns boolean language sql stable as $$
  select exists (select 1 from users where id = auth.uid() and status = 'active' and role = any(roles))
$$;

-- Generic read policy: active users can read business data
-- Generic write policies: per-role
-- Owner: full read/write everywhere
-- Manager: read all, write most (except user mgmt, settings, financial overrides)
-- Data Entry: read assigned + write orders only
-- Accounts: read all, write payments
-- Viewer: read-only

-- USERS
create policy users_read on users for select using (is_active_user() or auth.uid() = id);
create policy users_admin_all on users for all using (has_role(array['owner']::user_role[])) with check (has_role(array['owner']::user_role[]));

-- COMPANIES, MENU, FIXED PLANS, APP_SETTINGS: read for all active, write owner/manager
create policy companies_read on companies for select using (is_active_user());
create policy companies_write on companies for all using (has_role(array['owner','manager']::user_role[]));
create policy menu_read on menu_items for select using (is_active_user());
create policy menu_write on menu_items for all using (has_role(array['owner','manager']::user_role[]));
create policy daily_menus_read on daily_menus for select using (is_active_user());
create policy daily_menus_write on daily_menus for all using (has_role(array['owner','manager']::user_role[]));
create policy daily_menu_items_read on daily_menu_items for select using (is_active_user());
create policy daily_menu_items_write on daily_menu_items for all using (has_role(array['owner','manager']::user_role[]));
create policy fixed_plans_read on fixed_plans for select using (is_active_user());
create policy fixed_plans_write on fixed_plans for all using (has_role(array['owner','manager']::user_role[]));
create policy settings_read on app_settings for select using (is_active_user());
create policy settings_write on app_settings for all using (has_role(array['owner']::user_role[]));

-- CUSTOMERS: read all active, write data_entry/manager/owner
create policy customers_read on customers for select using (is_active_user());
create policy customers_write on customers for all
  using (has_role(array['owner','manager','data_entry']::user_role[]));

-- SUBSCRIPTIONS: read all, write manager/owner
create policy subs_read on customer_subscriptions for select using (is_active_user());
create policy subs_write on customer_subscriptions for all using (has_role(array['owner','manager']::user_role[]));

-- ORDERS: data_entry can insert and update only their own non-delivered orders.
-- Owner/Manager can edit anything. Voids go through approval flow (app-level).
create policy orders_read on orders for select using (is_active_user());
create policy orders_insert on orders for insert
  with check (has_role(array['owner','manager','data_entry']::user_role[]) and created_by = auth.uid());
create policy orders_update_self on orders for update
  using (has_role(array['data_entry']::user_role[]) and created_by = auth.uid() and order_status not in ('delivered','voided'))
  with check (created_by = auth.uid());
create policy orders_update_admin on orders for update using (has_role(array['owner','manager']::user_role[]));
create policy orders_delete_admin on orders for delete using (has_role(array['owner']::user_role[]));

-- ORDER_ITEMS: follow parent
create policy order_items_read on order_items for select using (is_active_user());
create policy order_items_write on order_items for all
  using (exists (select 1 from orders o where o.id = order_id
                 and (has_role(array['owner','manager']::user_role[])
                      or (has_role(array['data_entry']::user_role[]) and o.created_by = auth.uid()
                          and o.order_status not in ('delivered','voided')))));

-- DELIVERIES: read all, write data_entry/manager/owner
create policy deliveries_read on deliveries for select using (is_active_user());
create policy deliveries_write on deliveries for all
  using (has_role(array['owner','manager','data_entry']::user_role[]));

-- INVOICES + ITEMS: read all (financials guarded at app layer), write accounts/manager/owner
create policy invoices_read on invoices for select using (is_active_user());
create policy invoices_write on invoices for all using (has_role(array['owner','manager','accounts']::user_role[]));
create policy invoice_items_read on invoice_items for select using (is_active_user());
create policy invoice_items_write on invoice_items for all using (has_role(array['owner','manager','accounts']::user_role[]));

-- PAYMENTS: insert by accounts/manager/owner; void by owner only
create policy payments_read on payments for select using (is_active_user());
create policy payments_insert on payments for insert
  with check (has_role(array['owner','manager','accounts']::user_role[]) and received_by = auth.uid());
create policy payments_update_void on payments for update using (has_role(array['owner']::user_role[]));
create policy payments_delete on payments for delete using (has_role(array['owner']::user_role[]));

-- LEDGER: read all, NO direct writes (triggers handle this); owner can adjust
create policy ledger_read on ledger_entries for select using (is_active_user());
create policy ledger_write on ledger_entries for all using (has_role(array['owner']::user_role[]));

-- APPROVALS: requester can insert; everyone reads; manager/owner resolves
create policy approvals_read on approval_requests for select using (is_active_user());
create policy approvals_insert on approval_requests for insert with check (is_active_user() and requested_by = auth.uid());
create policy approvals_resolve on approval_requests for update using (has_role(array['owner','manager']::user_role[]));

-- AUDIT LOGS: read for managers+, no manual writes (only by service role)
create policy audit_read on audit_logs for select using (has_role(array['owner','manager']::user_role[]));

-- ---------------------------------------------------------------------------
-- SEQUENCES (added after initial schema — spec §8)
-- Used for atomic, race-safe number generation. App reads nextval() then formats.
-- ---------------------------------------------------------------------------
create sequence if not exists orders_seq;
create sequence if not exists payments_seq;
create sequence if not exists invoices_seq;
create sequence if not exists customers_seq;
