-- ============================================================================
-- Duplicate-scan detection — store the supplier's own invoice number.
-- Run this in Supabase SQL Editor.
--
-- The scanner extracts the bill's printed invoice number ("277006"). It is
-- saved on purchases/expenses so a re-scan of the same document can be
-- flagged on the review screen before it double-posts stock. Warning only,
-- not a unique constraint — different suppliers can reuse numbers, and
-- handwritten bills have none.
-- ============================================================================

alter table purchases
  add column if not exists supplier_invoice_no text;

alter table expenses
  add column if not exists supplier_invoice_no text;

create index if not exists idx_purchases_supplier_invoice_no
  on purchases (supplier_invoice_no) where supplier_invoice_no is not null;

create index if not exists idx_expenses_supplier_invoice_no
  on expenses (supplier_invoice_no) where supplier_invoice_no is not null;

notify pgrst, 'reload schema';
