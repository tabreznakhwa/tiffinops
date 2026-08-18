export const dynamic = 'force-dynamic'

import { formatInTimeZone } from 'date-fns-tz'
import { requireAuth } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSettings } from '@/lib/settings/getSettings'
import { getCustomerBalancesInRange, getCustomerLastPayments, getCustomerOutstandingSince, getCustomerOldestUnpaidInvoice, getCustomerAdjustmentTotalsInRange } from '@/lib/db/aggregates'
import { chargeForCustomer, groupSubscriptionsByCustomer } from '@/lib/billing/subscription-charge'
import { OutstandingModule } from '@/components/outstanding/outstanding-module'
import type { OutstandingRow } from '@/components/outstanding/outstanding-module'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// Whole days from a 'YYYY-MM-DD' date to today (positive = in the past).
function daysSince(date: string, today: string): number {
  const a = new Date(date + 'T00:00:00Z').getTime()
  const b = new Date(today + 'T00:00:00Z').getTime()
  return Math.round((b - a) / 86_400_000)
}

// The subscription's Nth monthly anniversary: same day-of-month as the start
// date, clamped to the target month's length. The day is always re-derived
// from the original start date (a 31st starter bills on Feb 28/29 and reverts
// to the 31st after), never chained off an already-clamped date.
function nthAnniversary(startDate: string, n: number): string {
  const startDay = Number(startDate.slice(8, 10))
  let year  = Number(startDate.slice(0, 4))
  let month = Number(startDate.slice(5, 7)) + n
  year += Math.floor((month - 1) / 12)
  month = ((month - 1) % 12) + 1
  const dim = new Date(year, month, 0).getDate()
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(Math.min(startDay, dim)).padStart(2, '0')}`
}

export default async function OutstandingPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>
}) {
  const user = await requireAuth()
  const canView = ['owner', 'manager', 'accounts', 'data_entry'].includes(user.role)
  if (!canView) {
    return (
      <div className="flex items-center justify-center h-48">
        <p className="text-sm font-semibold" style={{ color: 'var(--color-muted)' }}>
          You don&apos;t have permission to view this report.
        </p>
      </div>
    )
  }

  const sp = await searchParams
  const today = formatInTimeZone(new Date(), 'Asia/Dubai', 'yyyy-MM-dd')

  const rangeFrom = sp.from && DATE_RE.test(sp.from) ? sp.from : ''
  const rangeTo   = sp.to   && DATE_RE.test(sp.to)   ? sp.to   : ''

  // Effective window used for every charge/payment aggregate below
  const effectiveFrom = rangeFrom || '2000-01-01'
  const effectiveTo   = rangeTo   || today

  const admin = createAdminClient()

  const [
    settings,
    { data: customers },
    { data: subsData },
    balances,
    lastPayments,
    oldestDebts,
    oldestInvoices,
    adjustmentTotals,
  ] = await Promise.all([
    getSettings(),
    admin
      .from('customers')
      .select('id, full_name, customer_code, customer_type, payment_terms, mobile_number, area, status')
      .in('status', ['active', 'paused'])
      .order('full_name', { ascending: true }),
    // Every subscription row — all statuses. Needed so overlapping rows can be
    // clamped before charges are summed.
    admin
      .from('customer_subscriptions')
      .select('id, customer_id, start_date, end_date, agreed_monthly_price, status, fixed_plans(meal_periods)'),
    // Per-customer order and payment totals, aggregated in Postgres
    getCustomerBalancesInRange(admin, effectiveFrom, effectiveTo),
    // Per-customer most recent payment — all-time, not scoped to the range above
    getCustomerLastPayments(admin),
    // Per-customer oldest unpaid order date (FIFO) — for aging
    getCustomerOutstandingSince(admin),
    // Per-customer oldest unpaid invoice due date — aging for subscription debt
    getCustomerOldestUnpaidInvoice(admin),
    // Discounts / write-offs that settle residual balances
    getCustomerAdjustmentTotalsInRange(admin, effectiveFrom, effectiveTo),
  ])

  const customerList = customers ?? []
  const allSubs = ((subsData ?? []) as unknown as {
    id: string
    customer_id: string
    start_date: string
    end_date: string | null
    agreed_monthly_price: string
    status: string
    fixed_plans: { meal_periods: string[] | null } | null
  }[]).map(s => ({ ...s, meal_periods: s.fixed_plans?.meal_periods ?? null }))

  const balanceMap = new Map(balances.map(b => [b.customer_id, b]))
  const lastPaymentMap = new Map(lastPayments.map(p => [p.customer_id, p]))
  const oldestDebtMap = new Map(oldestDebts.map(d => [d.customer_id, d.outstanding_since]))
  const oldestInvoiceMap = new Map(oldestInvoices.map(d => [d.customer_id, d.oldest_due_date]))
  const subsByCustomer = groupSubscriptionsByCustomer(allSubs)

  const rows: OutstandingRow[] = customerList
    .map(c => {
      const bal = balanceMap.get(c.id)
      const orderBilled = bal?.order_total ?? 0
      const totalPaid   = bal?.payment_total ?? 0

      const custSubs = subsByCustomer.get(c.id) ?? []
      const subCharge = chargeForCustomer(custSubs, effectiveFrom, effectiveTo)

      // The subscription shown in the table = the live one (active or paused),
      // preferring the most recently started.
      const current = custSubs
        .filter(s => s.status === 'active' || s.status === 'paused')
        .sort((a, b) => b.start_date.localeCompare(a.start_date))[0]

      const lastPayment = lastPaymentMap.get(c.id)

      // Fixed-menu customers pay a flat plan rate: the plan covers whatever
      // they order, so the "incremental" order total is discounted away and the
      // bill caps at the subscription charge. Orders stay visible as usage.
      const isFixed = c.customer_type === 'fixed_menu'
      const hasPlan = subCharge > 0
      const fixedDiscount = isFixed && hasPlan ? orderBilled : 0

      const totalBilled = orderBilled + subCharge - fixedDiscount
      // Discounts / write-offs settle residual balances without a fake payment
      const adjustmentTotal = adjustmentTotals.get(c.id) ?? 0
      const outstanding = totalBilled - totalPaid - adjustmentTotal

      // Aging anchor: earliest unpaid obligation. Order-driven debt uses the
      // FIFO "oldest unpaid order" date; subscription-only debt uses the oldest
      // unpaid invoice due date.
      const outstandingSince =
        oldestDebtMap.get(c.id) ?? oldestInvoiceMap.get(c.id) ?? null

      // Prepaid subscribers: next payment due = start date + however many
      // whole months they've paid for. A customer who started 15 Jul and
      // paid one month is covered through 14 Aug — next due 15 Aug, and
      // OVERDUE once that passes, even if today is later. Payments toward
      // the plan = total paid minus the net order bill (for fixed_menu the
      // plan discount makes that 0, so every payment counts to the plan).
      // Only computed on the all-time view — a filtered date range would
      // undercount months paid.
      const monthlyRate = current ? parseFloat(String(current.agreed_monthly_price)) : 0
      let nextDue: string | null = null
      let nextDueInDays: number | null = null
      if (
        c.payment_terms === 'prepaid' &&
        current?.status === 'active' &&
        monthlyRate > 0 &&
        !rangeFrom && !rangeTo
      ) {
        const netOrderBill = Math.max(0, orderBilled - fixedDiscount)
        // Discounts count toward the plan too — a discounted month is covered
        const paidTowardPlan = Math.max(0, totalPaid + adjustmentTotal - netOrderBill)
        const monthsCovered = Math.floor((paidTowardPlan + 0.01) / monthlyRate)
        nextDue = nthAnniversary(current.start_date, monthsCovered)
        nextDueInDays = -daysSince(nextDue, today) // negative = overdue by |n| days
      }

      return {
        id:            c.id,
        full_name:     c.full_name,
        customer_code: c.customer_code,
        customer_type: c.customer_type,
        payment_terms: c.payment_terms,
        mobile_number: c.mobile_number ?? '',
        area:          c.area,
        orderBilled,
        subCharge,
        fixedDiscount,
        totalBilled,
        totalPaid,
        adjustmentTotal,
        outstanding,
        monthlyRate,
        subPaused:     current?.status === 'paused',
        subId:         current?.id ?? null,
        subStartDate:  current?.start_date ?? null,
        subEndDate:    current?.end_date ?? null,
        nextDueDate:   nextDue,
        nextDueInDays,
        lastPaymentDate:   lastPayment?.last_payment_date ?? null,
        lastPaymentAmount: lastPayment?.last_payment_amount ?? null,
        outstandingSince,
        daysOutstanding:      outstandingSince ? daysSince(outstandingSince, today) : null,
        daysSinceLastPayment: lastPayment?.last_payment_date
          ? daysSince(lastPayment.last_payment_date, today)
          : null,
      }
    })
    .sort((a, b) => b.outstanding - a.outstanding)

  return (
    <OutstandingModule
      rows={rows}
      totalCustomers={customerList.length}
      currency={settings.currency}
      userRole={user.role}
      rangeFrom={rangeFrom}
      rangeTo={rangeTo}
    />
  )
}
