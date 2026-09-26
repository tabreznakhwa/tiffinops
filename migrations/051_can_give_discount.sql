-- ============================================================================
-- Add a per-user "give discount" permission override.
-- Run this in Supabase SQL Editor.
--
-- applyInvoiceDiscount() (used by Outstanding's month-wise discount button
-- and Record Payment's per-invoice discount button) was owner-only. This
-- lets the owner grant that ability to a specific non-owner staff member
-- (e.g. an accounts person who handles goodwill discounts) without making
-- them a full owner — same override pattern as can_record_payment /
-- can_see_financials / can_export_reports: NULL = use the role default
-- (owner only), true/false = explicit per-user override.
--
-- Does NOT affect the separate row-level "Settle with discount / write-off"
-- flow in Outstanding (createBalanceAdjustment) — that stays owner-only,
-- since write-off is a broader action than a single invoice discount.
-- ============================================================================

alter table users
  add column if not exists can_give_discount boolean;

comment on column users.can_give_discount is
  'Per-user override for applyInvoiceDiscount() (Outstanding month-wise + Record Payment per-invoice discount). NULL = role default (owner only), true/false = explicit override.';
