-- Run this in Supabase SQL Editor

-- Per-meal price breakdown for multi-meal plans, so a single paused meal
-- (e.g. Breakfast) can be billed separately. NULL means "even split" for
-- single-meal plans, or legacy subscriptions created before this feature.
ALTER TABLE customer_subscriptions
  ADD COLUMN IF NOT EXISTS meal_prices JSONB;

-- Lets a shift-working customer stop just one meal for a date range while the
-- rest of their plan keeps running. Billing prorates the paused meal on a
-- per-day basis — see lib/fixed-menu/proration.ts.
-- No RLS: all writes/reads go through server actions using the service_role
-- admin client, same as every other fixed-menu table in this project.
CREATE TABLE IF NOT EXISTS subscription_meal_pauses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id UUID NOT NULL REFERENCES customer_subscriptions(id) ON DELETE CASCADE,
  meal_period meal_period NOT NULL,
  pause_start DATE NOT NULL,
  pause_end DATE,
  reason TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (pause_end IS NULL OR pause_end >= pause_start)
);

CREATE INDEX IF NOT EXISTS idx_meal_pauses_subscription ON subscription_meal_pauses(subscription_id);

-- Enforce "one open pause per meal per subscription" at the DB level too
-- (actions.ts already checks this, but a partial unique index closes the race).
CREATE UNIQUE INDEX IF NOT EXISTS idx_meal_pauses_one_open_per_meal
  ON subscription_meal_pauses(subscription_id, meal_period)
  WHERE pause_end IS NULL;
