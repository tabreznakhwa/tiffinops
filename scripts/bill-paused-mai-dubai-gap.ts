// WRITE script — user-approved. Bills the two Mai Dubai postpaid customers
// (AC-CUST-00051 "Adnan", AC-CUST-00219 "Naeem") who got ZERO invoice for the
// 26 Aug–25 Sep 2026 shared cycle because their subscription paused mid-cycle
// (end_date inside the cycle) and both generateMonthlyInvoices.ts and
// generateFixedAnniversaryInvoices.ts only bill status='active' subscriptions
// — see scripts/diag-remaining-4.js. This is a distinct, smaller gap from the
// stray-invoice bug fixed earlier in this same incident; it's handled here as
// a targeted manual invoice rather than a change to the shared generator,
// since billing a paused subscription for its pre-pause days is a judgment
// call the user made explicitly (prorate for the active days), not a rule
// that should silently apply to every future paused subscription.
//
// Reuses the REAL production math (calcSubscriptionCharge,
// computeFixedInvoiceAmounts, buildMultiPlanLineItems) so these two invoices
// are computed exactly as generateMonthlyInvoices.ts would have, had it not
// excluded paused subscriptions — same cycleDays whole-cycle proration, same
// VAT calc, same line-item shape, same ledger debit on issue.
//
// Usage:
//   npx tsx scripts/bill-paused-mai-dubai-gap.ts            (dry run)
//   npx tsx scripts/bill-paused-mai-dubai-gap.ts --confirm    (apply)
import fs from 'fs'
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/)
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '')
}
import { createClient } from '@supabase/supabase-js'
import { formatInTimeZone } from 'date-fns-tz'
import { calcSubscriptionCharge, type MealPause } from '../lib/fixed-menu/proration'
import { computeFixedInvoiceAmounts, buildMultiPlanLineItems } from '../lib/invoices/fixedPlanInvoiceLines'

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } })

const CONFIRM = process.argv.includes('--confirm')
const CODES = ['AC-CUST-00051', 'AC-CUST-00219']
const PERIOD_START = '2026-08-26'
const PERIOD_END = '2026-09-25'
const CYCLE_DAYS = 31 // Aug26–31 (6) + Sep1–25 (25) — the fixed Mai Dubai cycle length
const MONTH_LABEL = 'September 2026'
const TODAY = '2026-09-28'

function monthLabelFor(yyyyMM: string): string {
  const [y, m] = yyyyMM.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
}

