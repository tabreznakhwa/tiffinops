-- Run this in Supabase SQL Editor

-- Prepaid customers pay in advance (current default behavior for fixed-plan billing).
-- Postpaid customers are invoiced after the billing month completes.
DO $$ BEGIN
  CREATE TYPE payment_terms AS ENUM ('prepaid', 'postpaid');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS payment_terms payment_terms NOT NULL DEFAULT 'prepaid';
