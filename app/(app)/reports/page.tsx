export const dynamic = 'force-dynamic'

import { formatInTimeZone } from 'date-fns-tz'
import { requireAuth } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { ReportsModule } from '@/components/reports/reports-module'
import type { ReportData } from '@/components/reports/reports-module'

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; tab?: string }>
}) {
  await requireAuth()

  const { from: qFrom, to: qTo, tab = 'revenue' } = await searchParams

  // Dubai today
  const todayStr   = formatInTimeZone(new Date(), 'Asia/Dubai', 'yyyy-MM-dd')
  const monthStr   = formatInTimeZone(new Date(), 'Asia/Dubai', 'yyyy-MM')
  const monthStart = `${monthStr}-01`

  // Report date range — default to current month
  const from = qFrom || monthStart
  const to   = qTo   || todayStr

  // Previous period (same length, immediately before)
  const fromDate = new Date(from + 'T00:00:00Z')
  const toDate   = new Date(to   + 'T00:00:00Z')
  const rangeDays = Math.max(1, Math.round((toDate.getTime() - fromDate.getTime()) / 86400000) + 1)
  const prevTo   = new Date(fromDate.getTime() - 86400000).toISOString().split('T')[0]
  const prevFrom = new Date(fromDate.getTime() - rangeDays * 86400000).toISOString().split('T')[0]

  const admin = createAdminClient()

  const [
    { data: rawPayments },
    { data: prevPayments },
    { data: allCustomers },
    { data: newCustomers },
    { data: rawSubs },
    { data: allOrders },
    { data: rawItems },
    { data: allSubsMonth },
  ] = await Promise.all([
    // Payments in selected range (non-voided)
    admin.from('payments')
      .select('payment_date, amount, mode, customer_id, customers(full_name, customer_code)')
      .is('voided_at', null)
      .gte('payment_date', from)
      .lte('payment_date', to)
      .order('payment_date'),

    // Previous period payments (for comparison)
    admin.from('payments')
      .select('amount')
      .is('voided_at', null)
      .gte('payment_date', prevFrom)
      .lte('payment_date', prevTo),

    // All customers
    admin.from('customers').select('id, customer_type, status, area, created_at'),

    // New customers in range
    admin.from('customers')
      .select('id')
      .gte('created_at', from + 'T00:00:00Z')
      .lte('created_at', to + 'T23:59:59Z'),

    // All subscriptions with plan name
    admin.from('customer_subscriptions')
      .select('id, customer_id, status, agreed_monthly_price, start_date, fixed_plans(plan_name), customers(full_name, customer_code)')
      .order('created_at', { ascending: false }),

    // Orders in range
    admin.from('orders')
      .select('id, order_date, meal_period, total_amount, customer_id')
      .gte('order_date', from)
      .lte('order_date', to)
      .not('order_status', 'in', '(cancelled,voided,draft)'),

    // Order items in range (for top items)
    admin.from('order_items')
      .select('item_name_snapshot, quantity, total_price, orders!inner(order_date, order_status)')
      .gte('orders.order_date', from)
      .lte('orders.order_date', to)
      .not('orders.order_status', 'in', '(cancelled,voided,draft)'),

    // This month's payments (for balance calculation)
    admin.from('payments')
      .select('customer_id, amount')
      .is('voided_at', null)
      .gte('payment_date', monthStart)
      .lte('payment_date', todayStr),
  ])

  // ── Revenue aggregation ────────────────────────────────────────────────────

  type PayRow = {
    payment_date: string
    amount: string
    mode: string
    customer_id: string
    customers: { full_name: string; customer_code: string } | null
  }
  const payments = (rawPayments ?? []) as unknown as PayRow[]

  const prevTotal = (prevPayments ?? []).reduce((s, p) => s + parseFloat(String(p.amount)), 0)
  const revenueTotal = payments.reduce((s, p) => s + parseFloat(String(p.amount)), 0)

  // Daily revenue
  const dayMap = new Map<string, number>()
  for (const p of payments) {
    dayMap.set(p.payment_date, (dayMap.get(p.payment_date) ?? 0) + parseFloat(String(p.amount)))
  }
  const revenueByDay = [...dayMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, amount]) => ({ date, amount }))

  // By mode
  const modeMap = new Map<string, { amount: number; count: number }>()
  for (const p of payments) {
    const cur = modeMap.get(p.mode) ?? { amount: 0, count: 0 }
    modeMap.set(p.mode, { amount: cur.amount + parseFloat(String(p.amount)), count: cur.count + 1 })
  }
  const MODE_LABELS: Record<string, string> = {
    cash: 'Cash', bank_transfer: 'Bank Transfer', card: 'Card',
    online: 'Online', cheque: 'Cheque', wallet: 'Wallet', other: 'Other',
  }
  const revenueByMode = [...modeMap.entries()]
    .sort((a, b) => b[1].amount - a[1].amount)
    .map(([mode, v]) => ({ mode, label: MODE_LABELS[mode] ?? mode, ...v }))

  // Top customers by payments in range
  const custPayMap = new Map<string, { name: string; code: string; total: number }>()
  for (const p of payments) {
    const key = p.customer_id
    const cur = custPayMap.get(key) ?? { name: p.customers?.full_name ?? 'Unknown', code: p.customers?.customer_code ?? '', total: 0 }
    custPayMap.set(key, { ...cur, total: cur.total + parseFloat(String(p.amount)) })
  }
  const topCustomers = [...custPayMap.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 10)
    .map(([id, v]) => ({ id, ...v }))

  // ── Customer aggregation ───────────────────────────────────────────────────

  const customers = allCustomers ?? []
  const byStatus = ['active', 'paused', 'inactive', 'blacklisted'].map(s => ({
    status: s, count: customers.filter(c => c.status === s).length,
  }))
  const byType = [
    { type: 'fixed_menu', label: 'Fixed Menu' },
    { type: 'a_la_carte', label: 'A La Carte' },
    { type: 'hybrid',     label: 'Hybrid'     },
  ].map(t => ({ ...t, count: customers.filter(c => c.customer_type === t.type).length }))

  const areaMap = new Map<string, number>()
  for (const c of customers) {
    if (c.area) areaMap.set(c.area, (areaMap.get(c.area) ?? 0) + 1)
  }
  const byArea = [...areaMap.entries()].sort((a, b) => b[1] - a[1]).map(([area, count]) => ({ area, count }))

  // ── Subscription aggregation ───────────────────────────────────────────────

  type SubRow = {
    id: string
    customer_id: string
    status: string
    agreed_monthly_price: string
    start_date: string
    fixed_plans: { plan_name: string } | null
    customers: { full_name: string; customer_code: string } | null
  }
  const subs = (rawSubs ?? []) as unknown as SubRow[]

  const activeSubs     = subs.filter(s => s.status === 'active')
  const pausedSubs     = subs.filter(s => s.status === 'paused')
  const cancelledSubs  = subs.filter(s => s.status === 'cancelled')
  const completedSubs  = subs.filter(s => s.status === 'completed')
  const mrr = activeSubs.reduce((s, sub) => s + parseFloat(String(sub.agreed_monthly_price)), 0)

  const planMap = new Map<string, { count: number; mrr: number }>()
  for (const sub of activeSubs) {
    const name = sub.fixed_plans?.plan_name ?? 'Unknown Plan'
    const cur  = planMap.get(name) ?? { count: 0, mrr: 0 }
    planMap.set(name, { count: cur.count + 1, mrr: cur.mrr + parseFloat(String(sub.agreed_monthly_price)) })
  }
  const subsByPlan = [...planMap.entries()]
    .sort((a, b) => b[1].mrr - a[1].mrr)
    .map(([plan_name, v]) => ({ plan_name, ...v }))

  const recentSubs = subs
    .filter(s => s.status === 'active' && s.start_date >= from && s.start_date <= to)
    .slice(0, 10)
    .map(s => ({
      full_name:  s.customers?.full_name ?? 'Unknown',
      customer_code: s.customers?.customer_code ?? '',
      plan_name:  s.fixed_plans?.plan_name ?? 'Unknown Plan',
      start_date: s.start_date,
      price:      parseFloat(String(s.agreed_monthly_price)),
    }))

  // ── Outstanding balances ───────────────────────────────────────────────────

  // Build payment totals map for this month
  const monthPayMap = new Map<string, number>()
  for (const p of allSubsMonth ?? []) {
    monthPayMap.set(p.customer_id, (monthPayMap.get(p.customer_id) ?? 0) + parseFloat(String(p.amount)))
  }

  const balanceRows = activeSubs.map(s => {
    const charge  = parseFloat(String(s.agreed_monthly_price))
    const paid    = monthPayMap.get(s.customer_id) ?? 0
    const balance = charge - paid
    return {
      id:            s.customer_id,
      full_name:     s.customers?.full_name ?? 'Unknown',
      customer_code: s.customers?.customer_code ?? '',
      monthlyCharge: charge,
      monthPaid:     paid,
      balance,
    }
  }).filter(r => r.balance > 0.005).sort((a, b) => b.balance - a.balance)

  const totalOutstanding = balanceRows.reduce((s, r) => s + r.balance, 0)

  // ── Orders aggregation ─────────────────────────────────────────────────────

  const orders = allOrders ?? []
  const orderDayMap = new Map<string, number>()
  for (const o of orders) {
    orderDayMap.set(o.order_date, (orderDayMap.get(o.order_date) ?? 0) + 1)
  }
  const ordersByDay = [...orderDayMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, count]) => ({ date, count }))

  const periodMap = new Map<string, { count: number; revenue: number }>()
  for (const o of orders) {
    const cur = periodMap.get(o.meal_period) ?? { count: 0, revenue: 0 }
    periodMap.set(o.meal_period, {
      count:   cur.count + 1,
      revenue: cur.revenue + parseFloat(String(o.total_amount)),
    })
  }
  const PERIOD_LABELS: Record<string, string> = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner' }
  const ordersByPeriod = ['breakfast', 'lunch', 'dinner'].map(p => ({
    period:  PERIOD_LABELS[p] ?? p,
    count:   periodMap.get(p)?.count ?? 0,
    revenue: periodMap.get(p)?.revenue ?? 0,
  }))

  type ItemRow = { item_name_snapshot: string; quantity: number; total_price: string }
  const items = (rawItems ?? []) as unknown as ItemRow[]
  const itemMap = new Map<string, { qty: number; revenue: number }>()
  for (const item of items) {
    const cur = itemMap.get(item.item_name_snapshot) ?? { qty: 0, revenue: 0 }
    itemMap.set(item.item_name_snapshot, {
      qty:     cur.qty + Number(item.quantity),
      revenue: cur.revenue + parseFloat(String(item.total_price)),
    })
  }
  const topItems = [...itemMap.entries()]
    .sort((a, b) => b[1].qty - a[1].qty)
    .slice(0, 15)
    .map(([name, v]) => ({ name, qty: v.qty, revenue: v.revenue }))

  // ── Assemble report data ───────────────────────────────────────────────────

  const data: ReportData = {
    range:   { from, to, days: rangeDays },
    revenue: {
      total:        revenueTotal,
      count:        payments.length,
      prevTotal,
      byDay:        revenueByDay,
      byMode:       revenueByMode,
      topCustomers,
    },
    customers: {
      total:      customers.length,
      newInRange: newCustomers?.length ?? 0,
      byStatus,
      byType,
      byArea,
      topCustomers,
    },
    subscriptions: {
      active:      activeSubs.length,
      paused:      pausedSubs.length,
      cancelled:   cancelledSubs.length,
      completed:   completedSubs.length,
      mrr,
      byPlan:      subsByPlan,
      recentSubs,
    },
    balances: {
      totalOutstanding,
      rows: balanceRows,
    },
    orders: {
      total:     orders.length,
      byDay:     ordersByDay,
      byPeriod:  ordersByPeriod,
      topItems,
    },
  }

  return <ReportsModule data={data} initialTab={tab} />
}
