-- ============================================================================
-- Inventory v2 — owner corrections + AI Cost Advisor.
-- Run this in Supabase SQL Editor.
--
-- 1. Purchases become correctable by the OWNER only, always with a reason:
--    - void: soft-delete (voided_at/voided_by/void_reason) — stock is
--      reversed app-side with adjustment transactions, the row stays for
--      the audit trail (same pattern as payments/orders void).
--    - edit: last edit is stamped (edited_at/edited_by/edit_reason); the
--      full before/after snapshot is already captured by audit_purchases.
-- 2. ai_insight_reports stores generated AI analyses (cost-cutting
--    recommendations) so the latest report persists between visits.
-- ============================================================================

alter table purchases
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by uuid references users(id),
  add column if not exists void_reason text,
  add column if not exists edited_at timestamptz,
  add column if not exists edited_by uuid references users(id),
  add column if not exists edit_reason text;

comment on column purchases.voided_at is 'Soft-void timestamp — stock already reversed via adjustment transactions';
comment on column purchases.edit_reason is 'Owner''s mandatory reason for the most recent edit (full history in audit_logs)';

-- ── AI insight reports ──────────────────────────────────────────────────────

create table if not exists ai_insight_reports (
  id uuid primary key default gen_random_uuid(),
  scope text not null default 'inventory',
  report jsonb not null,
  period_from date,
  period_to date,
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_ai_insight_reports_scope_created
  on ai_insight_reports (scope, created_at desc);

alter table ai_insight_reports enable row level security;

drop policy if exists ai_insight_reports_read on ai_insight_reports;
create policy ai_insight_reports_read on ai_insight_reports
  for select using (is_active_user());

drop policy if exists ai_insight_reports_write on ai_insight_reports;
create policy ai_insight_reports_write on ai_insight_reports
  for all using (has_role(array['owner','manager']::user_role[]));

notify pgrst, 'reload schema';
