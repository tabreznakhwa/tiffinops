-- ============================================================================
-- Seed produce masters — vegetables & fruits for the bill scanner.
-- Run this in Supabase SQL Editor.
--
-- Scanned grocery bills constantly reference produce (potato, garlic, bhindi…)
-- that had no inventory_items row yet, so nothing auto-matched. This seeds the
-- standard Indian-kitchen produce list. Names carry both English and Hindi
-- ("Okra (Bhindi)") because lib/scan/match.ts token-matches either word, and
-- UAE bills use both. Weights default to kg; leafy bunches and count-based
-- items use bunch/pcs.
--
-- Idempotent + duplicate-safe: an item is skipped when its exact name exists
-- OR an existing item's name is contained in the new name (so a hand-created
-- "Bhindi" blocks "Okra (Bhindi)" instead of duplicating it).
-- ============================================================================

do $$
declare
  owner_id uuid;
  r record;
begin
  select id into owner_id from users where role = 'owner' order by created_at limit 1;

  for r in
    select * from (values
      -- ── Vegetables (kg) ────────────────────────────────────────────────
      ('Potato (Aloo)',              'kg',    'Vegetables'),
      ('Onion (Pyaz)',               'kg',    'Vegetables'),
      ('Tomato (Tamatar)',           'kg',    'Vegetables'),
      ('Garlic (Lehsan)',            'kg',    'Vegetables'),
      ('Ginger (Adrak)',             'kg',    'Vegetables'),
      ('Green Chilli (Hari Mirch)',  'kg',    'Vegetables'),
      ('Okra (Bhindi)',              'kg',    'Vegetables'),
      ('Eggplant (Baingan)',         'kg',    'Vegetables'),
      ('Cauliflower (Gobi)',         'kg',    'Vegetables'),
      ('Cabbage (Patta Gobi)',       'kg',    'Vegetables'),
      ('Carrot (Gajar)',             'kg',    'Vegetables'),
      ('Cucumber (Kheera)',          'kg',    'Vegetables'),
      ('Capsicum (Shimla Mirch)',    'kg',    'Vegetables'),
      ('Spinach (Palak)',            'kg',    'Vegetables'),
      ('Bottle Gourd (Lauki)',       'kg',    'Vegetables'),
      ('Ridge Gourd (Turai)',        'kg',    'Vegetables'),
      ('Bitter Gourd (Karela)',      'kg',    'Vegetables'),
      ('Ivy Gourd (Tindora)',        'kg',    'Vegetables'),
      ('Snake Gourd',                'kg',    'Vegetables'),
      ('Pumpkin (Kaddu)',            'kg',    'Vegetables'),
      ('Green Peas (Matar)',         'kg',    'Vegetables'),
      ('French Beans',               'kg',    'Vegetables'),
      ('Cluster Beans (Gawar)',      'kg',    'Vegetables'),
      ('Drumstick (Sahjan)',         'kg',    'Vegetables'),
      ('Radish (Mooli)',             'kg',    'Vegetables'),
      ('Beetroot (Chukandar)',       'kg',    'Vegetables'),
      ('Sweet Potato (Shakarkandi)', 'kg',    'Vegetables'),
      ('Turnip (Shalgam)',           'kg',    'Vegetables'),
      ('Colocasia (Arbi)',           'kg',    'Vegetables'),
      ('Raw Banana (Kacha Kela)',    'kg',    'Vegetables'),
      ('Raw Mango (Kairi)',          'kg',    'Vegetables'),
      ('Zucchini',                   'kg',    'Vegetables'),
      ('Broccoli',                   'kg',    'Vegetables'),
      ('Lettuce',                    'kg',    'Vegetables'),
      ('Sweet Corn',                 'kg',    'Vegetables'),
      ('Mushroom',                   'kg',    'Vegetables'),
      ('Lemon (Nimbu)',              'kg',    'Vegetables'),
      -- ── Leafy / bunches ────────────────────────────────────────────────
      ('Coriander Leaves (Dhania)',  'bunch', 'Vegetables'),
      ('Mint Leaves (Pudina)',       'bunch', 'Vegetables'),
      ('Fenugreek Leaves (Methi)',   'bunch', 'Vegetables'),
      ('Curry Leaves (Kadi Patta)',  'bunch', 'Vegetables'),
      ('Spring Onion',               'bunch', 'Vegetables'),
      ('Dill Leaves (Suva)',         'bunch', 'Vegetables'),
      -- ── Count-based ────────────────────────────────────────────────────
      ('Coconut (Nariyal)',          'pcs',   'Vegetables'),
      -- ── Fruits ─────────────────────────────────────────────────────────
      ('Apple (Seb)',                'kg',    'Fruits'),
      ('Banana (Kela)',              'kg',    'Fruits'),
      ('Orange (Santra)',            'kg',    'Fruits'),
      ('Mango (Aam)',                'kg',    'Fruits'),
      ('Grapes (Angoor)',            'kg',    'Fruits'),
      ('Watermelon (Tarbooz)',       'kg',    'Fruits'),
      ('Sweet Melon (Kharbooja)',    'kg',    'Fruits'),
      ('Papaya (Papita)',            'kg',    'Fruits'),
      ('Pomegranate (Anar)',         'kg',    'Fruits'),
      ('Guava (Amrood)',             'kg',    'Fruits'),
      ('Kiwi',                       'kg',    'Fruits'),
      ('Strawberry',                 'kg',    'Fruits'),
      ('Dates (Khajoor)',            'kg',    'Fruits'),
      ('Pear (Nashpati)',            'kg',    'Fruits'),
      ('Peach (Aadu)',               'kg',    'Fruits'),
      ('Plum (Aloo Bukhara)',        'kg',    'Fruits'),
      ('Apricot (Khubani)',          'kg',    'Fruits'),
      ('Fig (Anjeer)',               'kg',    'Fruits'),
      ('Chikoo (Sapodilla)',         'kg',    'Fruits'),
      ('Custard Apple (Sitaphal)',   'kg',    'Fruits'),
      ('Lychee',                     'kg',    'Fruits'),
      ('Avocado',                    'kg',    'Fruits'),
      ('Sweet Lime (Mosambi)',       'kg',    'Fruits'),
      ('Pineapple (Ananas)',         'pcs',   'Fruits')
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
