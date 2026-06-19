'use server'

import { revalidatePath } from 'next/cache'
import { requireAuth } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { generateMonthlyInvoices, nextMonth } from '@/lib/invoices/generateMonthlyInvoices'
import { formatInTimeZone } from 'date-fns-tz'
import type { GenerateResult } from '@/lib/invoices/generateMonthlyInvoices'

export type { GenerateResult }

export async function triggerMonthlyInvoices(
  targetMonth?: string
): Promise<{ error?: string } & Partial<GenerateResult>> {
  const user = await requireAuth()
  if (user.role !== 'owner') return { error: 'Only the owner can generate monthly invoices' }

  const currentDubaiMonth = formatInTimeZone(new Date(), 'Asia/Dubai', 'yyyy-MM')
  const month = targetMonth ?? nextMonth(currentDubaiMonth)

  const result = await generateMonthlyInvoices(month, user.id)
  revalidatePath('/invoices')
  return result
}

import type { Enums } from '@/lib/supabase/types'

export type InvoiceActionResult = { error?: string; invoice_id?: string }

// ── createInvoice ─────────────────────────────────────────────────────────────

export type CreateInvoiceInput = {
  customer_id: string
  invoice_type: Enums<'invoice_type'>
  billing_period_start?: string | null
  billing_period_end?: string | null
  due_date: string
  notes?: string | null
  items: {
    description: string
    quantity: number
    unit_price: number
    order_id?: string | null
  }[]
}

export async function createInvoice(input: CreateInvoiceInput): Promise<InvoiceActionResult> {
  const user = await requireAuth()
  if (!['owner', 'manager'].includes(user.role)) {
    return { error: 'Only owners and managers can create invoices' }
  }

  if (!input.customer_id) return { error: 'Customer is required' }
  if (!input.due_date) return { error: 'Due date is required' }
  if (!input.items || input.items.length === 0) return { error: 'At least one line item is required' }

  const admin = createAdminClient()

  // Fetch VAT rate from settings (e.g. 5 for UAE, 15 for Saudi)
  const { data: settingsRow } = await admin.from('app_settings').select('vat_percent').eq('id', 1).single()
  const vatRate = parseFloat(String(settingsRow?.vat_percent ?? '5'))

  // Compute totals — VAT is INCLUSIVE, never added on top
  const subtotal = input.items.reduce((sum, item) => {
    return sum + item.quantity * item.unit_price
  }, 0)

  // VAT back-calculated from inclusive total: total × rate / (100 + rate)
  const taxAmount = (subtotal * vatRate) / (100 + vatRate)
  const totalAmount = subtotal // total = subtotal (VAT already included)

  // Generate invoice number via DB sequence
  const { data: invoiceNumber, error: numErr } = await admin.rpc('next_invoice_number')
  if (numErr || !invoiceNumber) {
    return { error: 'Could not generate invoice number — run 06_invoice_enhancements.sql first.' }
  }

  const today = formatInTimeZone(new Date(), 'Asia/Dubai', 'yyyy-MM-dd')

  // Insert invoice (status=draft)
  const { data: invoice, error: insertErr } = await admin
    .from('invoices')
    .insert({
      invoice_number: invoiceNumber as string,
      customer_id: input.customer_id,
      invoice_date: today,
      due_date: input.due_date,
      invoice_type: input.invoice_type,
      billing_period_start: input.billing_period_start ?? null,
      billing_period_end: input.billing_period_end ?? null,
      subtotal: subtotal.toFixed(2),
      discount_amount: '0.00',
      tax_amount: taxAmount.toFixed(2),
      total_amount: totalAmount.toFixed(2),
      status: 'draft',
      notes: input.notes ?? null,
      created_by: user.id,
    })
    .select('id')
    .single()

  if (insertErr || !invoice) {
    return { error: insertErr?.message ?? 'Failed to create invoice' }
  }

  // Insert line items
  const lineItems = input.items.map((item) => ({
    invoice_id: invoice.id,
    order_id: item.order_id ?? null,
    description: item.description,
    quantity: item.quantity.toString(),
    unit_price: item.unit_price.toFixed(2),
    total_price: (item.quantity * item.unit_price).toFixed(2),
  }))

  const { error: itemsErr } = await admin.from('invoice_items').insert(lineItems)
  if (itemsErr) {
    // Rollback the invoice if items fail
    await admin.from('invoices').delete().eq('id', invoice.id)
    return { error: itemsErr.message }
  }

  revalidatePath('/invoices')
  return { invoice_id: invoice.id }
}

