// One-off correction for the 4 postpaid fixed_menu customers found stuck on
// the old calendar-month billing system with a never-invoiced mid-month
// first partial month AND a stale unissued Aug draft (Nazir, Ahmed, Hammad,
// Awaiz — see conversation for the investigation: Outstanding showed real
// money owed with no payable invoice behind it).
//
// For each customer this:
//   1. Cancels their stale 1–31 Aug fixed_monthly DRAFT (never issued, so no
//      ledger entry exists to reverse — a plain status flip is enough).
//   2. Generates ONE clean catch-up invoice covering their entire
//      uninvoiced-to-date span — subscription start_date through yesterday
//      (today's day is still in progress, never bill an incomplete day) —
//      using the exact same calcSubscriptionCharge/fixed-plan-line logic the
//      real generators use, so the total reconciles with what the
//      Outstanding report already shows for the "Plan" + "Orders" portions.
//   3. Issues it immediately (status='issued' + ledger debit entry, same
//      effect as clicking Issue in the app) — no back-office data-fix should
//      leave a floating unactionable draft, which is exactly the bug this
//      is meant to close out.
//
// After this runs, generateFixedAnniversaryInvoices (once deployed) picks up
// each customer from the day after this catch-up invoice's billing_period_end
// and bridges them onto their own start-date anniversary from there — see
// lib/invoices/generateFixedAnniversaryInvoices.ts.
//
// DRY RUN BY DEFAULT — prints the computed invoice for each customer, writes
// nothing.
//   npx tsx scripts/backfill-anniversary-catchup.ts            (dry run)
//   npx tsx scripts/backfill-anniversary-catchup.ts --confirm   (apply)

import fs from 'fs'
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/)
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '')
}

import { createClient } from '@supabase/supabase-js'
import { calcSubscriptionCharge, type MealPause } from '../lib/fixed-menu/proration'
import { computeFixedInvoiceAmounts, buildFixedPlanLineItems } from '../lib/invoices/fixedPlanInvoiceLines'

const CONFIRM = process.argv.includes('--confirm')
const TODAY = '2026-09-11' // Dubai-local today
const YESTERDAY = '2026-09-10'
const ACTOR_ID = 'system-cron'

const TARGET_CODES = ['AC-CUST-00156', 'AC-CUST-00157', 'AC-CUST-00158', 'AC-CUST-00161'] // Nazir, Ahmed, Hammad, Awaiz

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
) as any

function monthLabelFor(date: string): string {
  const [y, m] = date.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
}

