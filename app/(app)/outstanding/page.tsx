export const dynamic = 'force-dynamic'

import { formatInTimeZone } from 'date-fns-tz'
import { requireAuth } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSettings } from '@/lib/settings/getSettings'
import { getCustomerBalancesInRange, getCustomerLastPayments, getCustomerOutstandingSince, getCustomerOldestUnpaidInvoice, getCustomerAdjustmentTotalsInRange } from '@/lib/db/aggregates'
import { chargeForCustomer, groupSubscriptionsByCustomer, mealPeriodsCoveredOn } from '@/lib/billing/subscription-charge'
import { OutstandingModule } from '@/components/outstanding/outstanding-module'
import type { OutstandingRow, MonthBill } from '@/components/outstanding/outstanding-module'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Page through a Supabase query 1000 rows at a time (PostgREST caps a single
// request at 1000 rows, and billed invoices will outgrow that within months).
const PAGE = 1000
async function fetchPaged<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = []
  let o = 0
  while (true) {
    const { data, error } = await build(o, o + PAGE - 1)
    if (error) throw new Error(error.message)
    out.push(...(data ?? []))
    if ((data ?? []).length < PAGE) break
    o += PAGE
  }
  return out
}

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
    { data: plansData },
    { data: subsData },
    mealPauses,
    balances,
    lastPayments,
    oldestDebts,
    oldestInvoices,
    adjustmentTotals,
    billedInvoices,
    linkedPayments,
    fixedMenuMealOrders,
  ] = await Promise.all([
    getSettings(),
    admin
      .from('customers')
      .select('id, full_name, customer_code, customer_type, payment_terms, mobile_number, area, status')
      .in('status', ['active', 'paused'])
      .order('full_name', { ascending: true }),
    // Fixed plans — feed the per-row "Add plan" modal
    admin
      .from('fixed_plans')
      .select('*')
      .order('plan_name', { ascending: true }),
    // Every subscription row — all statuses. Needed so overlapping rows can be
    // clamped before charges are summed.
    admin
      .from('customer_subscriptions')
      .select('id, customer_id, start_date, end_date, agreed_monthly_price, meal_prices, status, fixed_plans(meal_periods)'),
    fetchPaged<{ subscription_id: string; meal_period: string; pause_start: string; pause_end: string | null }>((f, t) => admin
      .from('subscription_meal_pauses')
      .select('subscription_id, meal_period, pause_start, pause_end')
      .lte('pause_start', effectiveTo)
      .or(`pause_end.is.null,pause_end.gte.${effectiveFrom}`)
      .range(f, t)),
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
    // Every billed invoice — feeds the month-wise breakdown so payments can be
    // cleared cycle by cycle. Always all-time (a date filter shouldn't hide
    // an older unpaid month).
    fetchPaged<{
      id: string; customer_id: string | null; invoice_number: string
      invoice_date: string; billing_period_end: string | null
      total_amount: string; status: string
    }>((f, t) => admin
      .from('invoices')
      .select('id, customer_id, invoice_number, invoice_date, billing_period_end, total_amount, status')
      .in('status', ['issued', 'partial', 'paid', 'overdue'])
      .range(f, t)),
    // Payments applied to a specific invoice — the per-month "paid" amounts
    fetchPaged<{ invoice_id: string | null; amount: string }>((f, t) => admin
      .from('payments')
      .select('invoice_id, amount')
      .not('invoice_id', 'is', null)
      .is('voided_at', null)
      .range(f, t)),
    // Fixed-menu customers' credit orders, WITH meal_period — so their
    // "fixed-plan discount" below can be limited to orders their plan
    // actually covers, instead of blanket-discounting everything they order
    // (the same bug already fixed in the invoice generators). Scoped to
    // customer_type = 'fixed_menu' via the embedded-resource filter so this
    // doesn't scan every customer's orders.
    fetchPaged<{ customer_id: string | null; order_date: string; meal_period: string; total_amount: string }>((f, t) => admin
      .from('orders')
      .select('customer_id, order_date, meal_period, total_amount, customers!inner(customer_type)')
      .eq('customers.customer_type', 'fixed_menu')
      .eq('is_credit', true)
      .not('order_status', 'in', '(cancelled,voided,draft)')
      .gte('order_date', effectiveFrom)
      .lte('order_date', effectiveTo)
      .range(f, t) as never),
  ])

  const customerList = customers ?? []
  const pausesBySub = new Map<string, { meal_period: string; pause_start: string; pause_end: string | null }[]>()
  for (const p of mealPauses ?? []) {
    const list = pausesBySub.get(p.subscription_id)
    const row = { meal_period: p.meal_period, pause_start: p.pause_start, pause_end: p.pause_end }
    if (list) list.push(row)
    else pausesBySub.set(p.subscription_id, [row])
  }
  const allSubs = ((subsData ?? []) as unknown as {
    id: string
    customer_id: string
    start_date: string
    end_date: string | null
    agreed_monthly_price: string
    meal_prices: Record<string, string> | null
    status: string
    fixed_plans: { meal_periods: string[] | null } | null
  }[]).map(s => ({
    ...s,
    meal_periods: s.fixed_plans?.meal_periods ?? null,
    meal_pauses: pausesBySub.get(s.id) ?? [],
  }))

  const balanceMap = new Map(balances.map(b => [b.customer_id, b]))
  const lastPaymentMap = new Map(lastPayments.map(p => [p.customer_id, p]))
  const oldestDebtMap = new Map(oldestDebts.map(d => [d.customer_id, d.outstanding_since]))
  const oldestInvoiceMap = new Map(oldestInvoices.map(d => [d.customer_id, d.oldest_due_date]))
  const subsByCustomer = groupSubscriptionsByCustomer(allSubs)

  const mealOrdersByCustomer = new Map<string, { order_date: string; meal_period: string; total_amount: number }[]>()
  for (const o of fixedMenuMealOrders) {
    if (!o.customer_id) continue
    const list = mealOrdersByCustomer.get(o.customer_id)
    const row = { order_date: o.order_date, meal_period: o.meal_period, total_amount: parseFloat(o.total_amount) }
    if (list) list.push(row)
    else mealOrdersByCustomer.set(o.customer_id, [row])
  }

  // ── Month-wise bills ───────────────────────────────────────────────────────
  // One entry per billed invoice, bucketed under the month its billing cycle
  // ends in (26 Jul → 25 Aug counts as August, matching the statements). Paid
  // = payments explicitly applied to that invoice, so "clearing" a month means
  // recording its payment against that month's invoice.
  const paidByInvoice = new Map<string, number>()
  for (const p of linkedPayments) {
    if (!p.invoice_id) continue
    paidByInvoice.set(p.invoice_id, (paidByInvoice.get(p.invoice_id) ?? 0) + parseFloat(String(p.amount)))
  }

  const monthBillsByCustomer = new Map<string, MonthBill[]>()
  for (const inv of billedInvoices) {
    if (!inv.customer_id) continue
    const anchor = inv.billing_period_end || inv.invoice_date
    const y = Number(anchor.slice(0, 4))
    const m = Number(anchor.slice(5, 7))
    const billed = parseFloat(String(inv.total_amount))
    const paid = Math.min(paidByInvoice.get(inv.id) ?? 0, billed)
    const remaining = Math.max(0, billed - paid)
    const bill: MonthBill = {
      invoiceId:     inv.id,
      invoiceNumber: inv.invoice_number,
      monthKey:      `${y}-${String(m).padStart(2, '0')}`,
      monthLabel:    `${MONTH_NAMES[m - 1]} ${y}`,
      billed,
      paid,
      remaining,
      status: inv.status === 'paid' || remaining <= 0.005 ? 'paid' : paid > 0.005 ? 'partial' : 'unpaid',
    }
    const list = monthBillsByCustomer.get(inv.customer_id)
    if (list) list.push(bill)
    else monthBillsByCustomer.set(inv.customer_id, [bill])
  }
  for (const list of monthBillsByCustomer.values()) {
    list.sort((a, b) => a.monthKey.localeCompare(b.monthKey) || a.invoiceNumber.localeCompare(b.invoiceNumber))
  }

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

      // Fixed-menu customers pay a flat plan rate: orders from a meal period
      // their plan covers are discounted away (the plan already paid for
      // them); orders from a meal period the plan does NOT cover (e.g. a
      // lunch-only plan customer also ordering breakfast) are genuine extras
      // and must stay in totalBilled, billed in full — never netted to zero.
      const isFixed = c.customer_type === 'fixed_menu'
      const hasPlan = subCharge > 0
      const inPlanUsage = isFixed && hasPlan
        ? (mealOrdersByCustomer.get(c.id) ?? [])
            .filter(o => mealPeriodsCoveredOn(custSubs, o.order_date)?.has(o.meal_period))
            .reduce((s, o) => s + o.total_amount, 0)
        : 0
      const fixedDiscount = inPlanUsage

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

      const monthBills = monthBillsByCustomer.get(c.id) ?? []
      // Payments not applied to any invoice — explains why a month can still
      // show Unpaid even though money came in (old payments predate linking).
      const linkedPaid = monthBills.reduce((s, b) => s + b.paid, 0)
      const unallocatedPaid = Math.max(0, totalPaid - linkedPaid)

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
        monthBills,
        unallocatedPaid,
      }
    })
    .sort((a, b) => b.outstanding - a.outstanding)

  return (
    <OutstandingModule
      rows={rows}
      plans={plansData ?? []}
      totalCustomers={customerList.length}
      currency={settings.currency}
      userRole={user.role}
      rangeFrom={rangeFrom}
      rangeTo={rangeTo}
    />
  )
}
