// Surplus-payment reconciliation — the in-app, generalized successor to the
// one-off scripts/settle-fixed-menu-drafts.js script.
//
// The problem: a customer pays money that never gets linked to a specific
// invoice (payments.invoice_id stays null — either historical payments
// recorded before payment→invoice linking existed, or any future unlinked
// payment). From an invoice's point of view this looks like "customer owes
// the full amount" when some or all of it was already paid, just not
// against this invoice. Left alone, this repeats every billing cycle for
// as long as the gap exists — generateAlaCarteInvoices()/generateMonthlyInvoices()/
// generatePrepaidInvoices() all run on a schedule and will keep creating
// fresh drafts with the same inflated total.
//
// The fix applied here: write the invoice down via discount_amount rather
// than retroactively guessing which old payment belongs to which invoice —
// there's no ground truth for that attribution. The discount reduces the
// invoice to its true remaining balance; reconcileInvoicePaymentStatus's
// own paid-vs-total rule (paid=0 here, since no payment is linked) then
// naturally lands it on 'paid' (fully covered) or 'issued' (partially
// covered, real remainder still due) — see lib/invoices/reconcile.ts.
//
// Scope: any invoice in status 'draft' or 'issued' with discount_amount = 0
// (i.e. genuinely untouched — never manually discounted or reconciled
// before), any customer type. Not date- or customer-type-scoped, unlike the
// original script — see the self-exclusion fix below for why that's safe.

import { formatInTimeZone } from 'date-fns-tz'
import type { SupabaseClient } from '@supabase/supabase-js'

export type SurplusCandidate = {
  id: string
  invoice_number: string
  customer_id: string
  customer_name: string
  invoice_type: string
  old_status: 'draft' | 'issued'
  subtotal: number
  old_total_amount: number
  new_discount_amount: number
  new_tax_amount: number
  new_total_amount: number
  new_status: 'paid' | 'issued'
  new_notes: string
  paid_to_date: number
  invoiced_elsewhere: number
}

