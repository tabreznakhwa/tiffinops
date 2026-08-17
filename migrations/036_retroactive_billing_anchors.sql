-- Run this in Supabase SQL Editor

-- For each PREPAID customer with active/paused subscriptions, find their
-- most recent advance payment and set billing_anchor_date to that date.
-- This retroactively re-anchors all existing subscriptions so their next
-- generated invoice will land exactly one month after they actually paid.
UPDATE customer_subscriptions sub
  SET billing_anchor_date = (
    SELECT MAX(p.payment_date)
    FROM payments p
    WHERE p.customer_id = sub.customer_id
      AND p.is_advance = true
      AND p.voided_at IS NULL
  )
  FROM customers c
  WHERE c.id = sub.customer_id
    AND c.payment_terms = 'prepaid'
    AND sub.status IN ('active', 'paused')
    AND sub.billing_anchor_date IS NULL
    AND EXISTS (
      SELECT 1 FROM payments p
      WHERE p.customer_id = sub.customer_id
        AND p.is_advance = true
        AND p.voided_at IS NULL
    );

COMMENT ON MIGRATION 035 IS 'Retroactive billing anchors for prepaid anniversary invoicing.';
