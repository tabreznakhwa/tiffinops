-- ============================================================================
-- Add an optional cost_price to menu_items.
-- Run this in Supabase SQL Editor.
--
-- Lets us track what we pay a vendor for an item we don't cook ourselves
-- (e.g. Moti Roti / Rumali Roti, bought ready-made from an outside supplier)
-- alongside the selling price (default_price) that's already there. NULL
-- means cost isn't tracked for that item — the Daily Report only shows a
-- Cost/Profit column for items where this is set.
-- ============================================================================

alter table menu_items
  add column if not exists cost_price numeric(12,2) check (cost_price is null or cost_price >= 0);

comment on column menu_items.cost_price is
  'Optional purchase/vendor cost per unit, e.g. for ready-made items bought from an outside supplier. NULL = cost not tracked. Used to compute profit in the Daily Report.';
