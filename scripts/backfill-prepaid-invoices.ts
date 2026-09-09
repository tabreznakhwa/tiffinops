// Backfill: generate the missing fixed_monthly invoices for prepaid
// subscribers whose cycle already started but who have NEVER been invoiced
// (see scripts/audit-prepaid-missing-invoices.ts — 8 customers found, root
// cause was generatePrepaidAnniversaryInvoices only firing on the exact
// calendar day matching a subscription's start_date day-of-month, silently
// skipping anyone whose subscription row was created/backdated after that
// day already passed this month).
//
// lib/invoices/generatePrepaidInvoices.ts now has a catch-up fix: it also
// bills anyone with zero fixed_monthly invoices ever, using their real
// (already-passed) anniversary as the period start. This script simply
// invokes that real, now-fixed function for today — exactly what the daily
// cron does — so the 8 backlogged customers get caught up in the same run
// that also does today's normal on-time billing (fixing "the cron gap" and
// generating the missing invoices are the same action).
//
// Dry-run by default (shows the audit + a preview of expected charges using
// the same calcSubscriptionCharge logic the real function uses, no writes).
// Pass --confirm to actually call generatePrepaidAnniversaryInvoices.
//
// Usage:
//   npx tsx scripts/backfill-prepaid-invoices.ts            (dry run)
//   npx tsx scripts/backfill-prepaid-invoices.ts --confirm   (apply)

import fs from 'fs'
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/)
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '')
}

import { createClient } from '@supabase/supabase-js'
import { calcSubscriptionCharge, type MealPause } from '../lib/fixed-menu/proration'
import { generatePrepaidAnniversaryInvoices } from '../lib/invoices/generatePrepaidInvoices'

