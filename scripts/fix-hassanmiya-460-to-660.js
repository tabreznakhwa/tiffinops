// WRITE script — user-approved correction (option 1) for Hassan Miya
// (AC-CUST-00181): void AC-INV-01479 (billed AED 460 against a stale
// subscription row that was corrected the same day) and reissue a fresh
// fixed_monthly invoice for the same Sep 2026 cycle at the correct AED 660
// (his active "Hassanmiya 660" plan). Mirrors lib/invoices/actions.ts'
// voidInvoice() + createInvoice()/issueInvoice() logic exactly, run via the
// admin client since this is a one-off script, not an authenticated request.
const fs = require('fs')
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/)
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '')
}
const { createClient } = require('@supabase/supabase-js')
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

const OLD_INVOICE_ID = '8022628d-819b-4362-a53e-d1cbbc0aba39' // AC-INV-01479
const CUSTOMER_ID    = '2d96885c-192f-4a29-81d6-1b2a9b8534a5' // Hassan Miya
const OWNER_ID       = 'a277b0b4-7869-4c7f-bab3-99b522d249f3' // tabrez nakhwa (owner)
const VAT_RATE       = 5
const NEW_TOTAL      = 660

async function main() {
  // 0. Re-verify preconditions right before writing
  const { data: old, error: oldErr } = await admin
    .from('invoices')
    .select('id, invoice_number, status, total_amount, customer_id, billing_period_start, billing_period_end, due_date')
    .eq('id', OLD_INVOICE_ID)
    .single()
  if (oldErr || !old) throw new Error(`Old invoice lookup failed: ${oldErr?.message}`)
  if (old.customer_id !== CUSTOMER_ID) throw new Error('Old invoice customer mismatch — aborting')
  if (old.status !== 'issued') throw new Error(`Expected old invoice status 'issued', got '${old.status}' — aborting`)
  if (parseFloat(String(old.total_amount)) !== 460) throw new Error(`Expected old total 460, got ${old.total_amount} — aborting`)

  const { data: appliedPayments } = await admin
    .from('payments')
    .select('id')
    .eq('invoice_id', OLD_INVOICE_ID)
    .is('voided_at', null)
  if (appliedPayments && appliedPayments.length > 0) {
    throw new Error(`Old invoice has ${appliedPayments.length} payment(s) applied — aborting, needs manual handling`)
  }

  const { data: oldLedger } = await admin
    .from('ledger_entries')
    .select('id, debit_amount')
    .eq('reference_table', 'invoices')
    .eq('reference_id', OLD_INVOICE_ID)
    .is('reversal_of', null)

  console.log('Preconditions OK. Old invoice:', old)
  console.log('Old ledger entries to reverse:', oldLedger)

  const today = '2026-09-11'

  // 1. Void the old invoice FIRST — idx_invoices_idempotent (unique on
  // customer_id, invoice_type, billing_period_start, excluding cancelled)
  // would otherwise reject the new invoice while the old one is still
  // 'issued' for the same period.
  const { error: voidErr } = await admin
    .from('invoices')
    .update({
      status: 'cancelled',
      notes: `Corrected ${today}: superseded by a reissued invoice at the correct AED 660 (Hassanmiya 660 plan) — this invoice was billed against a stale AED 460 subscription that was corrected the same day it was generated.`,
    })
    .eq('id', OLD_INVOICE_ID)
    .in('status', ['draft', 'issued'])
  if (voidErr) throw new Error(`Voiding old invoice failed: ${voidErr.message}`)
  console.log('Old invoice voided:', old.invoice_number)

  // 2. Generate the new invoice number
  const { data: invNum, error: numErr } = await admin.rpc('next_invoice_number')
  if (numErr || !invNum) {
    await admin.from('invoices').update({ status: 'issued', notes: null }).eq('id', OLD_INVOICE_ID)
    throw new Error(`next_invoice_number failed (old invoice restored): ${numErr?.message}`)
  }
  console.log('New invoice number:', invNum)

  const subtotal = NEW_TOTAL
  const taxAmount = (subtotal * VAT_RATE) / (100 + VAT_RATE)

  // 3. Insert the corrected invoice (issued directly — original was already issued)
  const { data: newInvoice, error: insErr } = await admin
    .from('invoices')
    .insert({
      invoice_number: invNum,
      customer_id: CUSTOMER_ID,
      invoice_date: today,
      due_date: old.due_date, // preserve original prepaid due-at-cycle-start date (2026-09-01)
      invoice_type: 'fixed_monthly',
      billing_period_start: old.billing_period_start,
      billing_period_end: old.billing_period_end,
      subtotal: subtotal.toFixed(2),
      discount_amount: '0.00',
      tax_amount: taxAmount.toFixed(2),
      total_amount: subtotal.toFixed(2),
      status: 'issued',
      notes: `Reissued ${today} correcting AED 460→660: superseded ${old.invoice_number}, which billed against a subscription that was corrected the same day it was generated (old 460 "Basic Lunch & Dinner" row retroactively ended 2026-07-02; active plan since is "Hassanmiya 660").`,
      created_by: OWNER_ID,
    })
    .select('id, invoice_number')
    .single()
  if (insErr || !newInvoice) {
    await admin.from('invoices').update({ status: 'issued', notes: null }).eq('id', OLD_INVOICE_ID)
    throw new Error(`New invoice insert failed (old invoice restored): ${insErr?.message}`)
  }
  console.log('New invoice created:', newInvoice)

  // 3. Line item
  const { error: itemErr } = await admin.from('invoice_items').insert({
    invoice_id: newInvoice.id,
    order_id: null,
    description: 'Monthly Fixed Plan — Hassanmiya 660 — September 2026 (corrected)',
    quantity: '1',
    unit_price: NEW_TOTAL.toFixed(2),
    total_price: NEW_TOTAL.toFixed(2),
  })
  if (itemErr) {
    await admin.from('invoices').delete().eq('id', newInvoice.id)
    throw new Error(`Line item insert failed (new invoice rolled back): ${itemErr.message}`)
  }

  // 4. Ledger debit for the new invoice (mirrors issueInvoice())
  const { error: ledgerErr } = await admin.from('ledger_entries').insert({
    customer_id: CUSTOMER_ID,
    entry_date: today,
    entry_type: 'invoice',
    debit_amount: NEW_TOTAL.toFixed(2),
    credit_amount: '0.00',
    description: `Invoice ${newInvoice.invoice_number}`,
    reference_table: 'invoices',
    reference_id: newInvoice.id,
    created_by: OWNER_ID,
  })
  if (ledgerErr) console.error('WARNING: ledger debit insert for new invoice failed:', ledgerErr.message)

  // 5. Now that we know the new invoice number, update the void note to
  // reference it (best-effort — the invoice is already correctly voided)
  await admin
    .from('invoices')
    .update({
      notes: `Corrected ${today}: superseded by ${newInvoice.invoice_number} at the correct AED 660 (Hassanmiya 660 plan) — this invoice was billed against a stale AED 460 subscription that was corrected the same day it was generated.`,
    })
    .eq('id', OLD_INVOICE_ID)

  // 6. Reverse the old invoice's ledger debit (audit-trail correctness — this
  // table isn't read by any current dashboard, but keep it consistent)
  for (const entry of oldLedger ?? []) {
    const { error: revErr } = await admin.from('ledger_entries').insert({
      customer_id: CUSTOMER_ID,
      entry_date: today,
      entry_type: 'invoice',
      debit_amount: '0.00',
      credit_amount: entry.debit_amount,
      description: `Reversal of Invoice ${old.invoice_number} (voided — superseded by ${newInvoice.invoice_number})`,
      reference_table: 'invoices',
      reference_id: OLD_INVOICE_ID,
      reversal_of: entry.id,
      created_by: OWNER_ID,
    })
    if (revErr) console.error('WARNING: ledger reversal insert failed:', revErr.message)
  }

  console.log('\nDone. Summary:')
  console.log(`  Voided:   ${old.invoice_number} (AED 460)`)
  console.log(`  Reissued: ${newInvoice.invoice_number} (AED ${NEW_TOTAL})`)
}

main().catch(e => { console.error('FAILED:', e.message); process.exit(1) })
