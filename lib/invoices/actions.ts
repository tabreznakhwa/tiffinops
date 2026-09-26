'use server'

import { revalidatePath } from 'next/cache'
import { requireAuth, canGiveDiscount } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { generateMonthlyInvoices } from '@/lib/invoices/generateMonthlyInvoices'
import { generateAlaCarteInvoices } from '@/lib/invoices/generateAlaCarteInvoices'
import { generatePrepaidAnniversaryInvoices } from '@/lib/invoices/generatePrepaidInvoices'
import { generateFixedAnniversaryInvoices } from '@/lib/invoices/generateFixedAnniversaryInvoices'
import { formatInTimeZone } from 'date-fns-tz'
import { applySurplusReconciliation as applySurplusReconciliationCore } from '@/lib/invoices/reconcileSurplus'
import { reconcileInvoicePaymentStatus } from '@/lib/invoices/reconcile'
import type { GenerateResult } from '@/lib/invoices/generateMonthlyInvoices'
import type { AlaCarteGenerateResult } from '@/lib/invoices/generateAlaCarteInvoices'
import type { ApplyResult } from '@/lib/invoices/reconcileSurplus'

export async function triggerMonthlyInvoices(
  targetMonth?: string
): Promise<{ error?: string } & Partial<GenerateResult>> {
  const user = await requireAuth()
  if (user.role !== 'owner') return { error: 'Only the owner can generate monthly invoices' }

  const currentDubaiMonth = formatInTimeZone(new Date(), 'Asia/Dubai', 'yyyy-MM')
  const month = targetMonth ?? currentDubaiMonth

  const result = await generateMonthlyInvoices(month, user.id)
  revalidatePath('/invoices')
  return result
}

// Prepaid customers are billed on their own start-date anniversary rather
// than a shared monthly cycle — see generatePrepaidInvoices.ts. This lets the
// owner force a check for a given day (catch-up after a missed cron run, or
// testing) instead of waiting for the daily cron.
export async function triggerPrepaidInvoices(
  targetDate?: string
): Promise<{ error?: string } & Partial<GenerateResult>> {
  const user = await requireAuth()
  if (user.role !== 'owner') return { error: 'Only the owner can generate prepaid invoices' }

  const today = targetDate ?? formatInTimeZone(new Date(), 'Asia/Dubai', 'yyyy-MM-dd')

  const result = await generatePrepaidAnniversaryInvoices(today, user.id)
  revalidatePath('/invoices')
  return result
}

// Postpaid fixed_menu customers are billed in arrears on their own
// subscription-start anniversary — see generateFixedAnniversaryInvoices.ts.
// Lets the owner force a check as of a given day (catch-up after a missed
// cron run, or testing) instead of waiting for the daily cron.
export async function triggerFixedAnniversaryInvoices(
  targetDate?: string
): Promise<{ error?: string } & Partial<GenerateResult>> {
  const user = await requireAuth()
  if (user.role !== 'owner') return { error: 'Only the owner can generate fixed-plan invoices' }

  const today = targetDate ?? formatInTimeZone(new Date(), 'Asia/Dubai', 'yyyy-MM-dd')

  const result = await generateFixedAnniversaryInvoices(today, user.id)
  revalidatePath('/invoices')
  return result
}

export async function triggerAlaCarteInvoices(
  targetMonth?: string,
  periodStart?: string,
  periodEnd?: string,
  discountPercent?: number,
  customerDiscounts?: Record<string, number>,
): Promise<{ error?: string } & Partial<AlaCarteGenerateResult>> {
  const user = await requireAuth()
  if (user.role !== 'owner') return { error: 'Only the owner can generate A La Carte invoices' }

  const currentDubaiMonth = formatInTimeZone(new Date(), 'Asia/Dubai', 'yyyy-MM')
  const month = targetMonth ?? currentDubaiMonth

  try {
    const result = await generateAlaCarteInvoices(month, user.id, {
      periodStart, periodEnd, discountPercent, customerDiscounts,
    })
    revalidatePath('/invoices')
    return result
  } catch (err: unknown) {
    return { error: err instanceof Error ? err.message : 'Generation failed — check server logs' }
  }
}

