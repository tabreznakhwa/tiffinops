'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAuth } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Enums } from '@/lib/supabase/types'

export type PaymentActionResult = { error?: string }

const MODES_REQUIRING_REF = ['bank_transfer', 'cheque', 'online'] as const

const RecordPaymentSchema = z.object({
  customer_id: z.string().uuid('Invalid customer'),
  amount: z.coerce
    .number({ message: 'Enter a valid amount' })
    .positive('Amount must be greater than 0'),
  mode: z.enum(['cash', 'card', 'bank_transfer', 'cheque', 'online', 'wallet', 'other']),
  reference_number: z.string().optional().transform(v => v?.trim() || null),
  payment_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date'),
  notes: z.string().optional().transform(v => v?.trim() || null),
  is_advance: z.boolean().optional().default(false),
})

export async function recordPayment(input: {
  customer_id: string
  amount: number
  mode: Enums<'payment_mode'>
  reference_number?: string
  payment_date: string
  notes?: string
  is_advance?: boolean
}): Promise<PaymentActionResult> {
  const user = await requireAuth()

  const canRecord = ['owner', 'manager', 'accounts'].includes(user.role)
    || user.can_record_payment === true
  if (!canRecord) return { error: 'Insufficient permissions to record payments' }

  const parsed = RecordPaymentSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  // Frontend mirrors the DB trigger constraint
  if (
    MODES_REQUIRING_REF.includes(parsed.data.mode as typeof MODES_REQUIRING_REF[number]) &&
    !parsed.data.reference_number
  ) {
    return { error: `Reference number is required for ${parsed.data.mode.replace('_', ' ')} payments` }
  }

  const admin = createAdminClient()

  // Generate payment number via DB sequence
  const { data: payNumber, error: numErr } = await admin.rpc('next_payment_number')
  if (numErr || !payNumber) {
    return { error: 'Could not generate payment number — run 04_payment_enhancements.sql first.' }
  }

  const { error } = await admin.from('payments').insert({
    payment_number: payNumber as string,
    customer_id: parsed.data.customer_id,
    amount: parsed.data.amount.toFixed(2),
    mode: parsed.data.mode,
    reference_number: parsed.data.reference_number,
    payment_date: parsed.data.payment_date,
    notes: parsed.data.notes,
    is_advance: parsed.data.is_advance ?? false,
    received_by: user.id,
  })

  if (error) return { error: error.message }

  revalidatePath('/payments')
  return {}
}

const VoidPaymentSchema = z.object({
  void_reason: z.string().min(3, 'Please provide a reason (at least 3 characters)'),
})

export async function voidPayment(
  id: string,
  void_reason: string
): Promise<PaymentActionResult> {
  const user = await requireAuth()
  if (user.role !== 'owner') return { error: 'Only the owner can void payments' }

  const parsed = VoidPaymentSchema.safeParse({ void_reason })
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  const admin = createAdminClient()
  const { error } = await admin
    .from('payments')
    .update({
      voided_at: new Date().toISOString(),
      voided_by: user.id,
      void_reason: parsed.data.void_reason,
    })
    .eq('id', id)
    .is('voided_at', null)

  if (error) return { error: error.message }

  revalidatePath('/payments')
  return {}
}