// ── issueInvoice ──────────────────────────────────────────────────────────────

export async function issueInvoice(id: string): Promise<InvoiceActionResult> {
  const user = await requireAuth()
  if (!['owner', 'manager'].includes(user.role)) {
    return { error: 'Only owners and managers can issue invoices' }
  }

  const admin = createAdminClient()

  // Fetch invoice
  const { data: invoice, error: fetchErr } = await admin
    .from('invoices')
    .select('id, invoice_number, customer_id, total_amount, status')
    .eq('id', id)
    .single()

  if (fetchErr || !invoice) {
    return { error: fetchErr?.message ?? 'Invoice not found' }
  }
  if (invoice.status !== 'draft') {
    return { error: 'Only draft invoices can be issued' }
  }

  const today = formatInTimeZone(new Date(), 'Asia/Dubai', 'yyyy-MM-dd')

  // Update status to issued
  const { error: updateErr } = await admin
    .from('invoices')
    .update({ status: 'issued' })
    .eq('id', id)

  if (updateErr) return { error: updateErr.message }

  // Create ledger debit entry — ONLY on issue, never on creation
  const { error: ledgerErr } = await admin.from('ledger_entries').insert({
    customer_id: invoice.customer_id,
    entry_date: today,
    entry_type: 'invoice',
    debit_amount: parseFloat(String(invoice.total_amount)).toFixed(2),
    credit_amount: '0.00',
    description: `Invoice ${invoice.invoice_number}`,
    reference_table: 'invoices',
    reference_id: invoice.id,
    created_by: user.id,
  })

  if (ledgerErr) {
    // Revert status if ledger fails
    await admin.from('invoices').update({ status: 'draft' }).eq('id', id)
    return { error: ledgerErr.message }
  }

  revalidatePath('/invoices')
  return { invoice_id: id }
}

// ── updateInvoiceStatus ───────────────────────────────────────────────────────

type UpdatableStatus = 'paid' | 'partial' | 'overdue' | 'cancelled' | 'written_off'

export async function updateInvoiceStatus(
  id: string,
  status: UpdatableStatus
): Promise<InvoiceActionResult> {
  const user = await requireAuth()
  if (!['owner', 'manager'].includes(user.role)) {
    return { error: 'Only owners and managers can update invoice status' }
  }

  const admin = createAdminClient()
  const { error } = await admin
    .from('invoices')
    .update({ status })
    .eq('id', id)

  if (error) return { error: error.message }

  revalidatePath('/invoices')
  return { invoice_id: id }
}

// ── voidInvoice ───────────────────────────────────────────────────────────────

export async function voidInvoice(id: string, reason: string): Promise<InvoiceActionResult> {
  const user = await requireAuth()
  if (user.role !== 'owner') {
    return { error: 'Only the owner can cancel invoices' }
  }

  if (!reason?.trim()) {
    return { error: 'Please provide a cancellation reason' }
  }

  const admin = createAdminClient()
  const { error } = await admin
    .from('invoices')
    .update({
      status: 'cancelled',
      notes: reason.trim(),
    })
    .eq('id', id)
    .in('status', ['draft', 'issued'])

  if (error) return { error: error.message }

  revalidatePath('/invoices')
  return { invoice_id: id }
}
