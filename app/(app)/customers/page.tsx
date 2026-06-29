export const dynamic = 'force-dynamic'

import { formatInTimeZone } from 'date-fns-tz'
import { requireAuth } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { CustomersModule } from '@/components/customers/customers-module'

const WRITER_ROLES = ['owner', 'manager', 'data_entry']

export default async function CustomersPage() {
  const user = await requireAuth()
  const admin = createAdminClient()

  // Current Dubai month boundaries
  const monthStr   = formatInTimeZone(new Date(), 'Asia/Dubai', 'yyyy-MM')
  const monthStart = `${monthStr}-01`
  const [y, m]     = monthStr.split('-').map(Number)
  const monthEnd   = new Date(y, m, 1).toISOString().split('T')[0]

  const [
    { data: customers },
    { data: activeSubs },
    { data: monthPayments },
    { data: monthOrders },
  ] = await Promise.all([
    admin.from('customers').select('*').order('full_name'),

    // Active subscriptions — the "charge" side
    admin
      .from('customer_subscriptions')
      .select('customer_id, agreed_monthly_price')
      .eq('status', 'active'),

    // Non-voided payments received this month
    admin
      .from('payments')
      .select('customer_id, amount')
      .is('voided_at', null)
      .gte('payment_date', monthStart)
      .lt('payment_date', monthEnd),

    // A-la-carte credit orders this month
    admin
      .from('orders')
      .select('customer_id, total_amount')
      .gte('order_date', monthStart)
      .lt('order_date', monthEnd)
      .eq('is_credit', true)
      .not('order_status', 'in', '(cancelled,voided,draft)'),
  ])

  // Build balance map: charge (subscription + orders) − payments received
  const chargeMap  = new Map<string, number>()
  const paymentMap = new Map<string, number>()

  for (const sub of activeSubs ?? []) {
    const v = parseFloat(String(sub.agreed_monthly_price))
    chargeMap.set(sub.customer_id, (chargeMap.get(sub.customer_id) ?? 0) + v)
  }
  for (const o of monthOrders ?? []) {
    const v = parseFloat(String(o.total_amount))
    chargeMap.set(o.customer_id, (chargeMap.get(o.customer_id) ?? 0) + v)
  }
  for (const p of monthPayments ?? []) {
    const v = parseFloat(String(p.amount))
    paymentMap.set(p.customer_id, (paymentMap.get(p.customer_id) ?? 0) + v)
  }

  // positive = amount still due; negative = credit/overpaid
  const balances: Record<string, number> = {}
  const allIds = new Set([...chargeMap.keys(), ...paymentMap.keys()])
  for (const id of allIds) {
    balances[id] = (chargeMap.get(id) ?? 0) - (paymentMap.get(id) ?? 0)
  }

  return (
    <CustomersModule
      customers={customers ?? []}
      canWrite={WRITER_ROLES.includes(user.role)}
      balances={balances}
    />
  )
}
