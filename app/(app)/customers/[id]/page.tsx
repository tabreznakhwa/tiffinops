export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import { formatInTimeZone } from 'date-fns-tz'
import { requireAuth } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCustomerBalance, getCustomerAdjustmentTotalsInRange } from '@/lib/db/aggregates'
import { chargeForCustomer, mealPeriodsCoveredOn } from '@/lib/billing/subscription-charge'
import { CustomerDetailView } from '@/components/customers/customer-detail-view'
import type { BalanceSummary } from '@/components/customers/customer-detail-view'
import type { ReferralCustomerOption } from '@/components/customers/customer-form-fields'

const WRITER_ROLES = ['owner', 'manager', 'data_entry']
const ADMIN_ROLES = ['owner', 'manager']

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const user = await requireAuth()
  const admin = createAdminClient()

  // Dubai month boundaries for balance calculation
  const now        = new Date()
  const monthStr   = formatInTimeZone(now, 'Asia/Dubai', 'yyyy-MM')
  const monthStart = `${monthStr}-01`
  const [y, m]     = monthStr.split('-').map(Number)
  const monthEnd   = new Date(y, m, 1).toISOString().split('T')[0]
  const currentMonth = formatInTimeZone(now, 'Asia/Dubai', 'MMMM yyyy')

  const today = formatInTimeZone(now, 'Asia/Dubai', 'yyyy-MM-dd')

  const [
    { data: customer },
    { data: allSubsRaw },
    { data: payments },
    { data: monthOrders },
    { data: recentOrders },
    { data: referralOptions },
    allTimeBalance,
    adjustmentTotals,
  ] = await Promise.all([
    admin.from('customers').select('*').eq('id', id).single(),

    // Every subscription row (all statuses) — needed so overlapping rows can
    // be clamped and the all-time charge summed the same way the Outstanding
    // report does (lib/billing/subscription-charge.ts).
    admin
      .from('customer_subscriptions')
      .select('id, customer_id, start_date, end_date, agreed_monthly_price, meal_prices, status, fixed_plans(plan_name, meal_periods)')
      .eq('customer_id', id)
      .order('start_date', { ascending: false }),

    // All non-voided payments, newest first
    admin
      .from('payments')
      .select('id, payment_number, amount, mode, payment_date, is_advance')
      .eq('customer_id', id)
      .is('voided_at', null)
      .order('payment_date', { ascending: false }),

    // This month's a-la-carte credit orders (postpaid display only)
    admin
      .from('orders')
      .select('total_amount')
      .eq('customer_id', id)
      .gte('order_date', monthStart)
      .lt('order_date', monthEnd)
      .eq('is_credit', true)
      .not('order_status', 'in', '(cancelled,voided,draft)'),

    // Recent 15 orders (all time), newest first
    admin
      .from('orders')
      .select('id, order_number, order_date, meal_period, total_amount, order_status, order_items(item_name_snapshot, quantity)')
      .eq('customer_id', id)
      .order('order_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(15),

    admin
      .from('customers')
      .select('id, full_name, customer_code, mobile_number')
      .neq('id', id)
      .order('full_name'),

    // All-time order + payment totals — same aggregate the Outstanding report
    // uses, so the two pages always agree.
    getCustomerBalance(admin, id),
    getCustomerAdjustmentTotalsInRange(admin, '2000-01-01', today),
  ])

  if (!customer) notFound()

  const allPayments = payments ?? []
  const allSubs = (allSubsRaw ?? []) as unknown as {
    id: string
    customer_id: string
    start_date: string
    end_date: string | null
    agreed_monthly_price: string
    meal_prices: Record<string, string> | null
    status: string
    fixed_plans: { plan_name: string; meal_periods: string[] | null } | null
  }[]

  // Meal pauses for this customer's subscriptions (needed by chargeForCustomer
  // to skip paused meal periods when computing the all-time charge below).
  const subIds = allSubs.map(s => s.id)
  const { data: mealPausesRaw } = subIds.length
    ? await admin
        .from('subscription_meal_pauses')
        .select('subscription_id, meal_period, pause_start, pause_end')
        .in('subscription_id', subIds)
    : { data: [] as { subscription_id: string; meal_period: string; pause_start: string; pause_end: string | null }[] }

  const pausesBySub = new Map<string, { meal_period: string; pause_start: string; pause_end: string | null }[]>()
  for (const p of mealPausesRaw ?? []) {
    const list = pausesBySub.get(p.subscription_id)
    const row = { meal_period: p.meal_period, pause_start: p.pause_start, pause_end: p.pause_end }
    if (list) list.push(row)
    else pausesBySub.set(p.subscription_id, [row])
  }

  const chargeableSubs = allSubs.map(s => ({
    ...s,
    meal_periods: s.fixed_plans?.meal_periods ?? null,
    meal_pauses: pausesBySub.get(s.id) ?? [],
  }))

  // The subscription shown as "current" = the live one (active or paused),
  // preferring the most recently started — same rule the Outstanding page uses.
  const current = chargeableSubs
    .filter(s => s.status === 'active' || s.status === 'paused')
    .sort((a, b) => b.start_date.localeCompare(a.start_date))[0] ?? null

  const monthPaid = allPayments
    .filter(p => p.payment_date >= monthStart && p.payment_date < monthEnd)
    .reduce((s, p) => s + parseFloat(String(p.amount)), 0)

  const allTimePaid = allPayments
    .reduce((s, p) => s + parseFloat(String(p.amount)), 0)

  const monthOrdersTotal = (monthOrders ?? [])
    .reduce((s, o) => s + parseFloat(String(o.total_amount)), 0)

  const isPrepaid = customer.payment_terms === 'prepaid'

  // ── All-time reconciliation (prepaid customers) ──────────────────────────
  // Mirrors app/(app)/outstanding/page.tsx exactly: all-time order total +
  // all-time prorated subscription charge, netted against in-plan orders for
  // fixed_menu/hybrid customers, minus all-time payments and adjustments. A
  // calendar-month payment filter is wrong for someone who pays in advance —
  // this is why the customer detail page could show a false "Balance Due" the
  // month after an on-time prepayment.
  const allTimeSubCharge = chargeForCustomer(chargeableSubs, '2000-01-01', today)
  const isFixed = customer.customer_type === 'fixed_menu' || customer.customer_type === 'hybrid'
  const hasPlan = allTimeSubCharge > 0
  let allTimeInPlanUsage = 0
  if (isFixed && hasPlan) {
    const { data: fixedMenuOrders } = await admin
      .from('orders')
      .select('order_date, meal_period, total_amount')
      .eq('customer_id', id)
      .eq('is_credit', true)
      .not('order_status', 'in', '(cancelled,voided,draft)')
    allTimeInPlanUsage = (fixedMenuOrders ?? [])
      .filter(o => mealPeriodsCoveredOn(chargeableSubs, o.order_date)?.has(o.meal_period))
      .reduce((s, o) => s + parseFloat(String(o.total_amount)), 0)
  }
  const allTimeCharged = allTimeBalance.order_total + allTimeSubCharge - allTimeInPlanUsage
  const allTimeAdjustments = adjustmentTotals.get(id) ?? 0
  const allTimeDue = allTimeCharged - allTimeBalance.payment_total - allTimeAdjustments

  const balance: BalanceSummary = {
    monthlyCharge: current ? parseFloat(String(current.agreed_monthly_price)) : 0,
    subscriptionPlanName: current?.fixed_plans?.plan_name ?? null,
    monthPaid,
    monthOrdersTotal,
    allTimePaid,
    currentMonth,
    isPrepaid,
    allTimeCharged,
    allTimeDue,
    recentPayments: allPayments.slice(0, 5).map(p => ({
      id: p.id,
      payment_number: p.payment_number,
      amount: String(p.amount),
      mode: p.mode as string,
      payment_date: p.payment_date,
      is_advance: (p as { is_advance?: boolean }).is_advance ?? false,
    })),
  }

  type OrderWithItems = {
    id: string; order_number: string; order_date: string
    meal_period: string; total_amount: string; order_status: string
    order_items: { item_name_snapshot: string; quantity: string }[]
  }

  const referralCustomers = (referralOptions ?? []) as ReferralCustomerOption[]
  const referrer = referralCustomers.find(c => c.id === customer.referred_by_customer_id) ?? null

  return (
    <CustomerDetailView
      customer={customer}
      canWrite={WRITER_ROLES.includes(user.role)}
      canAdmin={ADMIN_ROLES.includes(user.role)}
      isOwner={user.role === 'owner'}
      balance={balance}
      orders={(recentOrders ?? []) as unknown as OrderWithItems[]}
      referrer={referrer}
      referralCustomers={referralCustomers}
    />
  )
}
