// Settle fixed_menu draft invoices against historical unlinked payments.
//
// For each fixed_menu customer's draft (or already-issued-but-untouched)
// invoice, if they have "surplus" payments (money paid historically that
// was never linked to any invoice and isn't accounted for by anything
// already issued/partial/paid/overdue), applies a discount equal to that
// surplus and lets it land on Paid or Issued (at the smaller, accurate
// remaining balance) per the same rule reconcile.ts uses. Skips the 8
// fixed_menu drafts with no surplus gap entirely — those are genuinely just
// unbilled.
//
// Handles two starting states, since invoices in this batch may get worked
// by hand in the app in parallel with this script running:
//   - still 'draft'  → apply discount, then issue (insert new ledger debit)
//   - already 'issued', not yet discounted (discount_amount still 0) →
//     apply discount only, CORRECT the existing ledger debit in place
//     instead of inserting a second one (same pattern updateInvoice() uses
//     for edits to already-issued invoices)
// Anything else (already discounted, paid, partial, cancelled, etc.) is
// left alone.
//
// DRY RUN BY DEFAULT — prints the proposed table, writes nothing.
// Run with --confirm to actually apply the changes.
//
//   node scripts/settle-fixed-menu-drafts.js            (dry run)
//   node scripts/settle-fixed-menu-drafts.js --confirm  (writes for real)

const fs = require('fs')
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/)
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '')
}
const { createClient } = require('@supabase/supabase-js')
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

const CONFIRM = process.argv.includes('--confirm')
const TODAY = '2026-08-15' // Asia/Dubai date at time of writing this script

async function loadOwnerId() {
  const { data, error } = await admin.from('users').select('id, full_name').eq('role', 'owner').limit(1).single()
  if (error || !data) throw new Error('Could not find an owner user for created_by attribution: ' + (error?.message ?? 'none found'))
  return data.id
}

