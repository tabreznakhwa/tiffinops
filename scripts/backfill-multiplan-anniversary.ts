// Backfill for the multi-plan combining fix in generateFixedAnniversaryInvoices.ts.
//
// 8 customers each hold 2-3 concurrent fixed plans (e.g. a separate
// Breakfast plan and a separate Dinner plan — each its own
// customer_subscriptions row). Before this fix, the generator created one
// invoice PER SUBSCRIPTION, but idx_invoices_idempotent only allows one
// invoice per (customer, invoice_type, billing_period_start) — so only each
// customer's FIRST-created plan ever got billed; every other concurrent
// plan's cycle silently failed forever. Their only currently-active
// (non-cancelled) fixed_monthly invoice is a stray, never-issued DRAFT left
// over from the old calendar-anchor generator (billing_period Aug26-Sep1,
// covering only that first plan) — a leftover from before this session's
// fixed_menu exclusion took effect, same pattern as the original
// Nazir/Hammad/Awaiz/Ahmed bug.
//
// This script:
//   1. Cancels each customer's stray draft invoice (no ledger entry exists
//      for a draft, so no reversal needed — just cancel).
//   2. Runs the real, now-fixed generateFixedAnniversaryInvoices() for
//      today — recomputes each customer's pending cycles from scratch
//      (their only non-cancelled invoice is gone) and creates one combined,
//      multi-plan DRAFT invoice per fully-elapsed monthly cycle. Can also
//      produce drafts for other fixed_menu customers whose cycle happens to
//      be due today — left as normal drafts for staff review.
//   3. Issues (status + ledger entry) only the newly-created invoices
//      belonging to these 8 target customers, matching the earlier decision
//      that this kind of correction should land issued, not sit unreviewed.
//
// DRY RUN BY DEFAULT.
//   npx tsx scripts/backfill-multiplan-anniversary.ts            (dry run)
//   npx tsx scripts/backfill-multiplan-anniversary.ts --confirm   (apply)

import fs from 'fs'
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/)
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '')
}

import { createClient } from '@supabase/supabase-js'
import { pendingCyclesFor, generateFixedAnniversaryInvoices } from '../lib/invoices/generateFixedAnniversaryInvoices'

const CONFIRM = process.argv.includes('--confirm')
const TODAY = '2026-09-11'

const TARGET_CODES = ['AC-CUST-00085', 'AC-CUST-00045', 'AC-CUST-00148', 'AC-CUST-00121', 'AC-CUST-00058', 'AC-CUST-00116', 'AC-CUST-00011', 'AC-CUST-00122']

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
) as any

async function main() {
  const { data: customers } = await admin
    .from('customers')
    .select('id, full_name, customer_code')
    .in('customer_code', TARGET_CODES)

  const { data: strayDrafts } = await admin
    .from('invoices')
    .select('id, invoice_number, customer_id, billing_period_start, billing_period_end, total_amount, status')
    .in('customer_id', customers.map((c: any) => c.id))
    .eq('invoice_type', 'fixed_monthly')
    .neq('status', 'cancelled')

  console.log(`[${CONFIRM ? 'APPLY' : 'DRY RUN'}] Backfilling combined multi-plan anniversary invoices, ${TODAY}:\n`)

  for (const cust of customers) {
    const draft = strayDrafts.find((d: any) => d.customer_id === cust.id)
    const { data: subs } = await admin
      .from('customer_subscriptions')
      .select('id, start_date, end_date, agreed_monthly_price, fixed_plans(plan_name)')
      .eq('customer_id', cust.id)
      .eq('status', 'active')
    const startDate = subs[0].start_date // all members share the same start_date for these 8
    const cycles = pendingCyclesFor(startDate, subs[0].end_date, null, TODAY)
    console.log(`${cust.full_name} (${cust.customer_code}): plans = ${subs.map((s: any) => `${s.fixed_plans?.plan_name}(${s.agreed_monthly_price})`).join(' + ')}`)
    if (draft) console.log(`  cancel stray draft ${draft.invoice_number} (${draft.total_amount}, was ${draft.billing_period_start}→${draft.billing_period_end})`)
    else console.log('  no stray draft found (unexpected — check manually)')
    console.log(`  → replaced by ${cycles.length} combined cycle(s): ${cycles.map(c => `${c.periodStart}→${c.periodEnd}`).join(', ') || '(none elapsed yet)'}`)
  }

  if (!CONFIRM) {
    console.log('\nRe-run with --confirm to cancel the stray drafts, regenerate combined month-wise drafts, and issue the 8 customers\' new invoices.')
    return
  }

  // 1. Cancel each stray draft (no ledger entry exists for a draft)
  for (const cust of customers) {
    const draft = strayDrafts.find((d: any) => d.customer_id === cust.id)
    if (!draft) continue
    const { error } = await admin
      .from('invoices')
      .update({
        status: 'cancelled',
        notes: `[${TODAY}] Cancelled — leftover from the old calendar-anchor generator, covered only this customer's first-created plan (this customer holds multiple concurrent fixed plans). Replaced with combined, month-wise invoices covering every active plan.`,
      })
      .eq('id', draft.id)
    if (error) { console.error(`${draft.invoice_number}: failed to cancel — ${error.message}`); continue }
    console.log(`Cancelled ${draft.invoice_number}`)
  }

  // 2. Run the real generator
  const result = await generateFixedAnniversaryInvoices(TODAY, 'system-cron')
  console.log(`\ngenerateFixedAnniversaryInvoices: generated=${result.generated} skipped=${result.skipped} errors=${result.errors.length}`)
  if (result.errors.length) console.log(result.errors)

  // 3. Issue only the new drafts belonging to our 8 target customers
  const { data: newDrafts } = await admin
    .from('invoices')
    .select('id, invoice_number, customer_id, total_amount, customers(full_name)')
    .in('customer_id', customers.map((c: any) => c.id))
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
