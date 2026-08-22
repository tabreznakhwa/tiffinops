-- ============================================================================
-- Seed beverages — water & cold drinks for the bill scanner.
-- Run this in Supabase SQL Editor.
--
-- Follow-up to 042 (produce) and 044 (pantry staples): restaurant bills also
-- carry water gallons, bottled water and soft drinks that had no
-- inventory_items row. Count-based items use pcs; cartons stay editable on
-- the review screen when a bill sells by the box.
--
-- Idempotent + duplicate-safe: an item is skipped when its exact name exists
-- OR an existing item's name is contained in the new name.
-- ============================================================================

do $$
declare
  owner_id uuid;
  r record;
begin
  select id into owner_id from users where role = 'owner' order by created_at limit 1;

  for r in
    select * from (values
      -- ── Water ──────────────────────────────────────────────────────────
      ('Water Gallon 5 Gallon',      'pcs',   'Beverages'),
      ('Water Bottle 500ml',         'pcs',   'Beverages'),
      ('Water Bottle 1.5L',          'pcs',   'Beverages'),
      ('Water Bottle 200ml',         'pcs',   'Beverages'),
      -- ── Cold drinks ────────────────────────────────────────────────────
      ('Coca Cola',                  'pcs',   'Beverages'),
      ('Pepsi',                      'pcs',   'Beverages'),
      ('Sprite',                     'pcs',   'Beverages'),
      ('Fanta',                      'pcs',   'Beverages'),
      ('7Up',                        'pcs',   'Beverages'),
      ('Mirinda',                    'pcs',   'Beverages'),
      ('Mountain Dew',               'pcs',   'Beverages'),
      ('Soda Water',                 'pcs',   'Beverages'),
      ('Red Bull',                   'pcs',   'Beverages'),
      -- ── Juices & dairy drinks ──────────────────────────────────────────
      ('Fruit Juice',                'pcs',   'Beverages'),
      ('Mango Juice',                'pcs',   'Beverages'),
      ('Orange Juice',               'pcs',   'Beverages'),
      ('Laban',                      'pcs',   'Beverages'),
      ('Lassi',                      'pcs',   'Beverages'),
      ('Buttermilk (Chaas)',         'l',     'Beverages'),
      ('Ice Cubes',                  'kg',    'Beverages')
    ) as t(item_name, unit, cat)
  loop
    if not exists (
      select 1 from inventory_items i
      where lower(i.name) = lower(r.item_name)
         or position(lower(i.name) in lower(r.item_name)) > 0
    ) then
      insert into inventory_items (item_code, name, unit_of_measure, category, created_by)
      values (next_inventory_item_code(), r.item_name, r.unit, r.cat, owner_id);
    end if;
  end loop;
end $$;
