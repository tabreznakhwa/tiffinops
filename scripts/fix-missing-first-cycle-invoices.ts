// Follow-up to scripts/split-anniversary-catchup.ts.
//
// That script cancelled 4 lump catch-up invoices (Nazir/Hammad/Awaiz/Ahmed)
// and re-ran generateFixedAnniversaryInvoices() to replace them with
// month-wise cycles. It worked for every cycle EXCEPT each customer's FIRST
// one — because that first cycle's periodStart is identical to the
// now-cancelled lump invoice's billing_period_start, and the DB-level unique
// index idx_invoices_idempotent(customer_id, invoice_type,
// billing_period_start) does not exclude cancelled rows. The insert for that
// first cycle hit "duplicate key value violates unique constraint" and was
// dropped, leaving:
//   - Nazir with ZERO active invoices (his only pending cycle is that first one)
//   - Hammad, Awaiz, Ahmed each missing their first cycle (their second cycle
//     already exists and was issued: AC-INV-01585 / 01587 / 01589)
//
// Rather than inserting a new row (which would hit the same constraint
// again), this script repurposes each customer's existing CANCELLED lump
// invoice row for that same billing_period_start — updating it in place with
// the correct single-cycle period/amounts/line-items, then issuing it
// exactly like clicking Issue (status + ledger debit). This sidesteps
// idx_invoices_idempotent entirely since it's an UPDATE, not an INSERT.
//
// A separate migration (049_fixed_invoice_idempotent_exclude_cancelled.sql)
// fixes the underlying constraint for future cancel-and-replace cases; this
// script does not depend on it.
//
// DRY RUN BY DEFAULT.
//   npx tsx scripts/fix-missing-first-cycle-invoices.ts            (dry run)
//   npx tsx scripts/fix-missing-first-cycle-invoices.ts --confirm   (apply)

import fs from 'fs'
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/)
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '')
}

import { createClient } from '@supabase/supabase-js'
import { pendingCyclesFor } from '../lib/invoices/generateFixedAnniversaryInvoices'
import { computeFixedInvoiceAmounts, buildFixedPlanLineItems } from '../lib/invoices/fixedPlanInvoiceLines'
import { calcSubscriptionCharge, isMealPausedOn, type MealPause } from '../lib/fixed-menu/proration'

const CONFIRM = process.argv.includes('--confirm')
const TODAY = '2026-09-11'

const LUMP_INVOICE_NUMBERS = ['AC-INV-01576', 'AC-INV-01577', 'AC-INV-01578', 'AC-INV-01579']

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
) as any

function daySpan(from: string, to: string): number {
  const a = new Date(from + 'T00:00:00Z').getTime()
  const b = new Date(to + 'T00:00:00Z').getTime()
  return Math.round((b - a) / 86400000) + 1
}

function monthLabelFor(date: string): string {
  const [y, m] = date.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
}

