-- Run this in Supabase SQL Editor

-- Track who referred a new customer, plus the monthly cash reward.
-- Referrer can be an existing customer or an outside/non-customer person.
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS referred_by_customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS referrer_name TEXT,
  ADD COLUMN IF NOT EXISTS referrer_phone TEXT,
  ADD COLUMN IF NOT EXISTS referral_reward_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (referral_reward_amount >= 0);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'customers_no_self_referral'
      AND conrelid = 'customers'::regclass
  ) THEN
    ALTER TABLE customers
      ADD CONSTRAINT customers_no_self_referral CHECK (referred_by_customer_id IS NULL OR referred_by_customer_id <> id);
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_customers_referred_by ON customers(referred_by_customer_id) WHERE referred_by_customer_id IS NOT NULL;

-- Monthly reward eligibility: one row per referred customer per active tiffin month.
CREATE TABLE IF NOT EXISTS customer_referral_rewards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  referrer_name TEXT,
  referrer_phone TEXT,
  referred_customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  reward_month DATE NOT NULL,
  amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','cancelled')),
  paid_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (referred_customer_id, reward_month)
);

CREATE INDEX IF NOT EXISTS idx_referral_rewards_referrer_month ON customer_referral_rewards(referrer_customer_id, reward_month);
CREATE INDEX IF NOT EXISTS idx_referral_rewards_external_referrer ON customer_referral_rewards(referrer_name, reward_month) WHERE referrer_customer_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_referral_rewards_status ON customer_referral_rewards(status);

-- Regenerate pending rewards for customers with active tiffin subscriptions.
-- Run for the month you are closing, e.g. SELECT generate_referral_rewards_for_month('2026-07-01');
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
