-- =============================================================================
-- TiffinOps — Add 'packer' role to user_role enum
-- Run once in Supabase SQL Editor
-- =============================================================================

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'packer';
