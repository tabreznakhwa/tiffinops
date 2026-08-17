-- Run this in Supabase SQL Editor

-- Reverts 035/036. The advance-payment re-anchoring model was wrong:
-- a prepaid customer's due dates follow their subscription START date
-- (start + N months, where N = months actually paid for), not the day
-- an advance payment happened to be recorded. Next-due is now computed
-- from start_date + payments, so the anchor column is unused.
ALTER TABLE customer_subscriptions
  DROP COLUMN IF EXISTS billing_anchor_date;
