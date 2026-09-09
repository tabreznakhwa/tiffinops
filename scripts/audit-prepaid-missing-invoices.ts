// Audit: prepaid fixed-menu customers whose CURRENT billing cycle has no
// invoice at all — i.e. they are "advance" customers who owe their full
// monthly plan price up front, but nothing has ever been billed for it.
//
// Root cause this surfaces (confirmed for AC-CUST-00252, Mohd Umar Khan):
// generatePrepaidAnniversaryInvoices only bills a subscriber on the exact
// calendar day matching their start_date's day-of-month. A subscription row
// created AFTER that day has already passed this month (e.g. entered late,
// or start_date backdated by staff) never gets picked up until NEXT month's
// anniversary — its very first cycle is silently never invoiced. The
// Outstanding page then shows a misleading "prorated so far" live estimate
// instead of the real full-cycle amount owed in advance.
//
// This script only flags — it makes no writes.

import fs from 'fs'
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/)
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '')
}

import { createClient } from '@supabase/supabase-js'
import { formatInTimeZone } from 'date-fns-tz'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
) as any

const today = formatInTimeZone(new Date(), 'Asia/Dubai', 'yyyy-MM-dd')

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}
function pad(n: number, w = 2): string { return String(n).padStart(w, '0') }

// Same logic as generatePrepaidInvoices.ts's anniversaryDateForMonth
function anniversaryDateForMonth(startDate: string, year: number, month: number): string {
  const startDay = Number(startDate.slice(8, 10))
  const day = Math.min(startDay, daysInMonth(year, month))
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`
}

// Most recent anniversary date <= `today` for a subscription starting on `startDate`.
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

async function main() {
  const { data: subs } = await admin
    .from('customer_subscriptions')
    .select('id, customer_id, start_date, end_date, status, agreed_monthly_price, created_at, customers(full_name, customer_code, payment_terms, customer_type, status)')
    .eq('status', 'active')

  const prepaidActive = (subs ?? []).filter((s: any) =>
    s.customers?.payment_terms === 'prepaid' &&
    s.customers?.status === 'active' &&
    s.start_date <= today &&
    parseFloat(String(s.agreed_monthly_price)) > 0
  )

  const custIds = prepaidActive.map((s: any) => s.customer_id)
  const { data: invoices } = custIds.length
    ? await admin.from('invoices').select('customer_id, billing_period_start, billing_period_end, invoice_type, status').in('customer_id', custIds).eq('invoice_type', 'fixed_monthly')
    : { data: [] }

  const invoicesByCustomer = new Map<string, { billing_period_start: string; billing_period_end: string }[]>()
  for (const inv of invoices ?? []) {
    const list = invoicesByCustomer.get(inv.customer_id) ?? []
    list.push(inv)
    invoicesByCustomer.set(inv.customer_id, list)
  }

  const flagged: any[] = []
  for (const s of prepaidActive) {
    const cust = s.customers as any
    const cycleStart = mostRecentAnniversary(s.start_date, today)
    const invs = invoicesByCustomer.get(s.customer_id) ?? []
    const hasCurrentCycleInvoice = invs.some(i => i.billing_period_start === cycleStart)
    const hasAnyInvoice = invs.length > 0
    if (!hasCurrentCycleInvoice) {
      flagged.push({
        customer_code: cust.customer_code,
        full_name: cust.full_name,
        sub_start_date: s.start_date,
        sub_created_at: s.created_at.slice(0, 10),
        current_cycle_start: cycleStart,
        monthly_price: s.agreed_monthly_price,
        has_any_invoice_ever: hasAnyInvoice,
        days_overdue: Math.round((new Date(today + 'T00:00:00Z').getTime() - new Date(cycleStart + 'T00:00:00Z').getTime()) / 86400000),
      })
    }
  }

  flagged.sort((a, b) => b.days_overdue - a.days_overdue)
  console.log(`Checked ${prepaidActive.length} active prepaid subscriptions. ${flagged.length} missing an invoice for their current cycle:\n`)
  console.table(flagged)
}

main().catch(e => { console.error(e); process.exit(1) })
