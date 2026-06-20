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

export async function createMenuItem(formData: FormData): Promise<MenuActionResult> {
  const user = await requireAuth()
  if (!WRITE_ROLES.includes(user.role)) return { error: 'Only owner/manager can manage menu items' }

  const raw = Object.fromEntries([...formData.entries()].map(([k, v]) => [k, v.toString()]))
  const parsed = MenuItemSchema.safeParse(raw)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Validation error' }

  const admin = createAdminClient()
  const { error } = await admin.from('menu_items').insert({
    ...parsed.data,
    created_by: user.id,
  })
  if (error) return { error: error.message }

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
  if (error) return { error: error.message }

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
