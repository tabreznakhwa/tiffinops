-- ============================================================================
-- Seed pantry staples — oils, flours, rice, dals, spices, dairy & dry goods.
-- Run this in Supabase SQL Editor.
--
-- Follow-up to 042 (produce): scanned bills also reference kitchen staples
-- ("Cooking Oil", "Toor Dal", "Atta"…) with no inventory_items row, so
-- nothing auto-matched. Same dual English/Hindi naming so lib/scan/match.ts
-- token-matches whichever word the bill prints.
--
-- Idempotent + duplicate-safe: an item is skipped when its exact name exists
-- OR an existing item's name is contained in the new name (so a hand-created
-- "Oil" blocks "Cooking Oil" instead of duplicating it).
-- ============================================================================

do $$
declare
  owner_id uuid;
  r record;
begin
  select id into owner_id from users where role = 'owner' order by created_at limit 1;

  for r in
    select * from (values
      -- ── Oils & fats ────────────────────────────────────────────────────
      ('Cooking Oil',                'l',     'Oils & Fats'),
      ('Sunflower Oil',              'l',     'Oils & Fats'),
      ('Mustard Oil (Sarson)',       'l',     'Oils & Fats'),
      ('Coconut Oil',                'l',     'Oils & Fats'),
      ('Olive Oil',                  'l',     'Oils & Fats'),
      ('Ghee (Desi Ghee)',           'kg',    'Oils & Fats'),
      ('Butter (Makhan)',            'kg',    'Oils & Fats'),
      -- ── Flours & grains ────────────────────────────────────────────────
      ('Wheat Flour (Atta)',         'kg',    'Flours & Grains'),
      ('All Purpose Flour (Maida)',  'kg',    'Flours & Grains'),
      ('Gram Flour (Besan)',         'kg',    'Flours & Grains'),
      ('Semolina (Sooji Rava)',      'kg',    'Flours & Grains'),
      ('Rice Flour',                 'kg',    'Flours & Grains'),
      ('Basmati Rice',               'kg',    'Flours & Grains'),
      ('Poha (Flattened Rice)',      'kg',    'Flours & Grains'),
      ('Vermicelli (Seviyan)',       'kg',    'Flours & Grains'),
      ('Oats',                       'kg',    'Flours & Grains'),
      -- ── Dals & pulses ──────────────────────────────────────────────────
      ('Toor Dal (Arhar)',           'kg',    'Dals & Pulses'),
      ('Moong Dal',                  'kg',    'Dals & Pulses'),
      ('Chana Dal',                  'kg',    'Dals & Pulses'),
      ('Masoor Dal',                 'kg',    'Dals & Pulses'),
      ('Urad Dal',                   'kg',    'Dals & Pulses'),
      ('Chickpeas (Kabuli Chana)',   'kg',    'Dals & Pulses'),
      ('Black Chana (Kala Chana)',   'kg',    'Dals & Pulses'),
      ('Kidney Beans (Rajma)',       'kg',    'Dals & Pulses'),
      -- ── Spices & masala ────────────────────────────────────────────────
      ('Salt (Namak)',               'kg',    'Spices'),
      ('Sugar (Cheeni)',             'kg',    'Spices'),
      ('Jaggery (Gud)',              'kg',    'Spices'),
      ('Turmeric Powder (Haldi)',    'kg',    'Spices'),
      ('Red Chilli Powder (Lal Mirch)', 'kg', 'Spices'),
      ('Coriander Powder (Dhania Powder)', 'kg', 'Spices'),
      ('Cumin Seeds (Jeera)',        'kg',    'Spices'),
      ('Mustard Seeds (Rai)',        'kg',    'Spices'),
      ('Garam Masala',               'kg',    'Spices'),
      ('Black Pepper (Kali Mirch)',  'kg',    'Spices'),
      ('Cardamom (Elaichi)',         'kg',    'Spices'),
      ('Cloves (Laung)',             'kg',    'Spices'),
      ('Cinnamon (Dalchini)',        'kg',    'Spices'),
      ('Bay Leaf (Tej Patta)',       'kg',    'Spices'),
      ('Fenugreek Seeds (Methi Dana)', 'kg',  'Spices'),
      ('Asafoetida (Hing)',          'kg',    'Spices'),
      ('Dry Red Chilli (Sukhi Mirch)', 'kg',  'Spices'),
      ('Tamarind (Imli)',            'kg',    'Spices'),
      ('Chaat Masala',               'kg',    'Spices'),
      ('Kasuri Methi',               'kg',    'Spices'),
      -- ── Dairy & eggs ───────────────────────────────────────────────────
      ('Milk (Doodh)',               'l',     'Dairy'),
      ('Yogurt (Dahi Curd)',         'kg',    'Dairy'),
      ('Paneer',                     'kg',    'Dairy'),
      ('Fresh Cream',                'l',     'Dairy'),
      ('Cheese',                     'kg',    'Dairy'),
      ('Eggs (Anda)',                'pcs',   'Dairy'),
      -- ── Dry goods & misc ───────────────────────────────────────────────
      ('Tea (Chai Patti)',           'kg',    'Dry Goods'),
      ('Coffee',                     'kg',    'Dry Goods'),
      ('Cashew (Kaju)',              'kg',    'Dry Goods'),
      ('Almonds (Badam)',            'kg',    'Dry Goods'),
      ('Raisins (Kishmish)',         'kg',    'Dry Goods'),
      ('Peanuts (Moongphali)',       'kg',    'Dry Goods'),
      ('Desiccated Coconut (Copra)', 'kg',    'Dry Goods'),
      ('Papad',                      'packet','Dry Goods'),
      ('Pickle (Achar)',             'kg',    'Dry Goods'),
      ('Tomato Ketchup',             'kg',    'Dry Goods'),
      ('Vinegar (Sirka)',            'l',     'Dry Goods'),
      ('Baking Soda',                'kg',    'Dry Goods'),
      ('Cornflour',                  'kg',    'Dry Goods'),
      ('Bread',                      'pcs',   'Dry Goods'),
      ('Chicken',                    'kg',    'Meat & Fish'),
      ('Mutton',                     'kg',    'Meat & Fish'),
      ('Fish (Machli)',              'kg',    'Meat & Fish')
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
