// Common raw materials / supplies used by Indian, Pakistani and Indo-Chinese
// restaurants — a quick-pick catalog for the "Add Item" search dropdown.
// Purely a UI convenience list: picking an entry pre-fills name/category/unit,
// but any name can still be typed freely and added.

export type CatalogItem = { name: string; category: string; unit_of_measure: string }

export const INVENTORY_CATALOG: CatalogItem[] = [
  // Rice & Grains
  { name: 'Basmati Rice', category: 'Rice & Grains', unit_of_measure: 'kg' },
  { name: 'Sona Masoori Rice', category: 'Rice & Grains', unit_of_measure: 'kg' },
  { name: 'Sella Rice', category: 'Rice & Grains', unit_of_measure: 'kg' },
  { name: 'Broken Rice', category: 'Rice & Grains', unit_of_measure: 'kg' },
  { name: 'Brown Rice', category: 'Rice & Grains', unit_of_measure: 'kg' },
  { name: 'Poha (Flattened Rice)', category: 'Rice & Grains', unit_of_measure: 'kg' },
  { name: 'Sooji / Rava', category: 'Rice & Grains', unit_of_measure: 'kg' },
  { name: 'Vermicelli (Semiya)', category: 'Rice & Grains', unit_of_measure: 'kg' },
  { name: 'Puffed Rice (Murmura)', category: 'Rice & Grains', unit_of_measure: 'kg' },
  { name: 'Rice Flour', category: 'Rice & Grains', unit_of_measure: 'kg' },

  // Flours & Lentils
  { name: 'Wheat Flour (Atta)', category: 'Flours & Lentils', unit_of_measure: 'kg' },
  { name: 'Maida (Refined Flour)', category: 'Flours & Lentils', unit_of_measure: 'kg' },
  { name: 'Besan (Gram Flour)', category: 'Flours & Lentils', unit_of_measure: 'kg' },
  { name: 'Corn Flour', category: 'Flours & Lentils', unit_of_measure: 'kg' },
  { name: 'Toor Dal', category: 'Flours & Lentils', unit_of_measure: 'kg' },
  { name: 'Chana Dal', category: 'Flours & Lentils', unit_of_measure: 'kg' },
  { name: 'Moong Dal', category: 'Flours & Lentils', unit_of_measure: 'kg' },
  { name: 'Urad Dal', category: 'Flours & Lentils', unit_of_measure: 'kg' },
  { name: 'Masoor Dal', category: 'Flours & Lentils', unit_of_measure: 'kg' },
  { name: 'Rajma (Kidney Beans)', category: 'Flours & Lentils', unit_of_measure: 'kg' },
  { name: 'Kabuli Chana (Chickpeas)', category: 'Flours & Lentils', unit_of_measure: 'kg' },
  { name: 'Kala Chana', category: 'Flours & Lentils', unit_of_measure: 'kg' },

  // Oils & Fats
  { name: 'Sunflower Oil', category: 'Oils & Fats', unit_of_measure: 'l' },
  { name: 'Refined Oil', category: 'Oils & Fats', unit_of_measure: 'l' },
  { name: 'Mustard Oil', category: 'Oils & Fats', unit_of_measure: 'l' },
  { name: 'Groundnut Oil', category: 'Oils & Fats', unit_of_measure: 'l' },
  { name: 'Sesame Oil', category: 'Oils & Fats', unit_of_measure: 'l' },
  { name: 'Ghee', category: 'Oils & Fats', unit_of_measure: 'kg' },
  { name: 'Butter', category: 'Oils & Fats', unit_of_measure: 'kg' },

  // Spices & Masalas
  { name: 'Turmeric Powder', category: 'Spices & Masalas', unit_of_measure: 'kg' },
  { name: 'Red Chilli Powder', category: 'Spices & Masalas', unit_of_measure: 'kg' },
  { name: 'Kashmiri Chilli Powder', category: 'Spices & Masalas', unit_of_measure: 'kg' },
  { name: 'Coriander Powder', category: 'Spices & Masalas', unit_of_measure: 'kg' },
  { name: 'Cumin Powder', category: 'Spices & Masalas', unit_of_measure: 'kg' },
  { name: 'Cumin Seeds (Jeera)', category: 'Spices & Masalas', unit_of_measure: 'kg' },
  { name: 'Mustard Seeds (Rai)', category: 'Spices & Masalas', unit_of_measure: 'kg' },
  { name: 'Fennel Seeds (Saunf)', category: 'Spices & Masalas', unit_of_measure: 'kg' },
  { name: 'Fenugreek Seeds (Methi)', category: 'Spices & Masalas', unit_of_measure: 'kg' },
  { name: 'Kasuri Methi', category: 'Spices & Masalas', unit_of_measure: 'kg' },
  { name: 'Garam Masala', category: 'Spices & Masalas', unit_of_measure: 'kg' },
  { name: 'Chaat Masala', category: 'Spices & Masalas', unit_of_measure: 'kg' },
  { name: 'Biryani Masala', category: 'Spices & Masalas', unit_of_measure: 'kg' },
  { name: 'Tandoori Masala', category: 'Spices & Masalas', unit_of_measure: 'kg' },
  { name: 'Chole Masala', category: 'Spices & Masalas', unit_of_measure: 'kg' },
  { name: 'Pav Bhaji Masala', category: 'Spices & Masalas', unit_of_measure: 'kg' },
  { name: 'Sambhar Powder', category: 'Spices & Masalas', unit_of_measure: 'kg' },
  { name: 'Rasam Powder', category: 'Spices & Masalas', unit_of_measure: 'kg' },
  { name: 'Amchur (Dry Mango Powder)', category: 'Spices & Masalas', unit_of_measure: 'kg' },
  { name: 'Hing (Asafoetida)', category: 'Spices & Masalas', unit_of_measure: 'kg' },
  { name: 'Green Cardamom', category: 'Spices & Masalas', unit_of_measure: 'kg' },
  { name: 'Black Cardamom', category: 'Spices & Masalas', unit_of_measure: 'kg' },
  { name: 'Cloves', category: 'Spices & Masalas', unit_of_measure: 'kg' },
  { name: 'Cinnamon Stick', category: 'Spices & Masalas', unit_of_measure: 'kg' },
  { name: 'Bay Leaf (Tej Patta)', category: 'Spices & Masalas', unit_of_measure: 'kg' },
  { name: 'Black Pepper', category: 'Spices & Masalas', unit_of_measure: 'kg' },
  { name: 'Salt', category: 'Spices & Masalas', unit_of_measure: 'kg' },
  { name: 'Sugar', category: 'Spices & Masalas', unit_of_measure: 'kg' },

  // Fresh Vegetables & Herbs
  { name: 'Onion', category: 'Vegetables', unit_of_measure: 'kg' },
  { name: 'Tomato', category: 'Vegetables', unit_of_measure: 'kg' },
  { name: 'Potato', category: 'Vegetables', unit_of_measure: 'kg' },
  { name: 'Ginger', category: 'Vegetables', unit_of_measure: 'kg' },
  { name: 'Garlic', category: 'Vegetables', unit_of_measure: 'kg' },
  { name: 'Green Chilli', category: 'Vegetables', unit_of_measure: 'kg' },
  { name: 'Capsicum', category: 'Vegetables', unit_of_measure: 'kg' },
  { name: 'Cabbage', category: 'Vegetables', unit_of_measure: 'kg' },
  { name: 'Cauliflower', category: 'Vegetables', unit_of_measure: 'kg' },
  { name: 'Carrot', category: 'Vegetables', unit_of_measure: 'kg' },
  { name: 'French Beans', category: 'Vegetables', unit_of_measure: 'kg' },
  { name: 'Green Peas', category: 'Vegetables', unit_of_measure: 'kg' },
  { name: 'Spinach (Palak)', category: 'Vegetables', unit_of_measure: 'kg' },
  { name: 'Coriander Leaves', category: 'Vegetables', unit_of_measure: 'kg' },
  { name: 'Mint Leaves', category: 'Vegetables', unit_of_measure: 'kg' },
  { name: 'Lemon', category: 'Vegetables', unit_of_measure: 'kg' },
  { name: 'Curry Leaves', category: 'Vegetables', unit_of_measure: 'kg' },
  { name: 'Spring Onion', category: 'Vegetables', unit_of_measure: 'kg' },

  // Dairy & Paneer
  { name: 'Milk', category: 'Dairy & Paneer', unit_of_measure: 'l' },
  { name: 'Paneer', category: 'Dairy & Paneer', unit_of_measure: 'kg' },
  { name: 'Curd (Yogurt)', category: 'Dairy & Paneer', unit_of_measure: 'kg' },
  { name: 'Fresh Cream', category: 'Dairy & Paneer', unit_of_measure: 'l' },
  { name: 'Cheese', category: 'Dairy & Paneer', unit_of_measure: 'kg' },
  { name: 'Khoya (Mawa)', category: 'Dairy & Paneer', unit_of_measure: 'kg' },
  { name: 'Malai', category: 'Dairy & Paneer', unit_of_measure: 'kg' },

  // Meat, Poultry & Seafood
  { name: 'Chicken (Whole)', category: 'Meat, Poultry & Seafood', unit_of_measure: 'kg' },
  { name: 'Chicken (Boneless)', category: 'Meat, Poultry & Seafood', unit_of_measure: 'kg' },
  { name: 'Mutton', category: 'Meat, Poultry & Seafood', unit_of_measure: 'kg' },
  { name: 'Fish', category: 'Meat, Poultry & Seafood', unit_of_measure: 'kg' },
  { name: 'Prawns', category: 'Meat, Poultry & Seafood', unit_of_measure: 'kg' },
  { name: 'Eggs', category: 'Meat, Poultry & Seafood', unit_of_measure: 'dozen' },

  // Indo-Chinese Sauces & Condiments
  { name: 'Soy Sauce', category: 'Sauces & Condiments', unit_of_measure: 'l' },
  { name: 'Dark Soy Sauce', category: 'Sauces & Condiments', unit_of_measure: 'l' },
  { name: 'Vinegar', category: 'Sauces & Condiments', unit_of_measure: 'l' },
  { name: 'Green Chilli Sauce', category: 'Sauces & Condiments', unit_of_measure: 'l' },
  { name: 'Red Chilli Sauce', category: 'Sauces & Condiments', unit_of_measure: 'l' },
  { name: 'Schezwan Sauce', category: 'Sauces & Condiments', unit_of_measure: 'l' },
  { name: 'Chilli Garlic Sauce', category: 'Sauces & Condiments', unit_of_measure: 'l' },
  { name: 'Tomato Ketchup', category: 'Sauces & Condiments', unit_of_measure: 'l' },
  { name: 'Ajinomoto (MSG)', category: 'Sauces & Condiments', unit_of_measure: 'kg' },
  { name: 'White Pepper Powder', category: 'Sauces & Condiments', unit_of_measure: 'kg' },
  { name: 'Hoisin Sauce', category: 'Sauces & Condiments', unit_of_measure: 'l' },
  { name: 'Oyster Sauce', category: 'Sauces & Condiments', unit_of_measure: 'l' },
  { name: 'Mayonnaise', category: 'Sauces & Condiments', unit_of_measure: 'kg' },

  // Bakery & Leavening
  { name: 'Yeast', category: 'Bakery & Leavening', unit_of_measure: 'kg' },
  { name: 'Baking Powder', category: 'Bakery & Leavening', unit_of_measure: 'kg' },
  { name: 'Baking Soda', category: 'Bakery & Leavening', unit_of_measure: 'kg' },
  { name: 'Food Color', category: 'Bakery & Leavening', unit_of_measure: 'packet' },

  // Beverages
  { name: 'Tea Powder', category: 'Beverages', unit_of_measure: 'kg' },
  { name: 'Coffee Powder', category: 'Beverages', unit_of_measure: 'kg' },
  { name: 'Mineral Water Bottle', category: 'Beverages', unit_of_measure: 'pcs' },
  { name: 'Soft Drink Bottle', category: 'Beverages', unit_of_measure: 'pcs' },
  { name: 'Rooh Afza / Squash', category: 'Beverages', unit_of_measure: 'l' },

  // Disposables & Packaging
  { name: 'Aluminium Foil Roll', category: 'Disposables & Packaging', unit_of_measure: 'pcs' },
  { name: 'Cling Film Roll', category: 'Disposables & Packaging', unit_of_measure: 'pcs' },
  { name: 'Parcel Box - Small', category: 'Disposables & Packaging', unit_of_measure: 'pcs' },
  { name: 'Parcel Box - Medium', category: 'Disposables & Packaging', unit_of_measure: 'pcs' },
  { name: 'Parcel Box - Large', category: 'Disposables & Packaging', unit_of_measure: 'pcs' },
  { name: 'Paper Bag', category: 'Disposables & Packaging', unit_of_measure: 'pcs' },
  { name: 'Plastic Carry Bag', category: 'Disposables & Packaging', unit_of_measure: 'pcs' },
  { name: 'Disposable Plate', category: 'Disposables & Packaging', unit_of_measure: 'pcs' },
  { name: 'Disposable Bowl', category: 'Disposables & Packaging', unit_of_measure: 'pcs' },
  { name: 'Disposable Spoon', category: 'Disposables & Packaging', unit_of_measure: 'pcs' },
  { name: 'Disposable Fork', category: 'Disposables & Packaging', unit_of_measure: 'pcs' },
  { name: 'Paper Straw', category: 'Disposables & Packaging', unit_of_measure: 'pcs' },
  { name: 'Tissue Napkin', category: 'Disposables & Packaging', unit_of_measure: 'packet' },
  { name: 'Butter Paper', category: 'Disposables & Packaging', unit_of_measure: 'pcs' },
  { name: 'Garbage Bag', category: 'Disposables & Packaging', unit_of_measure: 'packet' },
  { name: 'Disposable Gloves', category: 'Disposables & Packaging', unit_of_measure: 'box' },
  { name: 'Sauce Cup with Lid', category: 'Disposables & Packaging', unit_of_measure: 'pcs' },
  { name: 'Paper Cup', category: 'Disposables & Packaging', unit_of_measure: 'pcs' },
  { name: 'Take-away Container with Lid', category: 'Disposables & Packaging', unit_of_measure: 'pcs' },
  { name: 'Toothpick Box', category: 'Disposables & Packaging', unit_of_measure: 'box' },
  { name: 'Cello Tape Roll', category: 'Disposables & Packaging', unit_of_measure: 'pcs' },

  // Fuel & Misc
  { name: 'LPG Gas Cylinder', category: 'Fuel & Misc', unit_of_measure: 'pcs' },
  { name: 'Charcoal (for Tandoor)', category: 'Fuel & Misc', unit_of_measure: 'kg' },
]

export const INVENTORY_CATALOG_CATEGORIES = [...new Set(INVENTORY_CATALOG.map(c => c.category))]
