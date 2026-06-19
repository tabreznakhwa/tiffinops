'use server'

import { revalidatePath } from 'next/cache'
import { requireAuth } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Enums } from '@/lib/supabase/types'

const WRITER_ROLES: Enums<'user_role'>[] = ['owner', 'manager', 'data_entry', 'packer']

export async function updateDeliveryStatus(input: {
  customer_id: string
  subscription_id: string
  delivery_date: string
  meal_period: 'breakfast' | 'lunch' | 'dinner'
  status: 'pending' | 'out_for_delivery' | 'delivered' | 'skipped' | 'failed'
  skip_reason?: string | null
  skip_note?: string | null
}): Promise<{ error?: string }> {
  const user = await requireAuth()
  if (!WRITER_ROLES.includes(user.role)) return { error: 'Insufficient permissions' }

  const admin = createAdminClient()

  const delivered_at = input.status === 'delivered' ? new Date().toISOString() : null

  // Check if a delivery record already exists for this customer + date + meal_period
  const { data: existing, error: lookupErr } = await admin
    .from('deliveries')
    .select('id')
    .eq('customer_id', input.customer_id)
    .eq('delivery_date', input.delivery_date)
    .eq('meal_period', input.meal_period)
    .maybeSingle()

  if (lookupErr) return { error: lookupErr.message }

  if (existing) {
    // UPDATE existing record
    const { error } = await admin
      .from('deliveries')
      .update({
        status: input.status,
        skip_reason: input.skip_reason ?? null,
        skip_note: input.skip_note ?? null,
        delivered_at,
        updated_by: user.id,
      })
      .eq('id', existing.id)

    if (error) return { error: error.message }
  } else {
    // INSERT new record
    const { error } = await admin
      .from('deliveries')
      .insert({
        customer_id: input.customer_id,
        subscription_id: input.subscription_id,
        delivery_date: input.delivery_date,
        meal_period: input.meal_period,
        status: input.status,
        skip_reason: input.skip_reason ?? null,
        skip_note: input.skip_note ?? null,
        delivered_at,
        updated_by: user.id,
      })

    if (error) return { error: error.message }
  }

  revalidatePath('/deliveries')
  return {}
}