async function main() {
  const { data: settingsRow } = await admin.from('app_settings').select('vat_percent').eq('id', 1).single()
  const vatRate = parseFloat(String(settingsRow?.vat_percent ?? '5'))

  const { data: owner, error: ownerErr } = await admin.from('users').select('id, full_name').eq('role', 'owner').limit(1).single()
  if (ownerErr || !owner) throw new Error(`Could not find owner user: ${ownerErr?.message}`)

  const { data: customers, error: custErr } = await admin
    .from('customers')
    .select('id, full_name, customer_code, payment_terms, customer_type, area, status')
    .in('customer_code', CODES)
  if (custErr) throw custErr
  if (!customers?.length) throw new Error('No matching customers found')

  const customerIds = customers.map(c => c.id)

  const { data: subs, error: subsErr } = await admin
    .from('customer_subscriptions')
    .select('id, customer_id, agreed_monthly_price, meal_prices, start_date, end_date, status, fixed_plan_id, fixed_plans(plan_name, meal_periods)')
    .in('customer_id', customerIds)
  if (subsErr) throw subsErr

  const subIds = (subs ?? []).map(s => s.id)
  const { data: pauseRows } = subIds.length
    ? await admin
        .from('subscription_meal_pauses')
        .select('subscription_id, meal_period, pause_start, pause_end')
        .in('subscription_id', subIds)
        .lte('pause_start', PERIOD_END)
        .or(`pause_end.is.null,pause_end.gte.${PERIOD_START}`)
    : { data: [] as { subscription_id: string; meal_period: string; pause_start: string; pause_end: string | null }[] }
  const pausesBySub = new Map<string, MealPause[]>()
  for (const p of pauseRows ?? []) {
    const list = pausesBySub.get(p.subscription_id) ?? []
    list.push({ meal_period: p.meal_period, pause_start: p.pause_start, pause_end: p.pause_end })
    pausesBySub.set(p.subscription_id, list)
  }

  const { data: existing } = await admin
    .from('invoices')
    .select('customer_id, invoice_number, status')
    .eq('invoice_type', 'fixed_monthly')
    .eq('billing_period_start', PERIOD_START)
    .in('customer_id', customerIds)
    .neq('status', 'cancelled')

  const { data: orders } = await admin
    .from('orders')
    .select('customer_id, order_date, meal_period, total_amount')
    .in('customer_id', customerIds)
    .eq('is_credit', true)
    .not('order_status', 'in', '(cancelled,voided,draft)')
    .gte('order_date', PERIOD_START)
    .lte('order_date', PERIOD_END)

  console.log(`[${CONFIRM ? 'APPLY' : 'DRY RUN'}] Billing ${customers.length} paused-mid-cycle customer(s) for ${PERIOD_START}..${PERIOD_END}\n`)

  for (const customer of customers) {
    const already = (existing ?? []).find(i => i.customer_id === customer.id)
    if (already) {
      console.log(`${customer.full_name} (${customer.customer_code}): SKIP — already has ${already.invoice_number} (${already.status}) for this period`)
      continue
    }

    const members = (subs ?? []).filter(s => s.customer_id === customer.id)
    if (!members.length) {
      console.log(`${customer.full_name} (${customer.customer_code}): SKIP — no subscription row found`)
      continue
    }

    const planCharges: { plan: { plan_name: string; meal_periods: string[] | null } | null; amount: number; subPauses: MealPause[] }[] = []
    for (const sub of members) {
      const plan = sub.fixed_plans as unknown as { plan_name: string; meal_periods: string[] | null } | null
      const rawAmount = parseFloat(String(sub.agreed_monthly_price))
      if (!rawAmount || rawAmount <= 0) continue
      const subPauses = pausesBySub.get(sub.id) ?? []
      const amount = calcSubscriptionCharge({
        mealPeriods:        plan?.meal_periods ?? [],
        agreedMonthlyPrice: rawAmount,
        mealPrices:         sub.meal_prices,
        subStart:           sub.start_date,
        subEnd:             sub.end_date,
        subStatus:          sub.status,
        pauses:             subPauses,
        rangeFrom:          PERIOD_START,
        rangeTo:            PERIOD_END,
        cycleDays:          CYCLE_DAYS,
      })
      planCharges.push({ plan, amount, subPauses })
      console.log(`  ${customer.full_name}: plan "${plan?.plan_name ?? 'Fixed Plan'}" — sub ${sub.start_date}→${sub.end_date ?? 'open'} (${sub.status}) → AED ${amount.toFixed(2)} for the chargeable days within ${PERIOD_START}..${PERIOD_END}`)
    }

    const totalAmount = planCharges.reduce((s, p) => s + p.amount, 0)

    const coveredMeals = new Set(planCharges.flatMap(p => p.plan?.meal_periods ?? []))
    const allPauses = planCharges.flatMap(p => p.subPauses)
    let inPlanUsage = 0
    const outOfPlanExtras: Partial<Record<'breakfast' | 'lunch' | 'dinner', number>> = {}
    if (customer.customer_type === 'fixed_menu' || customer.customer_type === 'hybrid') {
      for (const o of orders ?? []) {
        if (o.customer_id !== customer.id) continue
        const amt = parseFloat(o.total_amount)
        const paused = allPauses.some(p => p.meal_period === o.meal_period && p.pause_start <= o.order_date && (p.pause_end == null || p.pause_end >= o.order_date))
        if (coveredMeals.has(o.meal_period) && !paused) {
          inPlanUsage += amt
        } else {
          const key = o.meal_period as 'breakfast' | 'lunch' | 'dinner'
          outOfPlanExtras[key] = (outOfPlanExtras[key] ?? 0) + amt
        }
      }
    }
    const outOfPlanTotal = Object.values(outOfPlanExtras).reduce((s, v) => s + (v ?? 0), 0)

    if (totalAmount <= 0 && outOfPlanTotal <= 0) {
      console.log(`${customer.full_name} (${customer.customer_code}): SKIP — computed charge is zero`)
      continue
    }

    const amounts = computeFixedInvoiceAmounts(totalAmount, inPlanUsage, outOfPlanTotal, vatRate)
    console.log(`${customer.full_name} (${customer.customer_code}): total_amount = AED ${amounts.total_amount} (subtotal ${amounts.subtotal}, tax ${amounts.tax_amount})`)

    if (!CONFIRM) continue

    const { data: invoiceNumber, error: numErr } = await admin.rpc('next_invoice_number')
    if (numErr || !invoiceNumber) {
      console.error(`  FAILED to allocate invoice number: ${numErr?.message}`)
      continue
    }

    const notes = `[${TODAY}] Manually prorated — subscription paused mid-cycle (effective ${members[0].end_date}), before which the customer was billed nothing for this cycle because generateMonthlyInvoices.ts only bills status='active' subscriptions. Charged for the active days from ${PERIOD_START} through the pause date only, using the same whole-cycle proration math (calcSubscriptionCharge, cycleDays=${CYCLE_DAYS}) the generator itself uses. See scripts/bill-paused-mai-dubai-gap.ts.`

    const { data: invoice, error: insertErr } = await admin
      .from('invoices')
      .insert({
        invoice_number:       invoiceNumber as string,
        customer_id:          customer.id,
        invoice_date:         TODAY,
        due_date:             PERIOD_END,
        invoice_type:         'fixed_monthly',
        billing_period_start: PERIOD_START,
        billing_period_end:   PERIOD_END,
        ...amounts,
        status:               'issued',
        notes,
        created_by:           owner.id,
      })
      .select('id')
      .single()

    if (insertErr || !invoice) {
      console.error(`  FAILED to insert invoice: ${insertErr?.message}`)
      continue
    }

    const lineItems = buildMultiPlanLineItems({
      invoiceId:  invoice.id,
      monthLabel: MONTH_LABEL,
      plans:      planCharges.map(p => ({ planName: p.plan?.plan_name ?? 'Fixed Plan', amount: p.amount })),
      inPlanUsage,
      outOfPlanExtras,
    })
    const { error: itemErr } = await admin.from('invoice_items').insert(lineItems)
    if (itemErr) {
      await admin.from('invoices').delete().eq('id', invoice.id)
      console.error(`  FAILED to insert invoice_items, rolled back invoice: ${itemErr.message}`)
      continue
    }

    const { error: ledgerErr } = await admin.from('ledger_entries').insert({
      customer_id:     customer.id,
      entry_date:      TODAY,
      entry_type:      'invoice',
      debit_amount:    amounts.total_amount,
      credit_amount:   '0.00',
      description:     `Invoice ${invoiceNumber}`,
      reference_table: 'invoices',
      reference_id:    invoice.id,
      created_by:      owner.id,
    })
    if (ledgerErr) {
      await admin.from('invoices').update({ status: 'draft' }).eq('id', invoice.id)
      console.error(`  FAILED to insert ledger entry, reverted invoice to draft: ${ledgerErr.message}`)
      continue
    }

    console.log(`  → Created ${invoiceNumber}, issued, AED ${amounts.total_amount}`)
  }

  if (!CONFIRM) console.log('\nRe-run with --confirm to create these invoices.')
}
main().catch(e => { console.error('FAILED:', e.message); process.exit(1) })
