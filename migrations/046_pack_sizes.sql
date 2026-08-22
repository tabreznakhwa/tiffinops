-- ============================================================================
-- Pack sizes — buy in cartons/tins, stock in kg/l/pcs.
-- Run this in Supabase SQL Editor.
--
-- Suppliers bill pack units ("2 CT chicken breast @ 113"), but a carton's
-- contents vary per purchase (12 kg boneless, 10 kg whole; 17-18 l per oil
-- tin). Inventory must stay in base units for consumption tracking and food
-- costing, so the scanner converts at review time:
--   purchase_items stores the converted base quantity + per-base-unit price,
--   PLUS the original pack breakdown (pack_qty x pack_size pack_unit) for
--   audit against the paper bill.
--   inventory_items remembers the last pack configuration so the next scan
--   of the same item prefills "12 kg per carton".
-- ============================================================================

alter table inventory_items
  add column if not exists pack_unit text,
  add column if not exists pack_size numeric(10,3);

comment on column inventory_items.pack_unit is 'How this item is usually bought (carton/tin/bag) — prefills the scanner';
comment on column inventory_items.pack_size is 'Base units (kg/l/pcs) per pack on the last purchase';

alter table purchase_items
  add column if not exists pack_qty numeric(10,3),
  add column if not exists pack_size numeric(10,3),
  add column if not exists pack_unit text;

comment on column purchase_items.pack_qty is 'Packs bought as printed on the bill (quantity/unit_price stay in base units)';

notify pgrst, 'reload schema';