const CONFIRM = process.argv.includes('--confirm')
const TODAY = '2026-09-09' // Dubai-local today
// 'system-cron' is the sentinel generatePrepaidAnniversaryInvoices maps to a
// null created_by (see its insert: `createdBy === 'system-cron' ? null : createdBy`)
// — any other string is treated as a real user UUID and fails the FK/type
// check on insert. This backfill run is standing in for the cron, so use
// the same sentinel it uses.
const ACTOR_ID = 'system-cron'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
) as any

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}
function pad(n: number, w = 2): string { return String(n).padStart(w, '0') }
function anniversaryDateForMonth(startDate: string, year: number, month: number): string {
  const startDay = Number(startDate.slice(8, 10))
  const day = Math.min(startDay, daysInMonth(year, month))
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`
}
function mostRecentAnniversary(startDate: string, today: string): string {
  let year  = Number(today.slice(0, 4))
  let month = Number(today.slice(5, 7))
  let candidate = anniversaryDateForMonth(startDate, year, month)
  if (candidate > today) {
    month -= 1
    if (month < 1) { month = 12; year -= 1 }
    candidate = anniversaryDateForMonth(startDate, year, month)
  }
  return candidate < startDate ? startDate : candidate
}
function nextAnniversaryAfter(startDate: string, from: string): string {
  let year  = Number(from.slice(0, 4))
  let month = Number(from.slice(5, 7)) + 1
  if (month > 12) { month = 1; year += 1 }
  return anniversaryDateForMonth(startDate, year, month)
}
function addDays(date: string, n: number): string {
  const d = new Date(date + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
function daySpan(from: string, to: string): number {
  const a = new Date(from + 'T00:00:00Z').getTime()
  const b = new Date(to + 'T00:00:00Z').getTime()
  return Math.round((b - a) / 86400000) + 1
}

async function preview() {
  const { data: subs } = await admin
    .from('customer_subscriptions')
    .select(`
      id, customer_id, start_date, end_date, status, agreed_monthly_price, meal_prices, created_at,
      fixed_plans(meal_periods),
      customers(full_name, customer_code, payment_terms, customer_type, status)
    `)
    .eq('status', 'active')

  const prepaidActive = (subs ?? []).filter((s: any) =>
    s.customers?.payment_terms === 'prepaid' &&
    s.customers?.status === 'active' &&
    s.start_date <= TODAY &&
    parseFloat(String(s.agreed_monthly_price)) > 0
  )

  const custIds = prepaidActive.map((s: any) => s.customer_id)
  const { data: invoices } = custIds.length
    ? await admin.from('invoices').select('customer_id, billing_period_start').in('customer_id', custIds).eq('invoice_type', 'fixed_monthly')
    : { data: [] }
  const everInvoiced = new Set((invoices ?? []).map((i: any) => i.customer_id))

  const flagged = prepaidActive.filter((s: any) => !everInvoiced.has(s.customer_id))
  if (!flagged.length) {
    console.log('No never-invoiced prepaid customers found — nothing to back-fill.')
    return
  }

  const subIds = flagged.map((s: any) => s.id)
  const { data: pauseRows } = await admin
    .from('subscription_meal_pauses')
    .select('subscription_id, meal_period, pause_start, pause_end')
    .in('subscription_id', subIds)
  const pausesBySub = new Map<string, MealPause[]>()
  for (const p of pauseRows ?? []) {
    const list = pausesBySub.get(p.subscription_id) ?? []
    list.push({ meal_period: p.meal_period, pause_start: p.pause_start, pause_end: p.pause_end })
    pausesBySub.set(p.subscription_id, list)
  }

  console.log(`[DRY RUN] ${flagged.length} never-invoiced prepaid customers — expected invoice on --confirm:\n`)
  const rows = flagged.map((s: any) => {
    const cycleStart = mostRecentAnniversary(s.start_date, TODAY)
    const cycleEnd = addDays(nextAnniversaryAfter(s.start_date, cycleStart), -1)
    const plan = s.fixed_plans as { meal_periods: string[] } | null
    const amount = calcSubscriptionCharge({
      mealPeriods: plan?.meal_periods ?? [],
      agreedMonthlyPrice: parseFloat(String(s.agreed_monthly_price)),
      mealPrices: s.meal_prices,
      subStart: s.start_date,
      subEnd: s.end_date,
      subStatus: s.status,
      pauses: pausesBySub.get(s.id) ?? [],
      rangeFrom: cycleStart,
      rangeTo: cycleEnd,
      cycleDays: daySpan(cycleStart, cycleEnd),
    })
    return {
      customer_code: s.customers.customer_code,
      full_name: s.customers.full_name,
      billing_period_start: cycleStart,
      billing_period_end: cycleEnd,
      due_date: cycleStart,
      expected_amount: amount,
    }
  })
  console.table(rows)
  console.log(`\nRe-run with --confirm to actually generate these (via the real generatePrepaidAnniversaryInvoices, run for today = ${TODAY} — this also covers any customer whose normal on-time anniversary is today).`)
}

async function main() {
  if (!CONFIRM) {
    await preview()
    return
  }

  const result = await generatePrepaidAnniversaryInvoices(TODAY, ACTOR_ID)
  console.log('\ngenerate result:', result)

  const { data: recent } = await admin
    .from('invoices')
    .select('invoice_number, customer_id, billing_period_start, billing_period_end, due_date, total_amount, status, customers(customer_code, full_name)')
    .eq('invoice_type', 'fixed_monthly')
    .eq('invoice_date', TODAY)
    .order('invoice_number')
  console.log('\ninvoices generated with invoice_date =', TODAY, ':')
  console.table((recent ?? []).map((r: any) => ({
    invoice_number: r.invoice_number,
    customer_code: r.customers?.customer_code,
    full_name: r.customers?.full_name,
    billing_period_start: r.billing_period_start,
    billing_period_end: r.billing_period_end,
    due_date: r.due_date,
    total_amount: r.total_amount,
    status: r.status,
  })))
}

main().catch(e => { console.error(e); process.exit(1) })
