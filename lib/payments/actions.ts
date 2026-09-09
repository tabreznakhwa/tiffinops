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
  // Split one payment across several invoices (e.g. the customer hands over
  // one cash/card payment that covers two invoices at once). Takes
  // precedence over apply_to_invoice_id when both are present.
  allocations: z.array(z.object({
    invoice_id: z.string().uuid(),
    amount: z.coerce.number().positive('Allocation amount must be greater than 0'),
  })).optional(),
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
  allocations?: { invoice_id: string; amount: number }[]
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

  // Normalize both call shapes into one: a list of (invoice, amount)
  // allocations. A plain apply_to_invoice_id becomes a single allocation for
  // the full amount — exactly what it did before this whole payment was
  // linked to that one invoice, so existing callers (the Outstanding page's
  // "Pay" buttons, etc.) behave identically.
  const allocations = parsed.data.allocations && parsed.data.allocations.length > 0
    ? parsed.data.allocations
    : parsed.data.apply_to_invoice_id
      ? [{ invoice_id: parsed.data.apply_to_invoice_id, amount: parsed.data.amount }]
      : []

  if (allocations.length > 0) {
    const ids = new Set(allocations.map(a => a.invoice_id))
    if (ids.size !== allocations.length) return { error: 'Each invoice can only be allocated once' }

    const allocatedTotal = allocations.reduce((sum, a) => sum + a.amount, 0)
    if (allocatedTotal - parsed.data.amount > 0.01) {
      return { error: 'The invoice allocations add up to more than the payment amount' }
    }
  }

  const admin = createAdminClient()

  let draftInvoiceIds = new Set<string>()
  if (allocations.length > 0) {
    const { data: invoices, error: invErr } = await admin
      .from('invoices')
      .select('id, customer_id, status')
      .in('id', allocations.map(a => a.invoice_id))

    if (invErr || !invoices || invoices.length !== allocations.length) {
      return { error: 'One or more invoices could not be found' }
    }
    for (const invoice of invoices) {
      if (invoice.customer_id !== parsed.data.customer_id) {
        return { error: 'One of the selected invoices belongs to a different customer' }
      }
      if (invoice.status === 'cancelled' || invoice.status === 'written_off') {
        return { error: `Cannot apply a payment to a ${invoice.status.replace('_', ' ')} invoice` }
      }
      if (invoice.status === 'draft' && !['owner', 'manager'].includes(user.role)) {
        return { error: 'Only an owner or manager can link a payment to a draft invoice — ask them to issue it first, or record this payment without linking it.' }
      }
    }
    draftInvoiceIds = new Set(invoices.filter(i => i.status === 'draft').map(i => i.id))
  }

  // One payments row per allocation (payments.invoice_id is 1:1, so a
  // multi-invoice split becomes multiple rows sharing the same
  // date/mode/reference — the same underlying money), plus one extra
  // unlinked row for anything left over if the invoices selected don't add
  // up to the full amount paid (e.g. the customer overpaid — the rest sits
  // unlinked, same as a normal payment recorded with no invoice at all).
  const linkedTotal = allocations.reduce((sum, a) => sum + a.amount, 0)
  const leftover = Math.max(0, parsed.data.amount - linkedTotal)
  const rows: { invoice_id: string | null; amount: number }[] = allocations.map(a => ({ invoice_id: a.invoice_id, amount: a.amount }))
  if (leftover > 0.004) rows.push({ invoice_id: null, amount: leftover })

  for (const row of rows) {
    // Generate payment number via DB sequence
    const { data: payNumber, error: numErr } = await admin.rpc('next_payment_number')
    if (numErr || !payNumber) {
      return { error: 'Could not generate payment number — run 04_payment_enhancements.sql first.' }
    }

    const splitNote = rows.length > 1
      ? `Part of a split payment of AED ${parsed.data.amount.toFixed(2)} across ${allocations.length} invoice${allocations.length === 1 ? '' : 's'}`
      : null
    const notes = [parsed.data.notes, splitNote].filter(Boolean).join(' — ') || null

    const { error } = await admin.from('payments').insert({
      payment_number: payNumber as string,
      customer_id: parsed.data.customer_id,
      amount: row.amount.toFixed(2),
      mode: parsed.data.mode,
      reference_number: parsed.data.reference_number,
      payment_date: parsed.data.payment_date,
      notes,
      is_advance: parsed.data.is_advance ?? false,
      invoice_id: row.invoice_id,
      received_by: user.id,
    })

    if (error) return { error: error.message }
  }

  revalidatePath('/payments')

  if (allocations.length > 0) {
    // The payment(s) themselves already succeeded above — never roll them
    // back over a downstream status-update failure, just tell the user to
    // finish it by hand.
    let anyFailed = false
    for (const a of allocations) {
      try {
        if (draftInvoiceIds.has(a.invoice_id)) {
          const issueResult = await issueInvoice(a.invoice_id)
          if (issueResult.error) throw new Error(issueResult.error)
        }
        await reconcileInvoicePaymentStatus(admin, a.invoice_id)
      } catch {
        anyFailed = true
      }
    }
    revalidatePath('/invoices')
    if (anyFailed) {
      return { warning: allocations.length > 1
        ? 'Payment recorded, but one or more invoice statuses could not be updated automatically — please update them manually.'
        : 'Payment recorded, but the invoice status could not be updated automatically — please update it manually.' }
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
  return {}
}

export async function deletePayment(id: string): Promise<PaymentActionResult> {
  const user = await requireAuth()
  if (user.role !== 'owner') return { error: 'Only the owner can delete payments' }

  const admin = createAdminClient()

  const { data: existing, error: fetchErr } = await admin
    .from('payments')
    .select('voided_at, invoice_id')
    .eq('id', id)
    .single()

  if (fetchErr || !existing) return { error: 'Payment not found' }
  if (existing.voided_at) {
    return { error: 'Voided payments cannot be deleted — the void record preserves the audit trail' }
  }

  const { error } = await admin.from('payments').delete().eq('id', id)
  if (error) return { error: error.message }

  // Removing a linked payment can drop the invoice back out of paid/partial —
  // keep its status in sync, same as voidPayment does. Without this an
  // invoice can be left showing "Paid" with its full amount still remaining.
  if (existing.invoice_id) {
    await reconcileInvoicePaymentStatus(admin, existing.invoice_id)
    revalidatePath('/invoices')
  }

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