async function computeCandidates() {
  const { data: settingsRow } = await admin.from('app_settings').select('vat_percent').eq('id', 1).single()
  const vatRate = parseFloat(String(settingsRow?.vat_percent ?? '5'))

  // Scoped strictly to the frozen 2026-07-28 batch this reconciliation
  // covers (confirmed via audit-fixed-menu-drafts.js — all 35 fixed_menu
  // drafts from that batch share this exact invoice_date). Deliberately NOT
  // an open-ended status query — an earlier draft of this script queried
  // status IN ('draft','issued') with no date bound and pulled in 17
  // unrelated already-issued invoices from a completely different batch.
  // Never widen this without re-auditing the new scope first.
  const BATCH_DATE = '2026-07-28'
  const { data: drafts } = await admin
    .from('invoices')
    .select('id, invoice_number, status, invoice_date, subtotal, discount_amount, tax_amount, total_amount, notes, customer_id, customers(customer_type)')
    .eq('invoice_date', BATCH_DATE)
    .in('status', ['draft', 'issued'])

  const fixedDrafts = (drafts ?? []).filter(d => d.customers?.customer_type === 'fixed_menu' && parseFloat(d.discount_amount) === 0)
  const fixedDraftIds = new Set(fixedDrafts.map(d => d.id))
  const customerIds = [...new Set(fixedDrafts.map(d => d.customer_id))]

  const { data: otherInvoices } = await admin
    .from('invoices').select('id, customer_id, total_amount, status')
    .in('customer_id', customerIds).in('status', ['issued', 'partial', 'paid', 'overdue'])
  const invoicedByCustomer = new Map()
  for (const inv of otherInvoices ?? []) {
    // Exclude the batch invoices themselves — one of them (AC-INV-01064)
    // is now 'issued' too (manually, since the audit ran), and would
    // otherwise count as "already invoiced elsewhere" against its own
    // surplus, silently zeroing out its own discount.
    if (fixedDraftIds.has(inv.id)) continue
    invoicedByCustomer.set(inv.customer_id, (invoicedByCustomer.get(inv.customer_id) || 0) + parseFloat(inv.total_amount))
  }

  const { data: payments } = await admin
    .from('payments').select('customer_id, amount')
    .in('customer_id', customerIds).is('voided_at', null)
  const paidByCustomer = new Map()
  for (const p of payments ?? []) paidByCustomer.set(p.customer_id, (paidByCustomer.get(p.customer_id) || 0) + parseFloat(p.amount))

  const candidates = []
  for (const inv of fixedDrafts) {
    const invoiced = invoicedByCustomer.get(inv.customer_id) || 0
    const paid = paidByCustomer.get(inv.customer_id) || 0
    const surplus = Math.max(0, paid - invoiced)
    const subtotal = parseFloat(inv.subtotal)
    const impliedDiscount = Math.min(surplus, subtotal)
    if (impliedDiscount <= 0) continue // no gap — leave untouched

    const newDiscountAmount = impliedDiscount
    const newTotal = Math.max(0, subtotal - newDiscountAmount)
    const newTax = (newTotal * vatRate) / (100 + vatRate)
    const remaining = newTotal
    const nextStatus = 0 >= newTotal - 0.01 ? 'paid' : 'issued' // paid=0 since no payment linked to this invoice

    const note = `[Reconciliation ${TODAY}] AED ${impliedDiscount.toFixed(2)} already covered by historical payment(s) recorded before invoice-linking existed (customer paid-to-date AED ${paid.toFixed(2)}, already invoiced elsewhere AED ${invoiced.toFixed(2)}). Discount applied to avoid double-billing. Remaining balance AED ${remaining.toFixed(2)} is genuinely still due.`
    const newNotes = inv.notes ? `${inv.notes}\n${note}` : note

    candidates.push({
      id: inv.id,
      invoice_number: inv.invoice_number,
      customer_id: inv.customer_id,
      old_status: inv.status,
      subtotal,
      old_discount_amount: parseFloat(inv.discount_amount),
      old_total_amount: parseFloat(inv.total_amount),
      new_discount_amount: newDiscountAmount,
      new_tax_amount: newTax,
      new_total_amount: newTotal,
      new_status: nextStatus,
      new_notes: newNotes,
    })
  }
  candidates.sort((a, b) => b.new_discount_amount - a.new_discount_amount)
  return candidates
}

