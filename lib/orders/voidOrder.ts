'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAuth } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'

const VoidOrderSchema = z.object({
  void_reason: z.string().min(3, 'Please provide a reason (at least 3 characters)'),
})

export async function voidOrder(
  id: string,
  void_reason: string
): Promise<{ error?: string }> {
  const user = await requireAuth()
  if (user.role !== 'owner') return { error: 'Only the owner can void orders' }

  const parsed = VoidOrderSchema.safeParse({ void_reason })
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  const admin = createAdminClient()
  const { error } = await admin
    .from('orders')
    .update({
      order_status: 'voided',
      voided_at: new Date().toISOString(),
      voided_by: user.id,
      void_reason: parsed.data.void_reason,
    })
    .eq('id', id)
    .is('voided_at', null)

  if (error) return { error: error.message }

  revalidatePath('/orders')
  return {}
}
