-- Run this in Supabase SQL Editor

-- Billing anchor for prepaid anniversary invoicing.
-- NULL = bill on the start_date anniversary (current behavior).
-- Set automatically to the payment date whenever an ADVANCE payment is
-- recorded for a PREPAID customer, so their next invoice lands exactly
-- one month after they actually paid — without touching start_date
-- (which drives charge history in the Outstanding report).
ALTER TABLE customer_subscriptions
  ADD COLUMN IF NOT EXISTS billing_anchor_date date;

COMMENT ON COLUMN customer_subscriptions.billing_anchor_date IS
  'Anniversary anchor for prepaid billing; falls back to start_date when NULL. Auto-set to the latest advance payment date.';
