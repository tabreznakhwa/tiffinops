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
  // Last month same period (for MoM comparison)
  const lastMonthStr   = formatInTimeZone(new Date(y, m - 2, 1), 'Asia/Dubai', 'yyyy-MM')
  const lastMonthStart = `${lastMonthStr}-01`
  const lastMonthEnd   = monthStart

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
  ] = await Promise.all([
    // Today's payments (non-voided)
    admin.from('payments').select('amount').is('voided_at', null).eq('payment_date', todayStr),

    // This month's payments
    admin.from('payments').select('amount').is('voided_at', null)
      .gte('payment_date', monthStart).lt('payment_date', monthEnd),

    // Last month's payments (for comparison)
    admin.from('payments').select('amount').is('voided_at', null)
      .gte('payment_date', lastMonthStart).lt('payment_date', lastMonthEnd),

    // All customers
    admin.from('customers').select('id, status, customer_type, full_name, customer_code'),

    // New customers this month
    admin.from('customers').select('id').gte('created_at', monthStart + 'T00:00:00Z'),

    // Active subscriptions (for MRR + balance calc)
    admin.from('customer_subscriptions')
      .select('customer_id, agreed_monthly_price, customers(full_name, customer_code)')
      .eq('status', 'active'),

    // Today's orders
    admin.from('orders').select('id, meal_period')
      .eq('order_date', todayStr).not('order_status', 'in', '(cancelled,voided,draft)'),

    // Pending approvals count
    admin.from('approval_requests').select('*', { count: 'exact', head: true }).eq('status', 'pending'),

    // Recent 8 payments
    admin.from('payments')
      .select('id, payment_number, payment_date, amount, mode, voided_at, customers(full_name, customer_code)')
      .order('created_at', { ascending: false }).limit(8),

    // Last 30 days payments by day (for sparkline)
    admin.from('payments').select('payment_date, amount')
      .is('voided_at', null).gte('payment_date', d30Start).lte('payment_date', todayStr),
  ])

  // ── KPI computation ────────────────────────────────────────────────────────

  const todayRevenue  = (todayPayments  ?? []).reduce((s, p) => s + parseFloat(String(p.amount)), 0)
  const monthRevenue  = (monthPayments  ?? []).reduce((s, p) => s + parseFloat(String(p.amount)), 0)
  const lastMonthRev  = (lastMonthPay   ?? []).reduce((s, p) => s + parseFloat(String(p.amount)), 0)
  const mrr           = (activeSubs     ?? []).reduce((s, p) => s + parseFloat(String(p.agreed_monthly_price)), 0)
  const activeCount   = (allCustomers   ?? []).filter(c => c.status === 'active').length
  const pausedCount   = (allCustomers   ?? []).filter(c => c.status === 'paused').length

  // Monthly payment totals map for balance calc
  const monthPayMap = new Map<string, number>()
  for (const p of monthPayments ?? []) {
    // We don't have customer_id in this query — re-fetch for balance below
  }
  // Re-query for balance — get payments with customer_id this month
  const { data: monthPayWithCust } = await admin.from('payments')
    .select('customer_id, amount').is('voided_at', null)
    .gte('payment_date', monthStart).lt('payment_date', monthEnd)

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

  const totalOutstanding = balanceRows.reduce((s, r) => s + r.balance, 0)

  // 30-day revenue by day
  const dayMap = new Map<string, number>()
  for (const p of pay30d ?? []) {
    dayMap.set(p.payment_date, (dayMap.get(p.payment_date) ?? 0) + parseFloat(String(p.amount)))
  }
  // Fill all 30 days (including zeros)
  const rev30d = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(now.getTime() - (29 - i) * 86400000).toISOString().split('T')[0]
    return { date: d, amount: dayMap.get(d) ?? 0 }
  })

  // Orders by meal period today
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

  const dashData: DashboardData = {
    userName:         user.full_name.split(' ')[0],
    todayRevenue,
    monthRevenue,
    lastMonthRevenue: lastMonthRev,
    mrr,
    activeCustomers:  activeCount,
    pausedCustomers:  pausedCount,
    totalCustomers:   (allCustomers ?? []).length,
    newCustomersMonth: newCustomers?.length ?? 0,
    activeSubscriptions: subs.length,
    ordersToday:      orders.length,
    ordersByPeriod:   byPeriod,
    totalOutstanding,
    pendingApprovals: pendingApprovals ?? 0,
    rev30d,
    topBalances:      balanceRows.slice(0, 5),
    recentPayments:   ((recentPayments ?? []) as unknown as PayRow[]).slice(0, 6),
  }

  return <DashboardModule data={dashData} />
}
