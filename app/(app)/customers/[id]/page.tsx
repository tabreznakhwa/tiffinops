import { notFound } from 'next/navigation'
import { formatInTimeZone } from 'date-fns-tz'
import { requireAuth } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { CustomerDetailView } from '@/components/customers/customer-detail-view'
import type { BalanceSummary } from '@/components/customers/customer-detail-view'

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

  const [
    { data: customer },
    { data: rawSub },
    { data: payments },
    { data: monthOrders },
    { data: recentOrders },
  ] = await Promise.all([
    admin.from('customers').select('*').eq('id', id).single(),

    // Active subscription (latest)
    admin
      .from('customer_subscriptions')
      .select('agreed_monthly_price, fixed_plans(plan_name)')
      .eq('customer_id', id)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),

    // All non-voided payments, newest first
    admin
      .from('payments')
      .select('id, payment_number, amount, mode, payment_date')
      .eq('customer_id', id)
      .is('voided_at', null)
      .order('payment_date', { ascending: false }),

    // This month's a-la-carte credit orders
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
  ])

  if (!customer) notFound()

  const allPayments = payments ?? []
  const sub = rawSub as unknown as { agreed_monthly_price: string; fixed_plans: { plan_name: string } | null } | null

  const monthPaid = allPayments
    .filter(p => p.payment_date >= monthStart && p.payment_date < monthEnd)
    .reduce((s, p) => s + parseFloat(String(p.amount)), 0)

  const allTimePaid = allPayments
    .reduce((s, p) => s + parseFloat(String(p.amount)), 0)

  const monthOrdersTotal = (monthOrders ?? [])
    .reduce((s, o) => s + parseFloat(String(o.total_amount)), 0)

  const balance: BalanceSummary = {
    monthlyCharge: sub ? parseFloat(String(sub.agreed_monthly_price)) : 0,
    subscriptionPlanName: sub?.fixed_plans?.plan_name ?? null,
    monthPaid,
    monthOrdersTotal,
    allTimePaid,
    currentMonth,
    recentPayments: allPayments.slice(0, 5).map(p => ({
      id: p.id,
      payment_number: p.payment_number,
      amount: String(p.amount),
      mode: p.mode as string,
      payment_date: p.payment_date,
    })),
  }

  type OrderWithItems = {
    id: string; order_number: string; order_date: string
    meal_period: string; total_amount: string; order_status: string
    order_items: { item_name_snapshot: string; quantity: string }[]
  }

  return (
    <CustomerDetailView
      customer={customer}
      canWrite={WRITER_ROLES.includes(user.role)}
      canAdmin={ADMIN_ROLES.includes(user.role)}
      balance={balance}
      orders={(recentOrders ?? []) as unknown as OrderWithItems[]}
    />
  )
}