async function main() {
  const owner = ACTOR_ID === 'system-cron' ? null : ACTOR_ID

  const { data: settingsRow } = await admin.from('app_settings').select('vat_percent').eq('id', 1).single()
  const vatRate = parseFloat(String(settingsRow?.vat_percent ?? '5'))

  const { data: subs } = await admin
    .from('customer_subscriptions')
    .select(`
      id, customer_id, start_date, end_date, status, agreed_monthly_price, meal_prices,
      fixed_plans(plan_name, meal_periods),
      customers(id, full_name, customer_code, customer_type)
    `)
    .in('status', ['active'])

  const targets = (subs ?? []).filter((s: any) => TARGET_CODES.includes(s.customers?.customer_code))
  if (targets.length !== TARGET_CODES.length) {
    console.log('WARNING: expected', TARGET_CODES.length, 'active subscriptions, found', targets.length)
  }

  const custIds = targets.map((s: any) => s.customer_id)

  // Their stale Aug drafts — to cancel
  const { data: staleDrafts } = await admin
    .from('invoices')
    .select('id, invoice_number, customer_id, status, total_amount')
    .in('customer_id', custIds)
    .eq('invoice_type', 'fixed_monthly')
    .eq('status', 'draft')

  // Credit orders across each customer's full uninvoiced span
  const { data: orders } = await admin
    .from('orders')
    .select('customer_id, order_date, meal_period, total_amount')
    .in('customer_id', custIds)
    .eq('is_credit', true)
    .not('order_status', 'in', '(cancelled,voided,draft)')
    .lte('order_date', YESTERDAY)

  const plan: {
    customer: string; code: string
    invoiceId?: string
    start_date: string; billing_period_end: string
    amount: number; inPlanUsage: number; outOfPlanExtras: Record<string, number>
    header: ReturnType<typeof computeFixedInvoiceAmounts>
    staleDraftId: string | null; staleDraftNumber: string | null
  }[] = []

  for (const s of targets) {
    const customer = s.customers
    const planInfo = s.fixed_plans as { plan_name: string; meal_periods: string[] | null } | null
    const rawAmount = parseFloat(String(s.agreed_monthly_price))

    const amount = calcSubscriptionCharge({
      mealPeriods:        planInfo?.meal_periods ?? [],
      agreedMonthlyPrice: rawAmount,
      mealPrices:         s.meal_prices,
      subStart:           s.start_date,
      subEnd:             s.end_date,
      subStatus:          s.status,
      pauses:             [] as MealPause[], // none of these 4 have any meal pauses (verified during investigation)
      rangeFrom:          s.start_date,
      rangeTo:            YESTERDAY,
    })

    const coveredMeals = new Set(planInfo?.meal_periods ?? [])
    let inPlanUsage = 0
    const outOfPlanExtras: Record<string, number> = {}
    for (const o of orders ?? []) {
      if (o.customer_id !== s.customer_id) continue
      if (o.order_date < s.start_date || o.order_date > YESTERDAY) continue
      const amt = parseFloat(o.total_amount)
      if (coveredMeals.has(o.meal_period)) inPlanUsage += amt
      else outOfPlanExtras[o.meal_period] = (outOfPlanExtras[o.meal_period] ?? 0) + amt
    }
    const outOfPlanTotal = Object.values(outOfPlanExtras).reduce((a, b) => a + b, 0)
    const header = computeFixedInvoiceAmounts(amount, inPlanUsage, outOfPlanTotal, vatRate)

    const draft = (staleDrafts ?? []).find((d: any) => d.customer_id === s.customer_id)

    plan.push({
      customer: customer.full_name, code: customer.customer_code,
      start_date: s.start_date, billing_period_end: YESTERDAY,
      amount, inPlanUsage, outOfPlanExtras, header,
      staleDraftId: draft?.id ?? null, staleDraftNumber: draft?.invoice_number ?? null,
    })
  }

  console.log(`[${CONFIRM ? 'APPLY' : 'DRY RUN'}] Catch-up invoices, ${TODAY}:\n`)
  console.table(plan.map(p => ({
    customer: p.customer, code: p.code,
    period: `${p.start_date} → ${p.billing_period_end}`,
    plan_charge: p.amount.toFixed(2),
    in_plan_usage: p.inPlanUsage.toFixed(2),
    out_of_plan: Object.entries(p.outOfPlanExtras).map(([k, v]) => `${k}:${v.toFixed(2)}`).join(' ') || '—',
    total: p.header.total_amount,
    cancels_draft: p.staleDraftNumber ?? '(none found)',
  })))

  if (!CONFIRM) {
    console.log('\nRe-run with --confirm to cancel the stale drafts and issue these invoices.')
    return
  }

  for (const p of plan) {
    if (p.staleDraftId) {
      const { error } = await admin
        .from('invoices')
        .update({
          status: 'cancelled',
          notes: `[${TODAY}] Cancelled — superseded by a corrected catch-up invoice covering ${p.start_date} to ${p.billing_period_end} (the original draft only covered Aug and missed the mid-month join period).`,
        })
        .eq('id', p.staleDraftId)
      if (error) { console.error(`${p.customer}: failed to cancel stale draft — ${error.message}`); continue }
    }

    const { data: invoiceNumber, error: numErr } = await admin.rpc('next_invoice_number')
    if (numErr || !invoiceNumber) { console.error(`${p.customer}: could not generate invoice number`); continue }

    const { data: invoice, error: insertErr } = await admin
      .from('invoices')
      .insert({
        invoice_number:        invoiceNumber,
        customer_id:           targets.find((s: any) => s.customers.customer_code === p.code).customer_id,
        invoice_date:          TODAY,
        due_date:              TODAY,
        invoice_type:          'fixed_monthly',
        billing_period_start:  p.start_date,
        billing_period_end:    p.billing_period_end,
        ...p.header,
        status:                'issued',
        notes:                 `[${TODAY}] Catch-up invoice: first mid-month join period was never billed under the old calendar-month system — this covers everything from subscription start through ${p.billing_period_end} in one invoice.`,
        created_by:            owner,
      })
      .select('id')
      .single()

    if (insertErr || !invoice) { console.error(`${p.customer}: ${insertErr?.message ?? 'insert failed'}`); continue }

    const sub = targets.find((s: any) => s.customers.customer_code === p.code)
    const planInfo = sub.fixed_plans as { plan_name: string } | null
    const lineItems = buildFixedPlanLineItems({
      invoiceId: invoice.id,
      planName:  planInfo?.plan_name ?? 'Fixed Plan',
      monthLabel: `${monthLabelFor(p.start_date)} – ${monthLabelFor(p.billing_period_end)}`,
      amount: p.amount,
      inPlanUsage: p.inPlanUsage,
      outOfPlanExtras: p.outOfPlanExtras as any,
      prorationNote: undefined,
    })
    const { error: itemErr } = await admin.from('invoice_items').insert(lineItems)
    if (itemErr) { console.error(`${p.customer}: line items failed — ${itemErr.message}`); continue }

    const { error: ledgerErr } = await admin.from('ledger_entries').insert({
      customer_id: sub.customer_id,
      entry_date: TODAY,
      entry_type: 'invoice',
      debit_amount: p.header.total_amount,
      credit_amount: '0.00',
      description: `Invoice ${invoiceNumber}`,
      reference_table: 'invoices',
      reference_id: invoice.id,
      created_by: owner,
    })
    if (ledgerErr) { console.error(`${p.customer}: ledger entry failed — ${ledgerErr.message}`); continue }

    console.log(`${p.customer}: cancelled ${p.staleDraftNumber ?? '(no stale draft)'}, issued ${invoiceNumber} for ${p.header.total_amount}`)
  }
}

main().catch(e => { console.error(e); process.exit(1) })