export type ApplyResult = {
  applied: string[]
  skipped: { invoice_number: string; reason: string }[]
  flagged: { invoice_number: string; reason: string }[]
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = SupabaseClient<any, any, any>

export async function computeSurplusCandidates(admin: AdminClient): Promise<SurplusCandidate[]> {
  const { data: settingsRow } = await admin.from('app_settings').select('vat_percent').eq('id', 1).single()
  const vatRate = parseFloat(String(settingsRow?.vat_percent ?? '5'))

  const { data: drafts } = await admin
    .from('invoices')
    .select('id, invoice_number, invoice_type, status, subtotal, discount_amount, total_amount, notes, customer_id, customers(full_name)')
    .in('status', ['draft', 'issued'])
    .eq('discount_amount', 0)

  const candidateInvoices = (drafts ?? []) as unknown as Array<{
    id: string; invoice_number: string; invoice_type: string; status: 'draft' | 'issued'
    subtotal: string; discount_amount: string; total_amount: string; notes: string | null
    customer_id: string; customers: { full_name: string } | null
  }>
  const candidateIds = new Set(candidateInvoices.map(d => d.id))
  const customerIds = [...new Set(candidateInvoices.map(d => d.customer_id))]
  if (customerIds.length === 0) return []

  const { data: otherInvoices } = await admin
    .from('invoices')
    .select('id, customer_id, total_amount, status')
    .in('customer_id', customerIds)
    .in('status', ['issued', 'partial', 'paid', 'overdue'])

  const invoicedByCustomer = new Map<string, number>()
  for (const inv of otherInvoices ?? []) {
    // Exclude the candidates themselves — an invoice that's already
    // 'issued' would otherwise satisfy this query's own status filter and
    // count against its own surplus, silently zeroing out its own
    // discount. (Bug hit and fixed for AC-INV-01064 during the original
    // manual reconciliation — fixed at the root here.)
    if (candidateIds.has(inv.id)) continue
    invoicedByCustomer.set(inv.customer_id, (invoicedByCustomer.get(inv.customer_id) || 0) + parseFloat(String(inv.total_amount)))
  }

  const { data: payments } = await admin
    .from('payments')
    .select('customer_id, amount')
    .in('customer_id', customerIds)
    .is('voided_at', null)
  const paidByCustomer = new Map<string, number>()
  for (const p of payments ?? []) {
    paidByCustomer.set(p.customer_id, (paidByCustomer.get(p.customer_id) || 0) + parseFloat(String(p.amount)))
  }

  const today = formatInTimeZone(new Date(), 'Asia/Dubai', 'yyyy-MM-dd')
  const candidates: SurplusCandidate[] = []

  for (const inv of candidateInvoices) {
    const invoiced = invoicedByCustomer.get(inv.customer_id) || 0
    const paid = paidByCustomer.get(inv.customer_id) || 0
    const surplus = Math.max(0, paid - invoiced)
    const subtotal = parseFloat(inv.subtotal)
    const impliedDiscount = Math.min(surplus, subtotal)
    if (impliedDiscount <= 0) continue // no gap — leave untouched

    const newTotal = Math.max(0, subtotal - impliedDiscount)
    const newTax = (newTotal * vatRate) / (100 + vatRate)
    const nextStatus: 'paid' | 'issued' = newTotal <= 0.01 ? 'paid' : 'issued'

    const note = `[Surplus reconciliation ${today}] AED ${impliedDiscount.toFixed(2)} already covered by an unlinked historical payment (customer paid-to-date AED ${paid.toFixed(2)}, already invoiced elsewhere AED ${invoiced.toFixed(2)}). Discount applied to avoid double-billing. Remaining balance AED ${newTotal.toFixed(2)} is genuinely still due.`
    const newNotes = inv.notes ? `${inv.notes}\n${note}` : note

    candidates.push({
      id: inv.id,
      invoice_number: inv.invoice_number,
      customer_id: inv.customer_id,
      customer_name: inv.customers?.full_name ?? inv.customer_id,
      invoice_type: inv.invoice_type,
      old_status: inv.status,
      subtotal,
      old_total_amount: parseFloat(inv.total_amount),
      new_discount_amount: impliedDiscount,
      new_tax_amount: newTax,
      new_total_amount: newTotal,
      new_status: nextStatus,
      new_notes: newNotes,
      paid_to_date: paid,
      invoiced_elsewhere: invoiced,
    })
  }

  candidates.sort((a, b) => b.new_discount_amount - a.new_discount_amount)
  return candidates
}

export async function applySurplusReconciliation(
  admin: AdminClient,
  requestedIds: string[],
  actorUserId: string
): Promise<ApplyResult> {
  const result: ApplyResult = { applied: [], skipped: [], flagged: [] }
  if (requestedIds.length === 0) return result

  // Re-derive fresh — never trust a candidate list computed earlier in the
  // request (e.g. when the page loaded); something may have changed since.
  const allCandidates = await computeSurplusCandidates(admin)
  const byId = new Map(allCandidates.map(c => [c.id, c]))
  const requested = new Set(requestedIds)
  const today = formatInTimeZone(new Date(), 'Asia/Dubai', 'yyyy-MM-dd')

  for (const id of requested) {
    const c = byId.get(id)
    if (!c) {
      result.skipped.push({ invoice_number: id, reason: 'no longer eligible (already changed)' })
      continue
    }

    const wasAlreadyIssued = c.old_status === 'issued'

    // Already-issued invoice whose surplus fully covers it: the existing
    // ledger debit can't simply be corrected to zero (debit_amount +
    // credit_amount > 0 is a DB constraint, and zero-value debit is
    // meaningless anyway) — deciding whether to credit it out or handle it
    // some other way is an accounting judgment call, not something to
    // guess at silently. Flag it and skip rather than applying partially.
    if (wasAlreadyIssued && c.new_total_amount <= 0) {
      result.flagged.push({
        invoice_number: c.invoice_number,
        reason: `fully covered by surplus but already issued with an existing ledger debit of AED ${c.old_total_amount.toFixed(2)} — needs manual review to decide how to zero it out`,
      })
      continue
    }

    const { error: updateErr } = await admin
      .from('invoices')
      .update({
        discount_amount: c.new_discount_amount.toFixed(2),
        tax_amount: c.new_tax_amount.toFixed(2),
        total_amount: c.new_total_amount.toFixed(2),
        notes: c.new_notes,
        status: c.new_status,
      })
      .eq('id', c.id)
      .eq('discount_amount', '0.00') // re-check eligibility at write time
      .eq('status', c.old_status)

    if (updateErr) {
      result.skipped.push({ invoice_number: c.invoice_number, reason: updateErr.message })
      continue
    }

    if (wasAlreadyIssued) {
      // Already issued — a ledger debit for the old (undiscounted) total
      // already exists. Correct it in place rather than inserting a
      // second debit, same as updateInvoice() does for edits to issued
      // invoices (lib/invoices/actions.ts).
      const { data: existingLedger } = await admin
        .from('ledger_entries')
        .select('id')
        .eq('reference_table', 'invoices')
        .eq('reference_id', c.id)
        .limit(1)

      if (existingLedger && existingLedger.length > 0) {
        const { error: ledgerErr } = await admin
          .from('ledger_entries')
          .update({ debit_amount: c.new_total_amount.toFixed(2) })
          .eq('id', existingLedger[0].id)
        if (ledgerErr) {
          result.flagged.push({ invoice_number: c.invoice_number, reason: `invoice updated but ledger correction failed: ${ledgerErr.message}` })
        }
      } else {
        const { error: ledgerErr } = await admin.from('ledger_entries').insert({
          customer_id: c.customer_id, entry_date: today, entry_type: 'invoice',
          debit_amount: c.new_total_amount.toFixed(2), credit_amount: '0.00',
          description: `Invoice ${c.invoice_number}`, reference_table: 'invoices',
          reference_id: c.id, created_by: actorUserId,
        })
        if (ledgerErr) {
          result.flagged.push({ invoice_number: c.invoice_number, reason: `invoice updated but ledger insert failed: ${ledgerErr.message}` })
        }
      }
    } else if (c.new_total_amount > 0) {
      // Still-draft invoice, transitioning to issued/paid — insert the
      // ledger debit issueInvoice() would (mirrors lib/invoices/actions.ts).
      // Skipped entirely when the new total is 0: no new debt was created,
      // and a zero-value ledger row is invalid (debit_amount + credit_amount
      // > 0 constraint) — confirmed correct behavior during the original
      // manual reconciliation.
      const { error: ledgerErr } = await admin.from('ledger_entries').insert({
        customer_id: c.customer_id, entry_date: today, entry_type: 'invoice',
        debit_amount: c.new_total_amount.toFixed(2), credit_amount: '0.00',
        description: `Invoice ${c.invoice_number}`, reference_table: 'invoices',
        reference_id: c.id, created_by: actorUserId,
      })
      if (ledgerErr) {
        result.flagged.push({ invoice_number: c.invoice_number, reason: `invoice updated but ledger insert failed: ${ledgerErr.message}` })
      }
    }

    await admin.from('audit_logs').insert({
      user_id: actorUserId,
      action: 'surplus_reconciliation',
      table_name: 'invoices',
      record_id: c.id,
      old_value: { status: c.old_status, discount_amount: '0.00', total_amount: c.old_total_amount.toFixed(2) },
      new_value: { status: c.new_status, discount_amount: c.new_discount_amount.toFixed(2), total_amount: c.new_total_amount.toFixed(2) },
    })

    result.applied.push(c.invoice_number)
  }

  return result
}
