-- ============================================================================
-- Fix idx_invoices_idempotent to exclude cancelled invoices.
-- Run this in Supabase SQL Editor.
--
-- idx_invoices_idempotent (01_schema.sql) is a unique index on
-- (customer_id, invoice_type, billing_period_start), meant only to stop a
-- same-day cron re-run from double-billing a period. It was never scoped to
-- exclude cancelled invoices, so once ANY invoice for a given
-- (customer, type, period) is cancelled, that period becomes permanently
-- unbillable — a legitimate cancel-and-reissue (correcting a mistaken
-- invoice, splitting a lumped one, etc.) hits
-- "duplicate key value violates unique constraint idx_invoices_idempotent"
-- on the replacement insert, because the cancelled row still occupies the
-- slot. This bit the Sep 2026 anniversary-billing correction for
-- Nazir/Hammad/Awaiz/Ahmed (worked around there via UPDATE-in-place on the
-- cancelled row instead of INSERT) and will recur for any future
-- cancel-and-replace of a fixed_monthly/prepaid_monthly invoice.
-- ============================================================================

drop index if exists idx_invoices_idempotent;

create unique index idx_invoices_idempotent on invoices(customer_id, invoice_type, billing_period_start)
  where billing_period_start is not null and status <> 'cancelled';
