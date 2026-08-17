'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAuth } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { issueInvoice } from '@/lib/invoices/actions'
import { reconcileInvoicePaymentStatus } from '@/lib/invoices/reconcile'
import type { Enums } from '@/lib/supabase/types'

export type PaymentActionResult = { error?: string; warning?: string }

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
  apply_to_invoice_id: z.string().uuid().optional(),
})

export async function recordPayment(input: {
  customer_id: string
  amount: number
  mode: Enums<'payment_mode'>
  reference_number?: string
  payment_date: string
  notes?: string
  is_advance?: boolean
  apply_to_invoice_id?: string
}): Promise<PaymentActionResult> {
  const user = await requireAuth()

  const canRecord = ['owner', 'manager', 'accounts', 'data_entry'].includes(user.role)
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

  const invoiceId = parsed.data.apply_to_invoice_id
  let invoiceWasDraft = false

  if (invoiceId) {
    const { data: invoice, error: invErr } = await admin
      .from('invoices')
      .select('id, customer_id, status')
      .eq('id', invoiceId)
      .single()

    if (invErr || !invoice) return { error: 'Invoice not found' }
    if (invoice.customer_id !== parsed.data.customer_id) {
      return { error: 'That invoice belongs to a different customer' }
    }
    if (invoice.status === 'cancelled' || invoice.status === 'written_off') {
      return { error: `Cannot apply a payment to a ${invoice.status.replace('_', ' ')} invoice` }
    }
    if (invoice.status === 'draft' && !['owner', 'manager'].includes(user.role)) {
      return { error: 'Only an owner or manager can link a payment to a draft invoice — ask them to issue it first, or record this payment without linking it.' }
    }
    invoiceWasDraft = invoice.status === 'draft'
  }

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
    invoice_id: invoiceId ?? null,
    received_by: user.id,
  })

  if (error) return { error: error.message }

  revalidatePath('/payments')

  // ── Prepaid + Advance: re-anchor the billing cycle to the payment date ──
  // A prepaid customer who pays in advance on the 17th should start (or
  // renew) on the 17th and have their next invoice generated exactly one
  // month later, on the next 17th. billing_anchor_date holds this — we
  // leave start_date alone so it keeps recording when they originally began.
  //
  // Anchor = the customer's most recent non-voided advance payment date
  // (re-derived, so historical/out-of-order entries always resolve to the
  // right answer without depending on insertion order).
  if (parsed.data.is_advance) {
    try {
      const { data: customer } = await admin
        .from('customers')
        .select('payment_terms')
        .eq('id', parsed.data.customer_id)
        .single()

      if (customer?.payment_terms === 'prepaid') {
        const { data: latestAdvance } = await admin
          .from('payments')
          .select('payment_date')
          .eq('customer_id', parsed.data.customer_id)
          .eq('is_advance', true)
          .is('voided_at', null)
          .order('payment_date', { ascending: false })
          .limit(1)
          .maybeSingle()

        if (latestAdvance?.payment_date) {
          await admin
            .from('customer_subscriptions')
            .update({ billing_anchor_date: latestAdvance.payment_date })
            .eq('customer_id', parsed.data.customer_id)
            .in('status', ['active', 'paused'])

          revalidatePath('/fixed-menu')
          revalidatePath('/outstanding')
        }
      }
    } catch {
      // Payment itself succeeded — anchor update is best-effort.
    }
  }

  if (invoiceId) {
    // The payment itself already succeeded above — never roll it back over
    // a downstream status-update failure, just tell the user to finish it by hand.
    try {
      if (invoiceWasDraft) {
        const issueResult = await issueInvoice(invoiceId)
        if (issueResult.error) throw new Error(issueResult.error)
      }
      await reconcileInvoicePaymentStatus(admin, invoiceId)
      revalidatePath('/invoices')
    } catch {
      return { warning: 'Payment recorded, but the invoice status could not be updated automatically — please update it manually.' }
    }
  }

  return {}
}

