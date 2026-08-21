-- ============================================================================
-- Supplier TRN — UAE VAT Tax Registration Number on suppliers.
-- Needed by the bill scanner: handwritten invoices often carry only a TRN
-- stamp, and the review screen lets the user capture it when creating the
-- supplier inline. Run this in Supabase SQL Editor.
-- ============================================================================

alter table suppliers add column if not exists trn text;
