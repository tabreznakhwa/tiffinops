import { formatInTimeZone } from 'date-fns-tz'
import { requireAuth } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { DashboardModule } from '@/components/dashboard/dashboard-module'
import type { DashboardData } from '@/components/dashboard/dashboard-module'
import {
  getCustomerBalances,
  getOrderTotalInRange,
  getOrderDailyTotals,
} from '@/lib/db/aggregates'
import { chargeForCustomer, groupSubscriptionsByCustomer } from '@/lib/billing/subscription-charge'

export const dynamic = 'force-dynamic'

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string }>
}) {
  const user  = await requireAuth()
  const admin = createAdminClient()
  const sp    = await searchParams

  const now      = new Date()
  const todayStr = formatInTimeZone(now, 'Asia/Dubai', 'yyyy-MM-dd')
  const monthStr = formatInTimeZone(now, 'Asia/Dubai', 'yyyy-MM')
  const monthStart = `${monthStr}-01`
  const [y, m]   = monthStr.split('-').map(Number)
  const monthEnd = new Date(y, m, 1).toISOString().split('T')[0]

  // Last 30 days
  const d30Start = new Date(now.getTime() - 29 * 86400000).toISOString().split('T')[0]
  // Last month (for MoM comparison)
  const lastMonthStr   = formatInTimeZone(new Date(y, m - 2, 1), 'Asia/Dubai', 'yyyy-MM')
  const lastMonthStart = `${lastMonthStr}-01`
  const lastMonthEnd   = monthStart

  // ── Period filter ──────────────────────────────────────────────────────────
  const dateRe = /^\d{4}-\d{2}-\d{2}$/
  const rawPeriod = sp.period || 'today'
  const isCustom = rawPeriod === 'custom' && sp.from && sp.to && dateRe.test(sp.from) && dateRe.test(sp.to)
  const activePeriod = isCustom ? 'custom' : rawPeriod

  let periodStart: string
  let periodEnd: string  // exclusive upper bound
  let periodLabel: string

  if (isCustom) {
    periodStart = sp.from!
    const toDate = new Date(sp.to! + 'T00:00:00Z')
    toDate.setUTCDate(toDate.getUTCDate() + 1)
    periodEnd   = toDate.toISOString().split('T')[0]
    periodLabel = `${sp.from} → ${sp.to}`
  } else if (activePeriod === 'yesterday') {
    const yest = new Date(now.getTime() - 86400000)
    const yStr = yest.toISOString().split('T')[0]
    periodStart = yStr
    periodEnd   = todayStr
    periodLabel = 'Yesterday'
  } else if (activePeriod === 'last_month') {
    periodStart = lastMonthStart
    periodEnd   = monthStart
    periodLabel = new Date(y, m - 2, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
  } else if (activePeriod === 'this_month') {
    periodStart = monthStart
    periodEnd   = monthEnd
    periodLabel = new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
  } else {
    // today (default)
    periodStart = todayStr
    const tomorrow = new Date(now.getTime() + 86400000)
    periodEnd   = tomorrow.toISOString().split('T')[0]
    periodLabel = 'Today'
  }

  const EXCLUDE_STATUSES = '(cancelled,voided,draft)'

  // ── Everything in ONE parallel wave ────────────────────────────────────────
  // All heavy aggregation happens in Postgres (migration 031) rather than by
  // pulling every order and payment row into Node.
  const [
    { data: todayPayments },
    { data: monthPayments },
    { data: lastMonthPay },
    { data: allCustomers },
    { data: newCustomers },
    { data: allSubs },
    { data: todayOrders },
    { count: pendingApprovals },
    { data: recentPayments },
    { data: pay30d },
    { data: todayOrderAmounts },
    { data: draftInvoices },
    { data: issuedInvoices },
    { data: periodPayRows },
    { data: monthPayWithCust },
    balances,
    monthBilledTotal,
    lastMonthBilledTotal,
    periodBilled,
    billedDayMap,
  ] = await Promise.all([
    admin.from('payments').select('amount').is('voided_at', null).eq('payment_date', todayStr),
    admin.from('payments').select('amount').is('voided_at', null)
      .gte('payment_date', monthStart).lt('payment_date', monthEnd),
    admin.from('payments').select('amount').is('voided_at', null)
      .gte('payment_date', lastMonthStart).lt('payment_date', lastMonthEnd),
    admin.from('customers').select('id, status, customer_type, full_name, customer_code'),
    admin.from('customers').select('id').gte('created_at', monthStart + 'T00:00:00Z'),
    // ALL subscriptions (not just active) — needed so overlapping rows can be
    // clamped before charges are summed. See lib/billing/subscription-charge.
    admin.from('customer_subscriptions')
      .select('id, customer_id, start_date, end_date, status, agreed_monthly_price, customers(full_name, customer_code)'),
    admin.from('orders').select('id, meal_period')
      .eq('order_date', todayStr).not('order_status', 'in', EXCLUDE_STATUSES),
    admin.from('approval_requests').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
    admin.from('payments')
      .select('id, payment_number, payment_date, amount, mode, voided_at, customers(full_name, customer_code)')
      .order('created_at', { ascending: false }).limit(8),
    admin.from('payments').select('payment_date, amount')
      .is('voided_at', null).gte('payment_date', d30Start).lte('payment_date', todayStr),
    // Today is always < 1,000 orders
    admin.from('orders').select('total_amount')
      .eq('order_date', todayStr).not('order_status', 'in', EXCLUDE_STATUSES),
    admin.from('invoices').select('total_amount').eq('status', 'draft'),
    admin.from('invoices').select('total_amount').in('status', ['issued', 'overdue', 'partial']),
    admin.from('payments').select('amount').is('voided_at', null)
      .gte('payment_date', periodStart).lt('payment_date', periodEnd),
    admin.from('payments').select('customer_id, amount').is('voided_at', null)
      .gte('payment_date', monthStart).lt('payment_date', monthEnd),

    // Aggregated server-side — constant cost regardless of order volume
    getCustomerBalances(admin),
    getOrderTotalInRange(admin, monthStart, monthEnd),
    getOrderTotalInRange(admin, lastMonthStart, lastMonthEnd),
    getOrderTotalInRange(admin, periodStart, periodEnd),
    getOrderDailyTotals(admin, d30Start, todayStr),
  ])

  const periodCollected = (periodPayRows ?? []).reduce((s, p) => s + parseFloat(String(p.amount)), 0)

  // ── Payment KPIs ───────────────────────────────────────────────────────────
  type SubRow = {
    id: string
    customer_id: string
    start_date: string
    end_date: string | null
    status: string
    agreed_monthly_price: string
    customers: { full_name: string; customer_code: string } | null
  }
  const allSubRows = (allSubs ?? []) as unknown as SubRow[]
  const activeSubRows = allSubRows.filter(s => s.status === 'active')

  const todayRevenue  = (todayPayments ?? []).reduce((s, p) => s + parseFloat(String(p.amount)), 0)
  const monthRevenue  = (monthPayments ?? []).reduce((s, p) => s + parseFloat(String(p.amount)), 0)
  const lastMonthRev  = (lastMonthPay  ?? []).reduce((s, p) => s + parseFloat(String(p.amount)), 0)
  const mrr           = activeSubRows.reduce((s, p) => s + parseFloat(String(p.agreed_monthly_price)), 0)
  const activeCount             = (allCustomers ?? []).filter(c => c.status === 'active').length
  const pausedCount             = (allCustomers ?? []).filter(c => c.status === 'paused').length
  const fixedMenuActiveCustomers = (allCustomers ?? []).filter(c => c.status === 'active' && c.customer_type === 'fixed_menu').length
  const alaCarteActiveCustomers  = (allCustomers ?? []).filter(c => c.status === 'active' && c.customer_type === 'a_la_carte').length

  // Build customer_id → {type, name, code} map
  const customerTypeMap = new Map<string, string>()
  const customerInfo = new Map<string, { full_name: string; customer_code: string }>()
  for (const c of allCustomers ?? []) {
    customerTypeMap.set(c.id, c.customer_type)
    customerInfo.set(c.id, { full_name: c.full_name, customer_code: c.customer_code })
  }

  // ── Order KPIs (aggregated in Postgres) ────────────────────────────────────
  const todayBilled     = (todayOrderAmounts ?? []).reduce((s, o) => s + parseFloat(String(o.total_amount)), 0)
  const monthBilled     = monthBilledTotal
  const lastMonthBilled = lastMonthBilledTotal

  // ── True outstanding: per-customer (orders billed − payments received) ─────
  let totalOutstandingOrders = 0
  let alaCarteOutstanding = 0
  const debtorMap = new Map<string, { full_name: string; customer_code: string; outstanding: number }>()
  for (const b of balances) {
    const info = customerInfo.get(b.customer_id)
    if (!info) continue
    const outstanding = Math.max(0, b.order_total - b.payment_total)
    if (outstanding > 0.01) {
      totalOutstandingOrders += outstanding
      debtorMap.set(b.customer_id, { ...info, outstanding })
      const ctype = customerTypeMap.get(b.customer_id)
      if (ctype === 'a_la_carte' || ctype === 'hybrid') alaCarteOutstanding += outstanding
    }
  }

  const topDebtors = [...debtorMap.values()]
    .sort((a, b) => b.outstanding - a.outstanding)
    .slice(0, 5)

  // ── Subscription outstanding (pro-rated) ───────────────────────────────────
  // Charge the days actually covered this month, not a flat monthly rate — a
  // customer who joined on the 11th owes ~2/3 of a month, not a whole one.
  const monthPayMap = new Map<string, number>()
  for (const p of monthPayWithCust ?? []) {
    monthPayMap.set(p.customer_id, (monthPayMap.get(p.customer_id) ?? 0) + parseFloat(String(p.amount)))
  }

  const monthLastDay = new Date(new Date(monthEnd + 'T00:00:00Z').getTime() - 86400000)
    .toISOString().split('T')[0]
  const billToday = todayStr < monthLastDay ? todayStr : monthLastDay

  const subsByCustomer = groupSubscriptionsByCustomer(allSubRows)

  const balanceRows = [...subsByCustomer.entries()]
    .map(([customerId, custSubs]) => {
      const charge = chargeForCustomer(custSubs, monthStart, billToday)
      const info   = customerInfo.get(customerId)
        ?? { full_name: custSubs[0].customers?.full_name ?? 'Unknown', customer_code: custSubs[0].customers?.customer_code ?? '' }
      const paid   = monthPayMap.get(customerId) ?? 0
      return {
        customer_id:   customerId,
        full_name:     info.full_name,
        customer_code: info.customer_code,
        monthlyCharge: charge,
        monthPaid:     paid,
        balance:       charge - paid,
      }
    })
    .filter(r => r.balance > 0.005)
    .sort((a, b) => b.balance - a.balance)

  const subOutstanding = balanceRows.reduce((s, r) => s + r.balance, 0)
  const fixedMenuOutstanding = balanceRows
    .filter(r => customerTypeMap.get(r.customer_id) === 'fixed_menu')
    .reduce((s, r) => s + r.balance, 0)

  // ── Charts ─────────────────────────────────────────────────────────────────
  const payDayMap = new Map<string, number>()
  for (const p of pay30d ?? []) {
    payDayMap.set(p.payment_date, (payDayMap.get(p.payment_date) ?? 0) + parseFloat(String(p.amount)))
  }

  const rev30d = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(now.getTime() - (29 - i) * 86400000).toISOString().split('T')[0]
    return { date: d, amount: payDayMap.get(d) ?? 0 }
  })
  const billed30d = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(now.getTime() - (29 - i) * 86400000).toISOString().split('T')[0]
    return { date: d, amount: billedDayMap.get(d) ?? 0 }
  })

  // ── Today's orders breakdown ───────────────────────────────────────────────
  const orders = todayOrders ?? []
  const byPeriod = {
    breakfast: orders.filter(o => o.meal_period === 'breakfast').length,
    lunch:     orders.filter(o => o.meal_period === 'lunch').length,
    dinner:    orders.filter(o => o.meal_period === 'dinner').length,
  }

  type PayRow = {
    id: string; payment_number: string; payment_date: string
    amount: string; mode: string; voided_at: string | null
    customers: { full_name: string; customer_code: string } | null
  }

  // ── Invoice KPIs ───────────────────────────────────────────────────────────
  const draftInvoiceCount = (draftInvoices ?? []).length
  const draftInvoiceTotal = (draftInvoices ?? []).reduce((s, i) => s + parseFloat(String(i.total_amount)), 0)
  const issuedOutstanding = (issuedInvoices ?? []).reduce((s, i) => s + parseFloat(String(i.total_amount)), 0)

  const dashData: DashboardData = {
    userName:            user.full_name.split(' ')[0],
    activePeriod,
    periodLabel,
    periodBilled,
    periodCollected,
    periodFrom:          sp.from || '',
    periodTo:            sp.to   || '',
    todayRevenue,
    monthRevenue,
    lastMonthRevenue:    lastMonthRev,
    todayBilled,
    monthBilled,
    lastMonthBilled,
    totalOutstandingOrders,
    billed30d,
    topDebtors,
    draftInvoiceCount,
    draftInvoiceTotal,
    issuedOutstanding,
    mrr,
    activeSubscriptions: activeSubRows.length,
    totalOutstanding:    subOutstanding,
    topBalances:         balanceRows.slice(0, 5),
    activeCustomers:           activeCount,
    pausedCustomers:           pausedCount,
    totalCustomers:            (allCustomers ?? []).length,
    newCustomersMonth:         newCustomers?.length ?? 0,
    fixedMenuActiveCustomers,
    alaCarteActiveCustomers,
    fixedMenuOutstanding,
    alaCarteOutstanding,
    ordersToday:         orders.length,
    ordersByPeriod:      byPeriod,
    pendingApprovals:    pendingApprovals ?? 0,
    rev30d,
    recentPayments:      ((recentPayments ?? []) as unknown as PayRow[]).slice(0, 6),
  }

  return <DashboardModule data={dashData} />
}
