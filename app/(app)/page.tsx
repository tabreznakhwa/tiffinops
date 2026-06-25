import { formatInTimeZone } from 'date-fns-tz'
import { requireAuth } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { DashboardModule } from '@/components/dashboard/dashboard-module'
import type { DashboardData } from '@/components/dashboard/dashboard-module'

export default async function DashboardPage() {
  const user  = await requireAuth()
  const admin = createAdminClient()

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

  const ACTIVE_ORDER_STATUSES = '(cancelled,voided,draft)'

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
    // Order-based queries
    { data: todayOrderAmounts },
    { data: monthOrderAmounts },
    { data: lastMonthOrderAmounts },
    { data: unpaidOrders },
    { data: billed30dRows },
    { data: draftInvoices },
    { data: issuedInvoices },
  ] = await Promise.all([
    // Payments — today
    admin.from('payments').select('amount').is('voided_at', null).eq('payment_date', todayStr),

    // Payments — this month
    admin.from('payments').select('amount').is('voided_at', null)
      .gte('payment_date', monthStart).lt('payment_date', monthEnd),

    // Payments — last month
    admin.from('payments').select('amount').is('voided_at', null)
      .gte('payment_date', lastMonthStart).lt('payment_date', lastMonthEnd),

    // All customers
    admin.from('customers').select('id, status, customer_type, full_name, customer_code'),

    // New customers this month
    admin.from('customers').select('id').gte('created_at', monthStart + 'T00:00:00Z'),

    // Active subscriptions
    admin.from('customer_subscriptions')
      .select('customer_id, agreed_monthly_price, customers(full_name, customer_code)')
      .eq('status', 'active'),

    // Today's orders (count + meal breakdown)
    admin.from('orders').select('id, meal_period')
      .eq('order_date', todayStr).not('order_status', 'in', ACTIVE_ORDER_STATUSES),

    // Pending approvals count
    admin.from('approval_requests').select('*', { count: 'exact', head: true }).eq('status', 'pending'),

    // Recent 8 payments
    admin.from('payments')
      .select('id, payment_number, payment_date, amount, mode, voided_at, customers(full_name, customer_code)')
      .order('created_at', { ascending: false }).limit(8),

    // Payments — last 30 days by day (chart)
    admin.from('payments').select('payment_date, amount')
      .is('voided_at', null).gte('payment_date', d30Start).lte('payment_date', todayStr),

    // Orders billed today
    admin.from('orders').select('total_amount')
      .eq('order_date', todayStr).not('order_status', 'in', ACTIVE_ORDER_STATUSES),

    // Orders billed this month
    admin.from('orders').select('total_amount')
      .gte('order_date', monthStart).lt('order_date', monthEnd)
      .not('order_status', 'in', ACTIVE_ORDER_STATUSES),

    // Orders billed last month (for MoM)
    admin.from('orders').select('total_amount')
      .gte('order_date', lastMonthStart).lt('order_date', lastMonthEnd)
      .not('order_status', 'in', ACTIVE_ORDER_STATUSES),

    // All unpaid / partial orders with customer info (for outstanding balance + top debtors)
    admin.from('orders')
      .select('customer_id, total_amount, customers(full_name, customer_code)')
      .in('payment_status', ['unpaid', 'partial'])
      .not('order_status', 'in', ACTIVE_ORDER_STATUSES),

    // Orders billed — last 30 days by day (chart)
    admin.from('orders').select('order_date, total_amount')
      .gte('order_date', d30Start).lte('order_date', todayStr)
      .not('order_status', 'in', ACTIVE_ORDER_STATUSES),

    // Draft invoices (pending issuance)
    admin.from('invoices').select('total_amount').eq('status', 'draft'),

    // Issued invoices outstanding (issued + overdue + partial)
    admin.from('invoices').select('total_amount')
      .in('status', ['issued', 'overdue', 'partial']),
  ])

  // ── Payment KPIs ───────────────────────────────────────────────────────────
  const todayRevenue  = (todayPayments  ?? []).reduce((s, p) => s + parseFloat(String(p.amount)), 0)
  const monthRevenue  = (monthPayments  ?? []).reduce((s, p) => s + parseFloat(String(p.amount)), 0)
  const lastMonthRev  = (lastMonthPay   ?? []).reduce((s, p) => s + parseFloat(String(p.amount)), 0)
  const mrr           = (activeSubs     ?? []).reduce((s, p) => s + parseFloat(String(p.agreed_monthly_price)), 0)
  const activeCount   = (allCustomers   ?? []).filter(c => c.status === 'active').length
  const pausedCount   = (allCustomers   ?? []).filter(c => c.status === 'paused').length

  // ── Order KPIs ─────────────────────────────────────────────────────────────
  const todayBilled      = (todayOrderAmounts   ?? []).reduce((s, o) => s + parseFloat(String(o.total_amount)), 0)
  const monthBilled      = (monthOrderAmounts   ?? []).reduce((s, o) => s + parseFloat(String(o.total_amount)), 0)
  const lastMonthBilled  = (lastMonthOrderAmounts ?? []).reduce((s, o) => s + parseFloat(String(o.total_amount)), 0)
  const totalOutstandingOrders = (unpaidOrders ?? []).reduce((s, o) => s + parseFloat(String(o.total_amount)), 0)

  // Top debtors — aggregate unpaid orders by customer
  type UnpaidRow = { customer_id: string; total_amount: string; customers: { full_name: string; customer_code: string } | null }
  const debtorMap = new Map<string, { full_name: string; customer_code: string; outstanding: number }>()
  for (const o of (unpaidOrders ?? []) as unknown as UnpaidRow[]) {
    const key = o.customer_id
    const cust = o.customers
    if (!cust) continue
    const existing = debtorMap.get(key)
    const amt = parseFloat(String(o.total_amount))
    if (existing) {
      existing.outstanding += amt
    } else {
      debtorMap.set(key, { full_name: cust.full_name, customer_code: cust.customer_code, outstanding: amt })
    }
  }
  const topDebtors = [...debtorMap.values()]
    .sort((a, b) => b.outstanding - a.outstanding)
    .slice(0, 5)

  // ── Subscription outstanding (legacy) ─────────────────────────────────────
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
  // Payments chart (last 30d)
  const payDayMap = new Map<string, number>()
  for (const p of pay30d ?? []) {
    payDayMap.set(p.payment_date, (payDayMap.get(p.payment_date) ?? 0) + parseFloat(String(p.amount)))
  }

  // Orders chart (last 30d) — used when payments are 0
  const billedDayMap = new Map<string, number>()
  for (const o of billed30dRows ?? []) {
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
  const draftInvoiceCount  = (draftInvoices ?? []).length
  const draftInvoiceTotal  = (draftInvoices ?? []).reduce((s, i) => s + parseFloat(String(i.total_amount)), 0)
  const issuedOutstanding  = (issuedInvoices ?? []).reduce((s, i) => s + parseFloat(String(i.total_amount)), 0)

  const dashData: DashboardData = {
    userName:            user.full_name.split(' ')[0],
    // Payments
    todayRevenue,
    monthRevenue,
    lastMonthRevenue:    lastMonthRev,
    // Orders (billed)
    todayBilled,
    monthBilled,
    lastMonthBilled,
    totalOutstandingOrders,
    billed30d,
    topDebtors,
    // Invoices
    draftInvoiceCount,
    draftInvoiceTotal,
    issuedOutstanding,
    // Subscriptions
    mrr,
    activeSubscriptions: subs.length,
    totalOutstanding:    subOutstanding,
    topBalances:         balanceRows.slice(0, 5),
    // Customers
    activeCustomers:     activeCount,
    pausedCustomers:     pausedCount,
    totalCustomers:      (allCustomers ?? []).length,
    newCustomersMonth:   newCustomers?.length ?? 0,
    // Operations
    ordersToday:         orders.length,
    ordersByPeriod:      byPeriod,
    pendingApprovals:    pendingApprovals ?? 0,
    // Chart
    rev30d,
    recentPayments:      ((recentPayments ?? []) as unknown as PayRow[]).slice(0, 6),
  }

  return <DashboardModule data={dashData} />
}
