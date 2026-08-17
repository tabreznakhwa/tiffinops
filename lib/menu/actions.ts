'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAuth } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Enums } from '@/lib/supabase/types'

const WRITE_ROLES: Enums<'user_role'>[] = ['owner', 'manager', 'data_entry']

const MenuItemSchema = z.object({
  name: z.string().min(1, 'Name is required').transform(v => v.trim()),
  meal_period: z.enum(['breakfast', 'lunch', 'dinner']),
  category: z.string().optional().transform(v => v?.trim() || null),
  description: z.string().optional().transform(v => v?.trim() || null),
  default_price: z
    .string()
    .min(1, 'Price is required')
    .refine(
      v => !isNaN(parseFloat(v)) && parseFloat(v) >= 0,
      'Enter a valid price (e.g. 25 or 12.50)'
    ),
  is_available: z.string().optional().transform(v => v === 'true' || v === 'on'),
})

export type MenuActionResult = { error?: string }

const MEAL_PERIOD_LABELS: Record<Enums<'meal_period'>, string> = {
  breakfast: 'Breakfast',
  lunch:     'Lunch',
  dinner:    'Dinner',
}

// The unique (lower(name), meal_period) index rejects duplicates with a
// cryptic "duplicate key value violates unique constraint" — translate it.
function friendlyMenuError(message: string): string {
  if (message.includes('idx_menu_items_name_meal') || message.toLowerCase().includes('duplicate key')) {
    return 'An item with this name already exists for that meal period — edit the existing item instead.'
  }
  return message
}

const MenuItemsMultiSchema = z.object({
  name: z.string().min(1, 'Name is required').transform(v => v.trim()),
  category: z.string().optional().transform(v => v?.trim() || null),
  description: z.string().optional().transform(v => v?.trim() || null),
  is_available: z.boolean(),
  periods: z
    .array(
      z.object({
        meal_period: z.enum(['breakfast', 'lunch', 'dinner']),
        price: z.coerce
          .number({ message: 'Enter a valid price for each selected meal period' })
          .nonnegative('Price cannot be negative'),
      })
    )
    .min(1, 'Select at least one meal period'),
})

/**
 * Create one menu item across multiple meal periods in a single save —
 * e.g. "Poha" in Breakfast at 12 AED and Lunch at 15 AED. One row per
 * period, all-or-nothing friendly duplicate check up front. (Replaces the
 * old single-period createMenuItem FormData action.)
 */
export async function createMenuItems(input: {
  name: string
  category?: string
  description?: string
  is_available: boolean
  periods: { meal_period: Enums<'meal_period'>; price: number | string }[]
}): Promise<MenuActionResult> {
  const user = await requireAuth()
  if (!WRITE_ROLES.includes(user.role)) return { error: 'Only owner/manager can manage menu items' }

  const parsed = MenuItemsMultiSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Validation error' }

  // Defensive de-dupe — one row per period max
  const seen = new Set<string>()
  const periods = parsed.data.periods.filter(p => !seen.has(p.meal_period) && !!seen.add(p.meal_period))

  const admin = createAdminClient()

  // Friendly duplicate check before inserting anything (name match is
  // case-insensitive, same as the DB index). Escape ilike wildcards.
  const namePattern = parsed.data.name.replace(/[\\%_]/g, m => `\\${m}`)
  const { data: existing } = await admin
    .from('menu_items')
    .select('meal_period')
    .ilike('name', namePattern)
    .in('meal_period', periods.map(p => p.meal_period))

  if (existing && existing.length > 0) {
    const labels = existing.map(e => MEAL_PERIOD_LABELS[e.meal_period]).join(', ')
    return {
      error: `"${parsed.data.name}" already exists in: ${labels}. Untick those meal periods, or edit the existing item instead.`,
    }
  }

  const { error } = await admin.from('menu_items').insert(
    periods.map(p => ({
      name:          parsed.data.name,
      meal_period:   p.meal_period,
      category:      parsed.data.category,
      description:   parsed.data.description,
      default_price: p.price.toFixed(2),
      is_available:  parsed.data.is_available,
      created_by:    user.id,
    }))
  )
  if (error) return { error: friendlyMenuError(error.message) }

  revalidatePath('/menu')
  return {}
}

export async function updateMenuItem(id: string, formData: FormData): Promise<MenuActionResult> {
  const user = await requireAuth()
  if (!WRITE_ROLES.includes(user.role)) return { error: 'Only owner/manager can manage menu items' }

  const raw = Object.fromEntries([...formData.entries()].map(([k, v]) => [k, v.toString()]))
  const parsed = MenuItemSchema.safeParse(raw)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Validation error' }

  const admin = createAdminClient()
  const { error } = await admin.from('menu_items').update(parsed.data).eq('id', id)
  if (error) return { error: friendlyMenuError(error.message) }

  revalidatePath('/menu')
  return {}
}

export async function toggleMenuItemAvailability(
  id: string,
  is_available: boolean
): Promise<MenuActionResult> {
  const user = await requireAuth()
  if (!WRITE_ROLES.includes(user.role)) return { error: 'Insufficient permissions' }

  const admin = createAdminClient()
  const { error } = await admin.from('menu_items').update({ is_available }).eq('id', id)
  if (error) return { error: error.message }

  revalidatePath('/menu')
  return {}
}
