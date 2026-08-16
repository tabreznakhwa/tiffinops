-- ============================================================
-- Migration 11: WhatsApp agent intake (DoubleTick integration)
--
-- Already applied in production on 2026-08-14 via the Supabase
-- SQL Editor. Kept here as the repo copy of record.
-- ============================================================

create table whatsapp_messages (
  id                  uuid primary key default gen_random_uuid(),
  provider            text not null default 'doubletick',
  provider_message_id text,
  direction           text not null default 'inbound'
                      check (direction in ('inbound','outbound')),
  from_phone          text not null,
  customer_id         uuid references customers(id) on delete set null,
  message_type        text not null default 'text',
  body                text,
  raw_payload         jsonb not null,
  parse_intent        text check (parse_intent in
                        ('order','skip','balance_query','other',null)),
  parse_result        jsonb,
  status              text not null default 'received'
                      check (status in ('received','parsed','draft_created',
                                        'replied','needs_review','ignored','error')),
  error_detail        text,
  order_id            uuid references orders(id) on delete set null,
  created_at          timestamptz not null default now(),
  processed_at        timestamptz
);

-- One row per provider message — the webhook's dedupe guard.
create unique index idx_wa_provider_msg
  on whatsapp_messages(provider, provider_message_id)
  where provider_message_id is not null;

create index idx_wa_phone   on whatsapp_messages(from_phone, created_at desc);
create index idx_wa_status  on whatsapp_messages(status) where status in ('received','needs_review');
create index idx_wa_customer on whatsapp_messages(customer_id, created_at desc);

create index idx_customers_whatsapp on customers(whatsapp_number)
  where whatsapp_number is not null;

-- Where an order came from. WhatsApp-sourced orders are created as
-- 'draft' — financially inert until staff confirm (ledger trigger
-- fires only on 'confirmed').
alter table orders
  add column source text not null default 'app'
  check (source in ('app','whatsapp'));

alter table orders
  add column source_message_id uuid references whatsapp_messages(id) on delete set null;

alter table whatsapp_messages enable row level security;

create policy wa_msgs_staff_read on whatsapp_messages
  for select to authenticated
  using (has_role(array['owner','manager','data_entry']::user_role[]));

create policy wa_msgs_staff_update on whatsapp_messages
  for update to authenticated
  using (has_role(array['owner','manager','data_entry']::user_role[]))
  with check (has_role(array['owner','manager','data_entry']::user_role[]));
