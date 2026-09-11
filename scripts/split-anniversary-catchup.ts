// Correction for scripts/backfill-anniversary-catchup.ts: that script billed
// each of the 4 customers' entire uninvoiced span (Jul/Jun–Sep) as ONE lump
// invoice. Two problems with that, caught from the customer's actual invoice
// list once issued:
//   1. It reads wrong — a single invoice straddling ~2 months, filed under
//      "Sep 2026", instead of the month-wise breakdown a customer/staff
//      expects (this is the reported bug).
//   2. It over-billed: it invoiced through YESTERDAY, but a postpaid
//      customer should only ever be billed for a cycle that has FULLY
//      elapsed (ended before today) — billing the still-in-progress current
//      cycle early would permanently knock their billing date off their own
//      anniversary again, the exact bug this whole fix exists to close out.
//
// This script:
//   1. Deletes the ledger debit for each of the 4 lump invoices (their only
//      effect on the books) and cancels the invoice itself.
//   2. Runs the real, now-deployed generateFixedAnniversaryInvoices() for
//      today — which recomputes each customer's pending cycles from
//      scratch (lastBilledThrough now null for these 4) and creates one
//      DRAFT invoice per fully-elapsed monthly cycle, exactly matching how
//      every customer will be billed from now on. This can also produce
//      draft invoices for OTHER fixed_menu customers whose cycle happens to
//      have elapsed today — expected, and left as normal drafts for staff
//      to review, same as any routine day once the daily cron is live.
//   3. Issues (status + ledger entry, same as clicking Issue) only the
//      newly-created invoices belonging to the 4 target customers, per the
//      earlier decision that their correction should land issued, not
//      sitting as an unreviewed draft.
//
// DRY RUN BY DEFAULT.
//   npx tsx scripts/split-anniversary-catchup.ts            (dry run)
//   npx tsx scripts/split-anniversary-catchup.ts --confirm   (apply)

import fs from 'fs'
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/)
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '')
}

import { createClient } from '@supabase/supabase-js'
import { pendingCyclesFor, generateFixedAnniversaryInvoices } from '../lib/invoices/generateFixedAnniversaryInvoices'

const CONFIRM = process.argv.includes('--confirm')
const TODAY = '2026-09-11' // Dubai-local today

const LUMP_INVOICE_NUMBERS = ['AC-INV-01576', 'AC-INV-01577', 'AC-INV-01578', 'AC-INV-01579']

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
) as any

async function main() {
  const { data: lumpInvoices } = await admin
    .from('invoices')
    .select('id, invoice_number, customer_id, billing_period_start, billing_period_end, total_amount, status, customers(full_name, customer_code)')
    .in('invoice_number', LUMP_INVOICE_NUMBERS)

  if (!lumpInvoices || lumpInvoices.length !== LUMP_INVOICE_NUMBERS.length) {
    console.log('WARNING: expected', LUMP_INVOICE_NUMBERS.length, 'lump invoices, found', lumpInvoices?.length ?? 0)
  }

  const { data: subs } = await admin
    .from('customer_subscriptions')
    .select('customer_id, start_date, end_date, customers(full_name, customer_code)')
    .eq('status', 'active')
    .in('customer_id', (lumpInvoices ?? []).map((i: any) => i.customer_id))

  console.log(`[${CONFIRM ? 'APPLY' : 'DRY RUN'}] Splitting lump catch-up invoices into month-wise cycles, ${TODAY}:\n`)

  for (const inv of lumpInvoices ?? []) {
    const sub = subs.find((s: any) => s.customer_id === inv.customer_id)
    const cycles = pendingCyclesFor(sub.start_date, sub.end_date, null, TODAY)
    console.log(`${sub.customers.full_name} (${sub.customers.customer_code}): cancel ${inv.invoice_number} (${inv.total_amount}, was ${inv.billing_period_start}→${inv.billing_period_end})`)
    console.log(`  → replaced by ${cycles.length} elapsed cycle(s): ${cycles.map(c => `${c.periodStart}→${c.periodEnd}`).join(', ') || '(none elapsed yet)'}`)
  }

  if (!CONFIRM) {
    console.log('\nRe-run with --confirm to cancel the lump invoices, regenerate month-wise drafts, and issue the 4 customers\' new invoices.')
    return
  }

  // 1. Reverse and cancel each lump invoice
  for (const inv of lumpInvoices ?? []) {
    const { error: ledgerDelErr } = await admin
      .from('ledger_entries')
      .delete()
      .eq('reference_table', 'invoices')
      .eq('reference_id', inv.id)
    if (ledgerDelErr) { console.error(`${inv.invoice_number}: failed to remove ledger entry — ${ledgerDelErr.message}`); continue }

    const { error: cancelErr } = await admin
      .from('invoices')
      .update({
        status: 'cancelled',
        notes: `[${TODAY}] Cancelled — this lump invoice combined multiple monthly cycles into one. Replaced with separate month-wise invoices, each covering one fully-elapsed cycle from the subscription's own anniversary date.`,
      })
      .eq('id', inv.id)
    if (cancelErr) { console.error(`${inv.invoice_number}: failed to cancel — ${cancelErr.message}`); continue }
    console.log(`Cancelled ${inv.invoice_number} and removed its ledger entry`)
  }

  // 2. Run the real generator — creates one draft per fully-elapsed cycle,
  // for these 4 customers AND any other fixed_menu customer whose cycle
  // happens to be due today (left as normal drafts for staff review).
  const result = await generateFixedAnniversaryInvoices(TODAY, 'system-cron')
  console.log(`\ngenerateFixedAnniversaryInvoices: generated=${result.generated} skipped=${result.skipped} errors=${result.errors.length}`)
  if (result.errors.length) console.log(result.errors)

  // 3. Issue only the new drafts belonging to our 4 target customers
  const targetCustomerIds = (lumpInvoices ?? []).map((i: any) => i.customer_id)
  const { data: newDrafts } = await admin
    .from('invoices')
    .select('id, invoice_number, customer_id, total_amount, customers(full_name)')
    .in('customer_id', targetCustomerIds)
    .eq('invoice_type', 'fixed_monthly')
    .eq('status', 'draft')

  for (const d of newDrafts ?? []) {
    const { error: issueErr } = await admin.from('invoices').update({ status: 'issued' }).eq('id', d.id)
    if (issueErr) { console.error(`${d.invoice_number}: failed to issue — ${issueErr.message}`); continue }

    const { error: ledgerErr } = await admin.from('ledger_entries').insert({
      customer_id: d.customer_id,
      entry_date: TODAY,
      entry_type: 'invoice',
      debit_amount: parseFloat(String(d.total_amount)).toFixed(2),
      credit_amount: '0.00',
      description: `Invoice ${d.invoice_number}`,
      reference_table: 'invoices',
      reference_id: d.id,
      created_by: null,
    })
    if (ledgerErr) { console.error(`${d.invoice_number}: issued but ledger entry failed — ${ledgerErr.message}`); continue }
    console.log(`Issued ${d.invoice_number} for ${d.customers.full_name}: ${d.total_amount}`)
  }
}

main().catch(e => { console.error(e); process.exit(1) })