// Mai Dubai customers share one 26th-of-prev-month→25th-of-targetMonth cycle
// regardless of customer_type (see MAI_DUBAI_AREA in generateMonthlyInvoices.ts) —
// this runs BOTH generators (fixed-plan + à la carte) scoped to only that area,
// for a manual backfill/catch-up run that never touches any other area's
// billing cycle, unlike calling triggerMonthlyInvoices/triggerAlaCarteInvoices
// directly (those process every eligible customer system-wide).
export type MaiDubaiGenerateResult = {
  monthly:  GenerateResult
  alaCarte: AlaCarteGenerateResult
  month:    string
}

export async function triggerMaiDubaiInvoices(
  targetMonth?: string
): Promise<{ error?: string } & Partial<MaiDubaiGenerateResult>> {
  const user = await requireAuth()
  if (user.role !== 'owner') return { error: 'Only the owner can generate invoices' }

  const currentDubaiMonth = formatInTimeZone(new Date(), 'Asia/Dubai', 'yyyy-MM')
  const month = targetMonth ?? currentDubaiMonth

  try {
    const monthly  = await generateMonthlyInvoices(month, user.id, { onlyArea: 'Mai Dubai' })
    const alaCarte = await generateAlaCarteInvoices(month, user.id, { onlyArea: 'Mai Dubai' })
    revalidatePath('/invoices')
    return { monthly, alaCarte, month }
  } catch (err: unknown) {
    return { error: err instanceof Error ? err.message : 'Generation failed — check server logs' }
  }
}

export type AlaCarteCustomer = { id: string; full_name: string; customer_code: string }

// ── bulkIssueDraftInvoices ────────────────────────────────────────────────────

export async function bulkIssueDraftInvoices(ids: string[]): Promise<InvoiceActionResult> {
  const user = await requireAuth()
  if (!['owner', 'manager'].includes(user.role)) {
    return { error: 'Only owners and managers can issue invoices' }
  }
  if (!ids.length) return {}

  const admin = createAdminClient()
  const today = formatInTimeZone(new Date(), 'Asia/Dubai', 'yyyy-MM-dd')

  const { data: invoices } = await admin
    .from('invoices')
    .select('id, invoice_number, customer_id, total_amount, status')
    .in('id', ids)

  const nonDrafts = (invoices ?? []).filter(inv => inv.status !== 'draft')
  if (nonDrafts.length > 0) {
    return { error: `${nonDrafts.length} selected invoice(s) are not drafts` }
  }

  const { error: updateErr } = await admin
    .from('invoices')
    .update({ status: 'issued' })
    .in('id', ids)
  if (updateErr) return { error: updateErr.message }

  const ledgerEntries = (invoices ?? []).map(inv => ({
    customer_id:     inv.customer_id,
    entry_date:      today,
    entry_type:      'invoice' as const,
    debit_amount:    parseFloat(String(inv.total_amount)).toFixed(2),
    credit_amount:   '0.00',
    description:     `Invoice ${inv.invoice_number}`,
    reference_table: 'invoices',
    reference_id:    inv.id,
    created_by:      user.id,
  }))

  const { error: ledgerErr } = await admin.from('ledger_entries').insert(ledgerEntries)
  if (ledgerErr) {
    await admin.from('invoices').update({ status: 'draft' }).in('id', ids)
    return { error: ledgerErr.message }
  }

  revalidatePath('/invoices')
  return {}
}

// ── getAlaCarteCustomers ──────────────────────────────────────────────────────

export async function getAlaCarteCustomers(): Promise<AlaCarteCustomer[]> {
  await requireAuth()
  const admin = createAdminClient()
  const { data } = await admin
    .from('customers')
    .select('id, full_name, customer_code')
    .in('customer_type', ['a_la_carte', 'hybrid'])
    .eq('status', 'active')
    .order('full_name')
  return (data ?? []) as AlaCarteCustomer[]
}

import type { Enums } from '@/lib/supabase/types'

export type InvoiceActionResult = { error?: string; invoice_id?: string }

// ── getCustomerOpenInvoices ───────────────────────────────────────────────────

export type OpenInvoice = {
  id: string
  invoice_number: string
  invoice_type: Enums<'invoice_type'>
  status: Enums<'invoice_status'>
  total_amount: string
  discount_amount: string
  billing_period_start: string | null
  billing_period_end: string | null
  paid_so_far: number
}