const UpdatePaymentSchema = z.object({
  amount: z.coerce
    .number({ message: 'Enter a valid amount' })
    .positive('Amount must be greater than 0'),
  mode: z.enum(['cash', 'card', 'bank_transfer', 'cheque', 'online', 'wallet', 'other']),
  reference_number: z.string().optional().transform(v => v?.trim() || null),
  payment_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date'),
  notes: z.string().optional().transform(v => v?.trim() || null),
  is_advance: z.boolean().optional().default(false),
})

export async function updatePayment(
  id: string,
  input: {
    amount: number
    mode: Enums<'payment_mode'>
    reference_number?: string
    payment_date: string
    notes?: string
    is_advance?: boolean
  }
): Promise<PaymentActionResult> {
  const user = await requireAuth()
  if (user.role !== 'owner') return { error: 'Only the owner can edit payments' }

  const parsed = UpdatePaymentSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  if (
    MODES_REQUIRING_REF.includes(parsed.data.mode as typeof MODES_REQUIRING_REF[number]) &&
    !parsed.data.reference_number
  ) {
    return { error: `Reference number is required for ${parsed.data.mode.replace('_', ' ')} payments` }
  }

  const admin = createAdminClient()

  const { data: existing, error: fetchErr } = await admin
    .from('payments')
    .select('voided_at')
    .eq('id', id)
    .single()

  if (fetchErr || !existing) return { error: 'Payment not found' }
  if (existing.voided_at) return { error: 'Cannot edit a voided payment' }

  const { error } = await admin
    .from('payments')
    .update({
      amount: parsed.data.amount.toFixed(2),
      mode: parsed.data.mode,
      reference_number: parsed.data.reference_number,
      payment_date: parsed.data.payment_date,
      notes: parsed.data.notes,
      is_advance: parsed.data.is_advance ?? false,
    })
    .eq('id', id)

  if (error) return { error: error.message }

  revalidatePath('/payments')

  // ── Prepaid + Advance: keep the billing anchor in sync ──
  // The edit may have changed is_advance or moved the payment date, so
  // re-derive the anchor from the customer's remaining advance payments.
  try {
    const { data: payment } = await admin
      .from('payments')
      .select('customer_id')
      .eq('id', id)
      .single()

    if (payment) {
      const { data: customer } = await admin
        .from('customers')
        .select('payment_terms')
        .eq('id', payment.customer_id)
        .single()

      if (customer?.payment_terms === 'prepaid') {
        // Latest non-voided advance payment = the anchor (null if none).
        const { data: latestAdvance } = await admin
          .from('payments')
          .select('payment_date')
          .eq('customer_id', payment.customer_id)
          .eq('is_advance', true)
          .is('voided_at', null)
          .order('payment_date', { ascending: false })
          .limit(1)
          .maybeSingle()

        await admin
          .from('customer_subscriptions')
          .update({ billing_anchor_date: latestAdvance?.payment_date ?? null })
          .eq('customer_id', payment.customer_id)
          .in('status', ['active', 'paused'])

        revalidatePath('/fixed-menu')
        revalidatePath('/outstanding')
      }
    }
  } catch {
    // Payment update itself succeeded — anchor recalc is best-effort.
  }

  return {}
}

export async function deletePayment(id: string): Promise<PaymentActionResult> {
  const user = await requireAuth()
  if (user.role !== 'owner') return { error: 'Only the owner can delete payments' }

  const admin = createAdminClient()

  const { data: existing, error: fetchErr } = await admin
    .from('payments')
    .select('voided_at')
    .eq('id', id)
    .single()

  if (fetchErr || !existing) return { error: 'Payment not found' }
  if (existing.voided_at) {
    return { error: 'Voided payments cannot be deleted — the void record preserves the audit trail' }
  }

  const { error } = await admin.from('payments').delete().eq('id', id)
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

  const { data: existing } = await admin
    .from('payments')
    .select('invoice_id')
    .eq('id', id)
    .single()

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

  // Un-paying a linked payment can drop the invoice back out of paid/partial —
  // keep its status in sync instead of leaving a stale label.
  if (existing?.invoice_id) {
    await reconcileInvoicePaymentStatus(admin, existing.invoice_id)
    revalidatePath('/invoices')
  }

  revalidatePath('/payments')
  return {}
}
