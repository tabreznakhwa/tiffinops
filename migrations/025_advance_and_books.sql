-- Run this in Supabase SQL Editor

-- 1. Advance payment flag on payments
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS is_advance BOOLEAN NOT NULL DEFAULT false;

-- 2. Opening balances on app_settings (for Cash Book and Bank Book)
ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS cash_opening_balance NUMERIC(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bank_opening_balance NUMERIC(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS opening_balance_date DATE DEFAULT CURRENT_DATE;
