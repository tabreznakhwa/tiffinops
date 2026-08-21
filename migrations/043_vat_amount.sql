-- ============================================================================
-- VAT capture on purchases & expenses.
-- Run this in Supabase SQL Editor.
--
-- Scanned UAE bills carry 5% VAT, but purchases stored only the ex-VAT line
-- subtotal (total_amount was set equal to subtotal) and expenses had no VAT
-- breakdown at all. These columns record the VAT portion so total_amount can
-- be subtotal + VAT and the input-VAT figure is available for tax reporting.
-- ============================================================================

alter table purchases add column if not exists vat_amount numeric(12,2) not null default 0 check (vat_amount >= 0);
alter table expenses  add column if not exists vat_amount numeric(12,2) not null default 0 check (vat_amount >= 0);

-- PostgREST caches the schema — reload so the API sees the new columns.
notify pgrst, 'reload schema';
