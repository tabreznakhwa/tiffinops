'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAuth } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'

export type AdjustmentActionResult = { error?: string }

const CreateAdjustmentSchema = z.object({
  customer_id: z.string().uuid('Invalid customer'),
  amount: z.coerce
    .number({ message: 'Enter a valid amount' })
    .positive('Amount must be greater than 0'),
  adjustment_type: z.enum(['discount', 'write_off', 'correction']),
  reason: z.string().trim().min(3, 'Please give a reason (at least 3 characters)'),
  adjustment_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date'),
})

/**
 * Record a discount / write-off that reduces what a customer owes — used to
 * settle small residual balances (e.g. a prorated subscription remainder
 * after a pause) without polluting the payments ledger with a fake payment.
 */
export async function createBalanceAdjustment(input: {
  customer_id: string
  amount: number
  adjustment_type: 'discount' | 'write_off' | 'correction'
  reason: string
  adjustment_date: string
}): Promise<AdjustmentActionResult> {
  const user = await requireAuth()
  if (user.role !== 'owner') return { error: 'Only the owner can give discounts or write off balances' }

  const parsed = CreateAdjustmentSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  const admin = createAdminClient()
  const { error } = await admin.from('balance_adjustments').insert({
    customer_id:     parsed.data.customer_id,
    amount:          parsed.data.amount.toFixed(2),
    adjustment_type: parsed.data.adjustment_type,
    reason:          parsed.data.reason,
    adjustment_date: parsed.data.adjustment_date,
    created_by:      user.id,
  })
  if (error) {
    if (error.message.includes('relation') && error.message.includes('does not exist')) {
      return { error: 'Adjustments table missing — run migration 038_balance_adjustments.sql first.' }
    }
    return { error: error.message }
  }

  revalidatePath('/outstanding')
  return {}
}
