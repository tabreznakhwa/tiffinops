export const dynamic = 'force-dynamic'

import { formatInTimeZone } from 'date-fns-tz'
import { requireAuth } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCustomerBalancesInRange } from '@/lib/db/aggregates'
import { chargeForCustomer, groupSubscriptionsByCustomer } from '@/lib/billing/subscription-charge'
import { CustomersModule } from '@/components/customers/customers-module'

const WRITER_ROLES = ['owner', 'manager', 'data_entry']

export default async function CustomersPage() {
  const user = await requireAuth()
  const admin = createAdminClient()

  // Current Dubai month boundaries
  const today      = formatInTimeZone(new Date(), 'Asia/Dubai', 'yyyy-MM-dd')
  const monthStr   = formatInTimeZone(new Date(), 'Asia/Dubai', 'yyyy-MM')
  const monthStart = `${monthStr}-01`
  const [y, m]     = monthStr.split('-').map(Number)
  const monthLast  = `${monthStr}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`
  const billTo     = today < monthLast ? today : monthLast

  const [
    { data: customers },
    { data: allSubs },
    orderAndPaymentTotals,
  ] = await Promise.all([
    admin.from('customers').select('*').order('full_name'),

    // Every subscription row — all statuses, so overlapping rows can be clamped
    admin
      .from('customer_subscriptions')
      .select('id, customer_id, start_date, end_date, status, agreed_monthly_price, fixed_plans(meal_periods)'),

    // Orders billed and payments received this month, aggregated in Postgres
    getCustomerBalancesInRange(admin, monthStart, billTo),
  ])

  // Charges = pro-rated subscription for the days covered this month + orders.
  // Using the flat monthly rate here used to over-bill anyone who joined
  // mid-month; chargeForCustomer also removes double-billing when an old
  // subscription overlaps its replacement.
  const subsByCustomer = groupSubscriptionsByCustomer(
    ((allSubs ?? []) as unknown as {
      customer_id: string
      start_date: string
      end_date: string | null
      status: string
      agreed_monthly_price: string
      fixed_plans: { meal_periods: string[] | null } | null
    }[]).map(s => ({ ...s, meal_periods: s.fixed_plans?.meal_periods ?? null }))
  )

  // positive = amount still due; negative = credit/overpaid
  const balances: Record<string, number> = {}

  for (const b of orderAndPaymentTotals) {
    balances[b.customer_id] = (balances[b.customer_id] ?? 0) + b.order_total - b.payment_total
  }
  for (const [customerId, custSubs] of subsByCustomer) {
    const charge = chargeForCustomer(custSubs, monthStart, billTo)
    if (charge !== 0) balances[customerId] = (balances[customerId] ?? 0) + charge
  }

  return (
    <CustomersModule
      customers={customers ?? []}
      canWrite={WRITER_ROLES.includes(user.role)}
      balances={balances}
    />
  )
}
