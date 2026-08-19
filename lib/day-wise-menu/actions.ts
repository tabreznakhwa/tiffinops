'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAuth } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Enums } from '@/lib/supabase/types'

// Matches daily_menus_write / daily_menu_items_write RLS exactly (01_schema.sql:519,521).
const WRITE_ROLES: Enums<'user_role'>[] = ['owner', 'manager']

export type DayWiseMenuActionResult = { error?: string }

const OverrideSchema = z.object({
  menu_item_id: z.string().uuid(),
  is_available: z.boolean(),
  price_override: z.number().min(0).nullable(),
})

const SaveSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date'),
  is_published: z.boolean(),
  overrides: z.array(OverrideSchema),
})

/**
 * Save (or clear) a date's menu overrides. `is_published: false` keeps it a
 * draft — invisible to loadMenu() in both app/api/whatsapp/inbound/route.ts and
 * lib/orders/whatsapp-actions.ts, which only pick up published daily_menus rows.
 * Only sparse overrides are stored: an item left "available, default price"
 * gets no daily_menu_items row at all, matching what loadMenu() already expects.
 */
export async function saveDailyMenu(input: {
  date: string
  is_published: boolean
  overrides: { menu_item_id: string; is_available: boolean; price_override: number | null }[]
}): Promise<DayWiseMenuActionResult> {
  const user = await requireAuth()
  if (!WRITE_ROLES.includes(user.role)) return { error: 'Only owner/manager can manage the day-wise menu' }

  const parsed = SaveSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  const admin = createAdminClient()

  const { data: dailyMenu, error: upsertErr } = await admin
    .from('daily_menus')
    .upsert(
      { menu_date: parsed.data.date, is_published: parsed.data.is_published, created_by: user.id },
      { onConflict: 'menu_date' },
    )
    .select('id')
    .single()
  if (upsertErr || !dailyMenu) return { error: upsertErr?.message ?? 'Could not save the day-wise menu' }

  const sparse = parsed.data.overrides.filter(o => !o.is_available || o.price_override !== null)

  const { error: delErr } = await admin.from('daily_menu_items').delete().eq('daily_menu_id', dailyMenu.id)
  if (delErr) return { error: delErr.message }

  if (sparse.length) {
    const { error: insErr } = await admin.from('daily_menu_items').insert(
      sparse.map(o => ({
        daily_menu_id: dailyMenu.id,
        menu_item_id: o.menu_item_id,
        is_available: o.is_available,
        price_override: o.price_override !== null ? String(o.price_override) : null,
      })),
    )
    if (insErr) return { error: insErr.message }
  }

  revalidatePath('/day-wise-menu')
  return {}
}
