import { formatInTimeZone } from 'date-fns-tz'
import { requireAuth } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { DashboardModule } from '@/components/dashboard/dashboard-module'
import type { DashboardData } from '@/components/dashboard/dashboard-module'

export const dynamic = 'force-dynamic'

// Supabase default row limit is 1,000. Use this for any query over a large table.
async function fetchAllPages<T>(
  buildQuery: (range: { from: number; to: number }) => PromiseLike<{ data: T[] | null }>
): Promise<T[]> {
  const PAGE = 1000
  const results: T[] = []
  let offset = 0
  while (true) {
    const { data } = await buildQuery({ from: offset, to: offset + PAGE - 1 })
    const batch = data ?? []
    results.push(...batch)
    if (batch.length < PAGE) break
    offset += PAGE
  }
  return results
}

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

  // ── Small queries (always < 1,000 rows) ────────────────────────────────────
  const [
    { data: todayPayments },
    { data: monthPayments },
    { data: lastMonthPay },
    { data: allCustomers },
    { data: newCustomers },
    { data: activeSubs },
    { data: todayOrders },
    { count: pendingApprovals },
    { data: recentPayments },
    { data: pay30d },
    { data: todayOrderAmounts },
    { data: draftInvoices },
    { data: issuedInvoices },
  ] = await Promise.all([
    admin.from('payments').select('amount').is('voided_at', null).eq('payment_date', todayStr),
    admin.from('payments').select('amount').is('voided_at', null)
      .gte('payment_date', monthStart).lt('payment_date', monthEnd),
    admin.from('payments').select('amount').is('voided_at', null)
      .gte('payment_date', lastMonthStart).lt('payment_date', lastMonthEnd),
    admin.from('customers').select('id, status, customer_type, full_name, customer_code'),
    admin.from('customers').select('id').gte('created_at', monthStart + 'T00:00:00Z'),
    admin.from('customer_subscriptions')
      .select('customer_id, agreed_monthly_price, customers(full_name, customer_code)')
      .eq('status', 'active'),
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
  ])

  // ── Large order queries — paginated to bypass 1,000-row limit ──────────────
  const [monthOrderRows, lastMonthOrderRows, unpaidOrderRows, billed30dRows, periodOrderRows] = await Promise.all([
    fetchAllPages(({ from, to }) =>
      admin.from('orders').select('total_amount')
        .gte('order_date', monthStart).lt('order_date', monthEnd)
        .not('order_status', 'in', EXCLUDE_STATUSES)
        .range(from, to) as any
    ) as Promise<{ total_amount: string }[]>,

    fetchAllPages(({ from, to }) =>
      admin.from('orders').select('total_amount')
        .gte('order_date', lastMonthStart).lt('order_date', lastMonthEnd)
        .not('order_status', 'in', EXCLUDE_STATUSES)
        .range(from, to) as any
    ) as Promise<{ total_amount: string }[]>,

    fetchAllPages(({ from, to }) =>
      admin.from('orders')
        .select('customer_id, total_amount, customers(full_name, customer_code)')
        .in('payment_status', ['unpaid', 'partial'])
        .not('order_status', 'in', EXCLUDE_STATUSES)
        .range(from, to) as any
    ) as Promise<{ customer_id: string; total_amount: string; customers: { full_name: string; customer_code: string } | null }[]>,

    fetchAllPages(({ from, to }) =>
      admin.from('orders').select('order_date, total_amount')
        .gte('order_date', d30Start).lte('order_date', todayStr)
        .not('order_status', 'in', EXCLUDE_STATUSES)
        .range(from, to) as any
    ) as Promise<{ order_date: string; total_amount: string }[]>,

    fetchAllPages(({ from, to }) =>
      admin.from('orders').select('total_amount')
        .gte('order_date', periodStart).lt('order_date', periodEnd)
        .not('order_status', 'in', EXCLUDE_STATUSES)
        .range(from, to) as any
    ) as Promise<{ total_amount: string }[]>,
  ])

  // Period payments (always < 1,000 for single period)
  const { data: periodPayRows } = await admin.from('payments').select('amount')
    .is('voided_at', null).gte('payment_date', periodStart).lt('payment_date', periodEnd)

  const periodBilled    = periodOrderRows.reduce((s, o) => s + parseFloat(String(o.total_amount)), 0)
  const periodCollected = (periodPayRows ?? []).reduce((s, p) => s + parseFloat(String(p.amount)), 0)

  // ── Payment KPIs ───────────────────────────────────────────────────────────
  const todayRevenue  = (todayPayments  ?? []).reduce((s, p) => s + parseFloat(String(p.amount)), 0)
  const monthRevenue  = (monthPayments  ?? []).reduce((s, p) => s + parseFloat(String(p.amount)), 0)
  const lastMonthRev  = (lastMonthPay   ?? []).reduce((s, p) => s + parseFloat(String(p.amount)), 0)
  const mrr           = (activeSubs     ?? []).reduce((s, p) => s + parseFloat(String(p.agreed_monthly_price)), 0)
  const activeCount   = (allCustomers   ?? []).filter(c => c.status === 'active').length
  const pausedCount   = (allCustomers   ?? []).filter(c => c.status === 'paused').length

  // ── Order KPIs (paginated) ─────────────────────────────────────────────────
  const todayBilled     = (todayOrderAmounts ?? []).reduce((s, o) => s + parseFloat(String(o.total_amount)), 0)
  const monthBilled     = monthOrderRows.reduce((s, o) => s + parseFloat(String(o.total_amount)), 0)
  const lastMonthBilled = lastMonthOrderRows.reduce((s, o) => s + parseFloat(String(o.total_amount)), 0)
  const totalOutstandingOrders = unpaidOrderRows.reduce((s, o) => s + parseFloat(String(o.total_amount)), 0)

  // Top debtors — aggregate unpaid orders by customer
  const debtorMap = new Map<string, { full_name: string; customer_code: string; outstanding: number }>()
  for (const o of unpaidOrderRows) {
    const cust = o.customers
    if (!cust) continue
    const existing = debtorMap.get(o.customer_id)
    const amt = parseFloat(String(o.total_amount))
    if (existing) {
      existing.outstanding += amt
    } else {
      debtorMap.set(o.customer_id, { full_name: cust.full_name, customer_code: cust.customer_code, outstanding: amt })
    }
  }
  const topDebtors = [...debtorMap.values()]
    .sort((a, b) => b.outstanding - a.outstanding)
    .slice(0, 5)

  // ── Subscription outstanding ───────────────────────────────────────────────
  const { data: monthPayWithCust } = await admin.from('payments')
    .select('customer_id, amount').is('voided_at', null)
    .gte('payment_date', monthStart).lt('payment_date', monthEnd)

  const monthPayMap = new Map<string, number>()
  for (const p of monthPayWithCust ?? []) {
    monthPayMap.set(p.customer_id, (monthPayMap.get(p.customer_id) ?? 0) + parseFloat(String(p.amount)))
  }

  type SubRow = { customer_id: string; agreed_monthly_price: string; customers: { full_name: string; customer_code: string } | null }
  const subs = (activeSubs ?? []) as unknown as SubRow[]

  const balanceRows = subs.map(s => ({
    full_name:     s.customers?.full_name ?? 'Unknown',
    customer_code: s.customers?.customer_code ?? '',
    monthlyCharge: parseFloat(String(s.agreed_monthly_price)),
    monthPaid:     monthPayMap.get(s.customer_id) ?? 0,
    balance:       parseFloat(String(s.agreed_monthly_price)) - (monthPayMap.get(s.customer_id) ?? 0),
  })).filter(r => r.balance > 0.005).sort((a, b) => b.balance - a.balance)

  const subOutstanding = balanceRows.reduce((s, r) => s + r.balance, 0)

  // ── Charts ─────────────────────────────────────────────────────────────────
  const payDayMap = new Map<string, number>()
  for (const p of pay30d ?? []) {
    payDayMap.set(p.payment_date, (payDayMap.get(p.payment_date) ?? 0) + parseFloat(String(p.amount)))
  }

  const billedDayMap = new Map<string, number>()
  for (const o of billed30dRows) {
    billedDayMap.set(o.order_date, (billedDayMap.get(o.order_date) ?? 0) + parseFloat(String(o.total_amount)))
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
    activeSubscriptions: subs.length,
    totalOutstanding:    subOutstanding,
    topBalances:         balanceRows.slice(0, 5),
    activeCustomers:     activeCount,
    pausedCustomers:     pausedCount,
    totalCustomers:      (allCustomers ?? []).length,
    newCustomersMonth:   newCustomers?.length ?? 0,
    ordersToday:         orders.length,
    ordersByPeriod:      byPeriod,
    pendingApprovals:    pendingApprovals ?? 0,
    rev30d,
    recentPayments:      ((recentPayments ?? []) as unknown as PayRow[]).slice(0, 6),
  }

  return <DashboardModule data={dashData} />
}
