-- ============================================================================
-- FAQ facts — flat list of facts the WhatsApp agent may state verbatim to
-- customers (delivery hours, zones, holidays, etc.). Run this in Supabase SQL
-- Editor. See lib/whatsapp/chat.ts for how these are injected into the prompt.
-- ============================================================================

create table faq_facts (
  id uuid primary key default gen_random_uuid(),
  fact text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_faq_facts_active on faq_facts(is_active);

create trigger trg_touch_faq_facts before update on faq_facts
  for each row execute function touch_updated_at();
create trigger audit_faq_facts after insert or update or delete on public.faq_facts
  for each row execute function public.audit_trigger_func();

alter table faq_facts enable row level security;

-- Read: any active user (same tier as suppliers_read). Write: owner only —
-- these facts are quoted verbatim to customers by the AI agent, same
-- sensitivity tier as app_settings/business identity, not day-to-day
-- operational data like the menu.
create policy faq_facts_read  on faq_facts for select using (is_active_user());
create policy faq_facts_write on faq_facts for all    using (has_role(array['owner']::user_role[]));