// Feeds the "Apply to Invoice" picker in the record-payment modal — a
// customer's still-open invoices (not yet paid off, not draft-excluded —
// drafts show up too so a payment can issue one on the spot), each with how
// much has already been paid against it so the picker can show the balance.
const OPEN_STATUSES: Enums<'invoice_status'>[] = ['draft', 'issued', 'partial', 'overdue']

export async function getCustomerOpenInvoices(customerId: string): Promise<OpenInvoice[]> {
  await requireAuth()
  const admin = createAdminClient()

  const { data: invoices } = await admin
    .from('invoices')
    .select('id, invoice_number, invoice_type, status, total_amount, discount_amount, billing_period_start, billing_period_end')
    .eq('customer_id', customerId)
    .in('status', OPEN_STATUSES)
    .order('invoice_date', { ascending: false })

  if (!invoices || invoices.length === 0) return []

  const { data: payments } = await admin
    .from('payments')
    .select('invoice_id, amount')
    .in('invoice_id', invoices.map(inv => inv.id))
    .is('voided_at', null)

  const paidByInvoice = new Map<string, number>()
  for (const p of payments ?? []) {
    if (!p.invoice_id) continue
    paidByInvoice.set(p.invoice_id, (paidByInvoice.get(p.invoice_id) ?? 0) + parseFloat(String(p.amount)))
  }

  return invoices.map(inv => ({
    ...inv,
    paid_so_far: paidByInvoice.get(inv.id) ?? 0,
  }))
}

// ── getInvoiceItems ───────────────────────────────────────────────────────────

export type InvoiceItemRow = {
  description: string
  quantity: string
  unit_price: string
  order_id: string | null
}

export async function getInvoiceItems(invoiceId: string): Promise<InvoiceItemRow[]> {
  await requireAuth()
  const admin = createAdminClient()
  const { data } = await admin
    .from('invoice_items')
    .select('description, quantity, unit_price, order_id')
    .eq('invoice_id', invoiceId)
  return (data ?? []) as InvoiceItemRow[]
}

// ── createInvoice ─────────────────────────────────────────────────────────────

export type CreateInvoiceInput = {
  customer_id: string
  invoice_type: Enums<'invoice_type'>
  billing_period_start?: string | null
  billing_period_end?: string | null
  due_date: string
  notes?: string | null
  discountPercent?: number
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

  const discountPct    = Math.min(100, Math.max(0, input.discountPercent ?? 0))
  const discountAmount = parseFloat((subtotal * discountPct / 100).toFixed(2))
  const totalAmount    = Math.max(0, subtotal - discountAmount)
  const taxAmount      = (totalAmount * vatRate) / (100 + vatRate)

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
      discount_amount: discountAmount.toFixed(2),
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

// ── updateInvoice ─────────────────────────────────────────────────────────────

export type UpdateInvoiceInput = {
  customer_id: string
  invoice_type: Enums<'invoice_type'>
  billing_period_start?: string | null
  billing_period_end?: string | null
  due_date: string
  notes?: string | null
  discountPercent?: number
  items: {
    description: string
    quantity: number
    unit_price: number
    order_id?: string | null
  }[]
}

export async function updateInvoice(
  id: string,
  input: UpdateInvoiceInput
): Promise<InvoiceActionResult> {
  const user = await requireAuth()
  if (user.role !== 'owner') return { error: 'Only the owner can edit invoices' }

  if (!input.customer_id) return { error: 'Customer is required' }
  if (!input.due_date) return { error: 'Due date is required' }
  if (!input.items || input.items.length === 0) return { error: 'At least one line item is required' }

  const admin = createAdminClient()

  const { data: existing, error: fetchErr } = await admin
    .from('invoices')
    .select('id, invoice_number, status')
    .eq('id', id)
    .single()

  if (fetchErr || !existing) return { error: 'Invoice not found' }
  if (existing.status === 'cancelled' || existing.status === 'written_off') {
    return { error: `Cannot edit a ${existing.status.replace('_', ' ')} invoice` }
  }

  const { data: settingsRow } = await admin.from('app_settings').select('vat_percent').eq('id', 1).single()
  const vatRate = parseFloat(String(settingsRow?.vat_percent ?? '5'))

  const subtotal       = input.items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0)
  const discountPct    = Math.min(100, Math.max(0, input.discountPercent ?? 0))
  const discountAmount = parseFloat((subtotal * discountPct / 100).toFixed(2))
  const totalAmount    = Math.max(0, subtotal - discountAmount)
  const taxAmount      = (totalAmount * vatRate) / (100 + vatRate)

  const { error: updateErr } = await admin
    .from('invoices')
    .update({
      customer_id: input.customer_id,
      invoice_type: input.invoice_type,
      billing_period_start: input.billing_period_start ?? null,
      billing_period_end: input.billing_period_end ?? null,
      due_date: input.due_date,
      subtotal: subtotal.toFixed(2),
      discount_amount: discountAmount.toFixed(2),
      tax_amount: taxAmount.toFixed(2),
      total_amount: totalAmount.toFixed(2),
      notes: input.notes ?? null,
    })
    .eq('id', id)

  if (updateErr) return { error: updateErr.message }

  // Replace line items
  const { error: deleteItemsErr } = await admin.from('invoice_items').delete().eq('invoice_id', id)
  if (deleteItemsErr) return { error: deleteItemsErr.message }

  const lineItems = input.items.map((item) => ({
    invoice_id: id,
    order_id: item.order_id ?? null,
    description: item.description,
    quantity: item.quantity.toString(),
    unit_price: item.unit_price.toFixed(2),
    total_price: (item.quantity * item.unit_price).toFixed(2),
  }))

  const { error: itemsErr } = await admin.from('invoice_items').insert(lineItems)
  if (itemsErr) return { error: itemsErr.message }

  // Invoice was already issued (has a ledger debit entry) — keep it in sync with the new total
  if (existing.status !== 'draft') {
    await admin
      .from('ledger_entries')
      .update({ debit_amount: totalAmount.toFixed(2) })
      .eq('reference_table', 'invoices')
      .eq('reference_id', id)
  }

  revalidatePath('/invoices')
  return { invoice_id: id }
}

