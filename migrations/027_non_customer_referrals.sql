-- Run this in Supabase SQL Editor if 026_customer_referrals.sql was already applied.

-- Allow referrals from people who are not customers.
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS referrer_name TEXT,
  ADD COLUMN IF NOT EXISTS referrer_phone TEXT;

ALTER TABLE customer_referral_rewards
  ADD COLUMN IF NOT EXISTS referrer_name TEXT,
  ADD COLUMN IF NOT EXISTS referrer_phone TEXT;

-- Existing 026 made referrer_customer_id NOT NULL. External referrers need this nullable.
ALTER TABLE customer_referral_rewards
  ALTER COLUMN referrer_customer_id DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'referral_rewards_has_referrer'
      AND conrelid = 'customer_referral_rewards'::regclass
  ) THEN
    ALTER TABLE customer_referral_rewards
      ADD CONSTRAINT referral_rewards_has_referrer
      CHECK (referrer_customer_id IS NOT NULL OR NULLIF(BTRIM(referrer_name), '') IS NOT NULL);
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_referral_rewards_external_referrer
  ON customer_referral_rewards(referrer_name, reward_month)
  WHERE referrer_customer_id IS NULL;

-- Replace reward generation so it includes external/non-customer referrers.
CREATE OR REPLACE FUNCTION generate_referral_rewards_for_month(p_month DATE DEFAULT date_trunc('month', CURRENT_DATE)::DATE)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_month DATE := date_trunc('month', p_month)::DATE;
  v_count INTEGER;
BEGIN
  INSERT INTO customer_referral_rewards (
    referrer_customer_id,
    referrer_name,
    referrer_phone,
    referred_customer_id,
    reward_month,
    amount
  )
  SELECT
    c.referred_by_customer_id,
    c.referrer_name,
    c.referrer_phone,
    c.id,
    v_month,
    c.referral_reward_amount
  FROM customers c
  WHERE (c.referred_by_customer_id IS NOT NULL OR NULLIF(BTRIM(c.referrer_name), '') IS NOT NULL)
    AND c.referral_reward_amount > 0
    AND c.status = 'active'
    AND EXISTS (
      SELECT 1
      FROM customer_subscriptions s
      WHERE s.customer_id = c.id
        AND s.status = 'active'
        AND s.start_date <= (v_month + INTERVAL '1 month - 1 day')::DATE
        AND (s.end_date IS NULL OR s.end_date >= v_month)
    )
  ON CONFLICT (referred_customer_id, reward_month)
  DO UPDATE SET
    referrer_customer_id = EXCLUDED.referrer_customer_id,
    referrer_name = EXCLUDED.referrer_name,
    referrer_phone = EXCLUDED.referrer_phone,
    amount = EXCLUDED.amount,
    updated_at = now()
  WHERE customer_referral_rewards.status = 'pending';

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