async function main() {
  const { data: settingsRow } = await admin.from('app_settings').select('vat_percent').eq('id', 1).single()
  const vatRate = parseFloat(String(settingsRow?.vat_percent ?? '5'))

  const { data: lumpInvoices } = await admin
    .from('invoices')
    .select('id, invoice_number, customer_id, status, customers(full_name, customer_code)')
    .in('invoice_number', LUMP_INVOICE_NUMBERS)

  console.log(`[${CONFIRM ? 'APPLY' : 'DRY RUN'}] Repairing missing first-cycle invoices, ${TODAY}:\n`)

  for (const inv of lumpInvoices ?? []) {
    if (inv.status !== 'cancelled') {
      console.log(`${inv.customers.full_name}: ${inv.invoice_number} is "${inv.status}", not cancelled — skipping (expected this run only for cancelled rows).`)
      continue
    }

    const { data: sub } = await admin
      .from('customer_subscriptions')
      .select('id, start_date, end_date, status, agreed_monthly_price, meal_prices, fixed_plan_id, fixed_plans(plan_name, meal_periods)')
      .eq('customer_id', inv.customer_id)
      .eq('status', 'active')
      .single()

    const cycles = pendingCyclesFor(sub.start_date, sub.end_date, null, TODAY)
    const first = cycles[0]
    if (!first) {
      console.log(`${inv.customers.full_name}: no pending cycles found from scratch — nothing to repair (unexpected, check manually).`)
      continue
    }

    // Sanity check: the missing cycle must be the one that collided, i.e.
    // its periodStart must equal this lump invoice's original start (which
    // is also the subscription's own start_date).
    if (first.periodStart !== sub.start_date) {
      console.log(`${inv.customers.full_name}: first pending cycle (${first.periodStart}) doesn't match subscription start (${sub.start_date}) — skipping, needs manual review.`)
      continue
    }

    const plan = sub.fixed_plans as { plan_name: string; meal_periods: string[] | null } | null
    const rawAmount = parseFloat(String(sub.agreed_monthly_price))
    const cycleDays = daySpan(first.periodStart, first.periodEnd)

    const { data: pauseRows } = await admin
      .from('subscription_meal_pauses')
      .select('meal_period, pause_start, pause_end')
      .eq('subscription_id', sub.id)
      .lte('pause_start', first.periodEnd)
      .or(`pause_end.is.null,pause_end.gte.${first.periodStart}`)
    const pauses: MealPause[] = pauseRows ?? []

    const amount = calcSubscriptionCharge({
      mealPeriods:        plan?.meal_periods ?? [],
      agreedMonthlyPrice: rawAmount,
      mealPrices:         sub.meal_prices,
      subStart:           sub.start_date,
      subEnd:             sub.end_date,
      subStatus:          sub.status,
      pauses,
      rangeFrom:          first.periodStart,
      rangeTo:            first.periodEnd,
      cycleDays,
    })

    const { data: orders } = await admin
      .from('orders')
      .select('order_date, meal_period, total_amount')
      .eq('customer_id', inv.customer_id)
      .eq('is_credit', true)
      .not('order_status', 'in', '(cancelled,voided,draft)')
      .gte('order_date', first.periodStart)
      .lte('order_date', first.periodEnd)

    const coveredMeals = new Set(plan?.meal_periods ?? [])
    let inPlanUsage = 0
    const outOfPlanExtras: Partial<Record<'breakfast' | 'lunch' | 'dinner', number>> = {}
    for (const o of orders ?? []) {
      const amt = parseFloat(o.total_amount)
      if (coveredMeals.has(o.meal_period) && !isMealPausedOn(pauses, o.meal_period, o.order_date)) {
        inPlanUsage += amt
      } else {
        const key = o.meal_period as 'breakfast' | 'lunch' | 'dinner'
        outOfPlanExtras[key] = (outOfPlanExtras[key] ?? 0) + amt
      }
    }
    const outOfPlanTotal = Object.values(outOfPlanExtras).reduce((s, v) => s + (v ?? 0), 0)
    const amounts = computeFixedInvoiceAmounts(amount, inPlanUsage, outOfPlanTotal, vatRate)

    console.log(`${inv.customers.full_name} (${inv.customers.customer_code}): repurpose ${inv.invoice_number} as ${first.periodStart} -> ${first.periodEnd}`)
    console.log(`  plan=${amount.toFixed(2)} inPlanUsage=${inPlanUsage.toFixed(2)} outOfPlan=${outOfPlanTotal.toFixed(2)} -> total=${amounts.total_amount}`)

    if (!CONFIRM) continue

    const { error: updErr } = await admin
      .from('invoices')
      .update({
        status:                'issued',
        billing_period_start:  first.periodStart,
        billing_period_end:    first.periodEnd,
        invoice_date:          TODAY,
        due_date:              TODAY,
        ...amounts,
        notes: `[${TODAY}] Repaired: this invoice originally covered a lumped multi-month span. Corrected to its own single monthly cycle (${first.periodStart} to ${first.periodEnd}); the customer's later cycle(s) are billed separately.`,
      })
      .eq('id', inv.id)
    if (updErr) { console.error(`  FAILED to update invoice: ${updErr.message}`); continue }

    await admin.from('invoice_items').delete().eq('invoice_id', inv.id)
    const lineItems = buildFixedPlanLineItems({
      invoiceId: inv.id,
      planName: plan?.plan_name ?? 'Fixed Plan',
      monthLabel: monthLabelFor(first.periodStart),
      amount,
      inPlanUsage,
      outOfPlanExtras,
    })
    const { error: itemErr } = await admin.from('invoice_items').insert(lineItems)
    if (itemErr) { console.error(`  FAILED to insert line items: ${itemErr.message}`); continue }

    const { error: ledgerErr } = await admin.from('ledger_entries').insert({
      customer_id: inv.customer_id,
      entry_date: TODAY,
      entry_type: 'invoice',
      debit_amount: parseFloat(amounts.total_amount).toFixed(2),
      credit_amount: '0.00',
      description: `Invoice ${inv.invoice_number}`,
      reference_table: 'invoices',
      reference_id: inv.id,
      created_by: null,
    })
    if (ledgerErr) { console.error(`  FAILED to insert ledger entry: ${ledgerErr.message}`); continue }

    console.log(`  Repaired and issued ${inv.invoice_number}: ${amounts.total_amount}`)
  }

  if (!CONFIRM) console.log('\nRe-run with --confirm to apply.')
}

main().catch(e => { console.error(e); process.exit(1) })
