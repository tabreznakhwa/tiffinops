// One-off: fix Umair Muteena's (AC-CUST-00163) subscription record and the
// resulting stale invoice.
//
// Confirmed facts (from the owner):
//   - Real start date is 2026-06-01, not the recorded 2026-06-10. The 9-day
//     gap (Jun 1-9) this uncovers was never invoiced and is being left
//     uncharged deliberately (no backbilling for it).
//   - He was served dinner continuously Jun 1 - Aug 31, then paused Sep 1
//     (end_date = 2026-09-01, already correct).
//   - AC-INV-01523 (Aug 10 - Sep 9 cycle) was left stale at a flat AED 200
//     after the pause, because it was never reconciled — it should reflect
//     only the 23 days actually served (Aug 10 - Sep 1) out of that 31-day
//     cycle, using the now-fixed cycle-based proration in
//     lib/fixed-menu/proration.ts.
//
// This script:
//   1. Corrects customer_subscriptions.start_date to 2026-06-01.
//   2. Runs the real, unmodified reconcileInvoicesForSubscription for this
//      subscription — since no existing invoice covers Jun 1-9, that gap
//      stays unbilled automatically; only AC-INV-01523 has a fresh amount
//      that differs from what's on it today, so only it gets adjusted.
//
// Dry-run by default (shows current state + the fresh amount each invoice
// would reconcile to, no writes). Pass --confirm to actually apply it.
//
// Usage:
//   npx tsx scripts/reconcile-umair-muteena.ts            (dry run)
//   npx tsx scripts/reconcile-umair-muteena.ts --confirm   (apply)

import fs from 'fs'
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/)
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '')
}

import { createClient } from '@supabase/supabase-js'
import { reconcileInvoicesForSubscription } from '../lib/fixed-menu/subscription-approval'
import { calcSubscriptionCharge } from '../lib/fixed-menu/proration'

const CONFIRM = process.argv.includes('--confirm')
const SUBSCRIPTION_ID = '208ce65e-6780-4dfe-9c39-58943240ce10' // Umair Muteena's Dinner 200 subscription
const CUSTOMER_ID = 'ea1d88e2-607a-4767-a48a-00be3d37d5fc'
const CORRECT_START_DATE = '2026-06-01'
const ACTOR_ID = 'system-script'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
) as any // loose type — this script only needs the runtime client, not the full generated Database type

function daySpan(from: string, to: string): number {
  const a = new Date(from + 'T00:00:00Z').getTime()
  const b = new Date(to + 'T00:00:00Z').getTime()
  return Math.round((b - a) / 86400000) + 1
}

async function snapshot() {
  const { data } = await admin
    .from('invoices')
    .select('invoice_number, billing_period_start, billing_period_end, subtotal, tax_amount, total_amount, status')
    .eq('customer_id', CUSTOMER_ID)
    .order('billing_period_start')
  console.table(data)
}

async function main() {
  console.log('--- BEFORE ---')
  await snapshot()

  const { data: sub } = await admin
    .from('customer_subscriptions')
    .select('start_date, end_date, status, agreed_monthly_price, meal_prices, fixed_plans(meal_periods)')
    .eq('id', SUBSCRIPTION_ID)
    .single()
  console.log('\ncurrent subscription row:', sub)

  if (!CONFIRM) {
    const plan = sub.fixed_plans as { meal_periods: string[] }
    const { data: invs } = await admin
      .from('invoices')
      .select('invoice_number, billing_period_start, billing_period_end, total_amount')
      .eq('customer_id', CUSTOMER_ID)
      .in('status', ['issued', 'partial', 'paid'])
    console.log('\n[DRY RUN] fresh amount per invoice, using the subscription\'s current start_date (', sub.start_date, ') (no writes yet):')
    for (const inv of invs) {
      const fresh = calcSubscriptionCharge({
        mealPeriods: plan.meal_periods,
        agreedMonthlyPrice: parseFloat(String(sub.agreed_monthly_price)),
        mealPrices: sub.meal_prices,
        subStart: sub.start_date,
        subEnd: sub.end_date,
        subStatus: sub.status,
        pauses: [],
        rangeFrom: inv.billing_period_start,
        rangeTo: inv.billing_period_end,
        cycleDays: daySpan(inv.billing_period_start, inv.billing_period_end),
      })
      console.log(`  ${inv.invoice_number} (${inv.billing_period_start} to ${inv.billing_period_end}): currently AED ${inv.total_amount} -> fresh AED ${fresh}`)
    }
    console.log('\nRe-run with --confirm to apply: corrects start_date, then reconciles (only invoices whose fresh amount actually differs get an adjustment line).')
    return
  }

  // start_date is already 2026-06-01 in the DB (confirmed by the dry-run
  // snapshot above) — no correction write needed there; only the stale
  // AC-INV-01523 amount needs reconciling.
  const result = await reconcileInvoicesForSubscription(
    admin,
    SUBSCRIPTION_ID,
    ACTOR_ID,
    'Retroactive fix — corrected start date + cycle-based prepaid proration after Sept 1 pause',
  )
  console.log('\nreconcile result:', result)

  console.log('\n--- AFTER ---')
  await snapshot()
}

main().catch(e => { console.error(e); process.exit(1) })
