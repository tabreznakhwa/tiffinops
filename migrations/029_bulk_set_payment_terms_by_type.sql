-- Run this in Supabase SQL Editor
-- One-time backfill: set payment_terms on existing customers based on plan type.
-- A La Carte / Hybrid customers are billed from delivered orders after the fact -> postpaid.
-- Fixed Menu (tiffin subscription) customers are billed in advance -> prepaid.
-- New customers still default to 'prepaid' and can be changed per-customer at any time.

UPDATE customers
SET payment_terms = 'postpaid'
WHERE customer_type IN ('a_la_carte', 'hybrid');

UPDATE customers
SET payment_terms = 'prepaid'
WHERE customer_type = 'fixed_menu';