// ── bulkDeleteDraftInvoices ───────────────────────────────────────────────────

export async function bulkDeleteDraftInvoices(ids: string[]): Promise<InvoiceActionResult> {
  const user = await requireAuth()
  if (user.role !== 'owner') return { error: 'Only the owner can delete invoices' }
  if (!ids.length) return {}

  const admin = createAdminClient()

  const { data: found } = await admin.from('invoices').select('id, status').in('id', ids)
  const nonDrafts = (found ?? []).filter(inv => inv.status !== 'draft')
  if (nonDrafts.length > 0) {
    return { error: `${nonDrafts.length} selected invoice(s) are not drafts and cannot be deleted` }
  }

  await admin.from('invoice_items').delete().in('invoice_id', ids)
  const { error } = await admin.from('invoices').delete().in('id', ids)
  if (error) return { error: error.message }

  revalidatePath('/invoices')
  return {}
}

// ── deleteInvoice ─────────────────────────────────────────────────────────────

export async function deleteInvoice(id: string): Promise<InvoiceActionResult> {
  const user = await requireAuth()
  if (user.role !== 'owner') return { error: 'Only the owner can delete invoices' }

  const admin = createAdminClient()

  const { data: existing, error: fetchErr } = await admin
    .from('invoices')
    .select('status')
    .eq('id', id)
    .single()

  if (fetchErr || !existing) return { error: 'Invoice not found' }
  if (existing.status !== 'draft') {
    return { error: 'Only draft (unissued) invoices can be deleted — cancel it instead' }
  }

  const { error: itemsErr } = await admin.from('invoice_items').delete().eq('invoice_id', id)
  if (itemsErr) return { error: itemsErr.message }

  const { error } = await admin.from('invoices').delete().eq('id', id)
  if (error) return { error: error.message }

  revalidatePath('/invoices')
  return {}
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

// ── applyInvoiceDiscount ─────────────────────────────────────────────────────
//
// Discount on a single invoice — used by the Outstanding page's month-wise
// breakdown so one month's bill can be reduced without touching the
// customer's other cycles, and by Record Payment's per-invoice "Discount"
// trigger. Owner by default; gated by canGiveDiscount() so the owner can also
// grant this to a specific staff member (users.can_give_discount) without
// making them a full owner — see lib/auth.ts. A reason is always required,
// for either caller. Bumps discount_amount / lowers total_amount, keeps
// the VAT-inclusive tax and the invoice's ledger debit in sync, records the
// reason in the notes, and re-checks paid/partial against the new total (a
// discount down to what's already paid flips the invoice to Paid).

export async function applyInvoiceDiscount(
  id: string,
  amount: number,
  reason: string
): Promise<InvoiceActionResult> {
  const user = await requireAuth()
  if (!canGiveDiscount(user)) return { error: 'You do not have permission to discount invoices' }

  if (!Number.isFinite(amount) || amount <= 0) return { error: 'Enter a discount greater than 0' }
  if (!reason || reason.trim().length < 3) return { error: 'Please give a reason (at least 3 characters)' }

  const admin = createAdminClient()

  const { data: inv, error: fetchErr } = await admin
    .from('invoices')
    .select('id, invoice_number, status, discount_amount, total_amount, notes')
    .eq('id', id)
    .single()
  if (fetchErr || !inv) return { error: 'Invoice not found' }
  if (!['issued', 'partial', 'overdue'].includes(inv.status)) {
    return { error: `Cannot discount a ${inv.status.replace('_', ' ')} invoice` }
  }

  // Discount is capped at what's still unpaid — money already received can't
  // be discounted away (that would need a refund, not a discount).
  const { data: payments } = await admin
    .from('payments')
    .select('amount')
    .eq('invoice_id', id)
    .is('voided_at', null)
  const paid      = (payments ?? []).reduce((s, p) => s + parseFloat(String(p.amount)), 0)
  const oldTotal  = parseFloat(String(inv.total_amount))
  const remaining = oldTotal - paid
  if (amount > remaining + 0.005) {
    return { error: `Discount exceeds the remaining balance (${remaining.toFixed(2)})` }
  }

  const { data: settingsRow } = await admin.from('app_settings').select('vat_percent').eq('id', 1).single()
  const vatRate = parseFloat(String(settingsRow?.vat_percent ?? '5'))

  const newTotal    = Math.max(0, parseFloat((oldTotal - amount).toFixed(2)))
  const newDiscount = parseFloat(String(inv.discount_amount ?? '0')) + amount
  const newTax      = (newTotal * vatRate) / (100 + vatRate)
  const today       = formatInTimeZone(new Date(), 'Asia/Dubai', 'yyyy-MM-dd')
  const note        = `Discount ${amount.toFixed(2)} (${today}): ${reason.trim()}`

  // Guard on the old total so a concurrent edit fails loudly instead of
  // silently stacking on stale numbers.
  const { data: updated, error: updateErr } = await admin
    .from('invoices')
    .update({
      discount_amount: newDiscount.toFixed(2),
      tax_amount:      newTax.toFixed(2),
      total_amount:    newTotal.toFixed(2),
      notes: inv.notes ? `${inv.notes}\n${note}` : note,
    })
    .eq('id', id)
    .eq('total_amount', inv.total_amount)
    .select('id')
  if (updateErr) return { error: updateErr.message }
  if (!updated || updated.length === 0) {
    return { error: 'Invoice changed while discounting — reload and try again' }
  }

  // Keep the ledger debit for this invoice in sync with the new total
  await admin
    .from('ledger_entries')
    .update({ debit_amount: newTotal.toFixed(2) })
    .eq('reference_table', 'invoices')
    .eq('reference_id', id)
    .eq('entry_type', 'invoice')

  await reconcileInvoicePaymentStatus(admin, id)

  revalidatePath('/invoices')
  revalidatePath('/outstanding')
  return { invoice_id: id }
}

// ── applySurplusReconciliation ───────────────────────────────────────────────
//
// Applies a discount to draft/issued invoices whose customer has an
// unaccounted-for payment surplus — see lib/invoices/reconcileSurplus.ts for
// the full mechanism. Owner-only: this edits discount_amount/total_amount,
// a financial edit, matching updateInvoice()'s gating.

export async function applySurplusReconciliation(
  candidateIds: string[]
): Promise<{ error?: string } & Partial<ApplyResult>> {
  const user = await requireAuth()
  if (user.role !== 'owner') {
    return { error: 'Only the owner can apply surplus reconciliation' }
  }
  if (!candidateIds.length) return { applied: [], skipped: [], flagged: [] }

  const admin = createAdminClient()
  const result = await applySurplusReconciliationCore(admin, candidateIds, user.id)

  revalidatePath('/invoices')
  revalidatePath('/reconciliation')
  return result
}
