// Expense categories — shared between server (extraction, actions, migration
// 040 enum) and client (scan review UI, expenses page). Keep dependency-free:
// client components import from here without dragging in the Anthropic SDK.

export const EXPENSE_CATEGORIES = [
  'ingredients', 'fuel', 'utilities', 'rent', 'salaries',
  'maintenance', 'packaging', 'marketing', 'other',
] as const

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number]

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  ingredients: 'Ingredients',
  fuel: 'Fuel',
  utilities: 'Utilities',
  rent: 'Rent',
  salaries: 'Salaries',
  maintenance: 'Maintenance',
  packaging: 'Packaging',
  marketing: 'Marketing',
  other: 'Other',
}