async function main() {
  const candidates = await computeCandidates()

  console.log(`${CONFIRM ? 'CONFIRM MODE — writing for real' : 'DRY RUN — no writes will be made'}`)
  console.log(`\n${candidates.length} draft invoices to settle:\n`)
  console.table(candidates.map(c => ({
    invoice_number: c.invoice_number,
    old_status: c.old_status,
    old_total: c.old_total_amount.toFixed(2),
    discount: c.new_discount_amount.toFixed(2),
    new_total: c.new_total_amount.toFixed(2),
    new_status: c.new_status,
  })))

  const totalDiscount = candidates.reduce((s, c) => s + c.new_discount_amount, 0)
  const totalNewDebit = candidates.reduce((s, c) => s + c.new_total_amount, 0)
  const paidCount = candidates.filter(c => c.new_status === 'paid').length
  const issuedCount = candidates.filter(c => c.new_status === 'issued').length
  console.log(`\nTotals: ${candidates.length} invoices, AED ${totalDiscount.toFixed(2)} total discount applied, AED ${totalNewDebit.toFixed(2)} total new ledger debit`)
  console.log(`Resulting status: ${paidCount} → Paid, ${issuedCount} → Issued (with reduced balance)`)

  if (!CONFIRM) {
    console.log('\nDry run only — re-run with --confirm to apply these changes.')
    return
  }

  const ownerId = await loadOwnerId()
  console.log(`\nApplying changes, attributed to owner user ${ownerId}...\n`)

  let succeeded = 0
  let skipped = 0
  for (const c of candidates) {
    // Re-check status/discount at write time so a re-run never double-processes,
    // and so it self-adapts if the invoice was worked by hand in the app
    // between the dry run and this run.
    const { data: fresh } = await admin.from('invoices').select('status, discount_amount').eq('id', c.id).single()
    if (!fresh || !['draft', 'issued'].includes(fresh.status) || parseFloat(fresh.discount_amount) !== 0) {
      console.log(`SKIP ${c.invoice_number} — no longer eligible (status: ${fresh?.status ?? 'not found'}, discount_amount: ${fresh?.discount_amount ?? 'n/a'})`)
      skipped++
      continue
    }
    const wasAlreadyIssued = fresh.status === 'issued'

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
    if (updateErr) {
      console.log(`ERROR updating ${c.invoice_number}: ${updateErr.message}`)
      continue
    }

    if (wasAlreadyIssued) {
      // Already issued — a ledger debit for the old (undiscounted) total
      // already exists. Correct it in place rather than inserting a second
      // debit, same as updateInvoice() does for edits to issued invoices.
      const { data: existingLedger } = await admin
        .from('ledger_entries')
        .select('id')
        .eq('reference_table', 'invoices')
        .eq('reference_id', c.id)
        .limit(1)
      if (existingLedger && existingLedger.length > 0) {
        const { error: ledgerUpdateErr } = await admin
          .from('ledger_entries')
          .update({ debit_amount: c.new_total_amount.toFixed(2) })
          .eq('id', existingLedger[0].id)
        if (ledgerUpdateErr) {
          console.log(`ERROR correcting ledger entry for ${c.invoice_number}: ${ledgerUpdateErr.message} — invoice was updated but ledger is now stale, check manually`)
        }
      } else {
        console.log(`WARNING: ${c.invoice_number} was already issued but had no ledger_entries row — inserting one now`)
        const { error: ledgerErr } = await admin.from('ledger_entries').insert({
          customer_id: c.customer_id, entry_date: TODAY, entry_type: 'invoice',
          debit_amount: c.new_total_amount.toFixed(2), credit_amount: '0.00',
          description: `Invoice ${c.invoice_number}`, reference_table: 'invoices',
          reference_id: c.id, created_by: ownerId,
        })
        if (ledgerErr) console.log(`ERROR inserting ledger entry for ${c.invoice_number}: ${ledgerErr.message}`)
      }
    } else {
      const { error: ledgerErr } = await admin.from('ledger_entries').insert({
        customer_id: c.customer_id,
        entry_date: TODAY,
        entry_type: 'invoice',
        debit_amount: c.new_total_amount.toFixed(2),
        credit_amount: '0.00',
        description: `Invoice ${c.invoice_number}`,
        reference_table: 'invoices',
        reference_id: c.id,
        created_by: ownerId,
      })
      if (ledgerErr) {
        console.log(`ERROR inserting ledger entry for ${c.invoice_number}: ${ledgerErr.message} — invoice was updated but ledger entry failed, check manually`)
      }
    }

    const { error: auditErr } = await admin.from('audit_logs').insert({
      user_id: ownerId,
      action: 'fixed_menu_draft_reconciliation',
      table_name: 'invoices',
      record_id: c.id,
      old_value: { status: c.old_status, discount_amount: c.old_discount_amount, total_amount: c.old_total_amount },
      new_value: { status: c.new_status, discount_amount: c.new_discount_amount, total_amount: c.new_total_amount },
    })
    if (auditErr) {
      console.log(`WARNING: audit log insert failed for ${c.invoice_number}: ${auditErr.message}`)
    }

    console.log(`OK ${c.invoice_number} → ${c.new_status}, total AED ${c.new_total_amount.toFixed(2)}`)
    succeeded++
  }

  console.log(`\nDone: ${succeeded} settled, ${skipped} skipped (already changed since dry run).`)
}

main()
