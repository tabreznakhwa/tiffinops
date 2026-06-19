import { formatInTimeZone } from 'date-fns-tz'
import { requireAuth } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { DeliveriesModule } from '@/components/deliveries/deliveries-module'
import type { DeliveryEntry } from '@/components/deliveries/deliveries-module'

type SubscriptionWithJoins = {
  id: string
  customer_id: string
  fixed_plan_id: string
  start_date: string
  end_date: string | null
  status: string
  fixed_plans: {
    plan_name: string
    meal_periods: ('breakfast' | 'lunch' | 'dinner')[]
  } | null
  customers: {
    id: string
    full_name: string
    customer_code: string
    area: string | null
    delivery_address: string | null
    delivery_instructions: string | null
    mobile_number: string
  } | null
}

type DeliveryRow = {
  id: string
  customer_id: string
  delivery_date: string
  meal_period: 'breakfast' | 'lunch' | 'dinner' | null
  status: string
  skip_reason: string | null
  skip_note: string | null
  delivered_at: string | null
}

const PERIOD_ORDER: Record<string, number> = {
  breakfast: 0,
  lunch: 1,
  dinner: 2,
}

const WRITER_ROLES = ['owner', 'manager', 'data_entry', 'packer']

export default async function DeliveriesPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>
}) {
  const [user, { date: dateParam }] = await Promise.all([
    requireAuth(),
    searchParams,
  ])

  const todayDubai = formatInTimeZone(new Date(), 'Asia/Dubai', 'yyyy-MM-dd')
  const selectedDate = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : todayDubai

  const admin = createAdminClient()

  const [{ data: rawSubs }, { data: rawDeliveries }] = await Promise.all([
    admin
      .from('customer_subscriptions')
      .select(`
        id, customer_id, fixed_plan_id, start_date, end_date, status,
        fixed_plans(plan_name, meal_periods),
        customers(id, full_name, customer_code, area, delivery_address, delivery_instructions, mobile_number)
      `)
      .eq('status', 'active'),

    admin
      .from('deliveries')
      .select('id, customer_id, delivery_date, meal_period, status, skip_reason, skip_note, delivered_at')
      .eq('delivery_date', selectedDate),
  ])

  const subscriptions = (rawSubs ?? []) as unknown as SubscriptionWithJoins[]
  const deliveries = (rawDeliveries ?? []) as DeliveryRow[]

  // Build a lookup: "customer_id|meal_period" -> delivery record
  const deliveryMap = new Map<string, DeliveryRow>()
  for (const d of deliveries) {
    if (d.meal_period) {
      deliveryMap.set(`${d.customer_id}|${d.meal_period}`, d)
    }
  }

  // Expand subscriptions into delivery entries
  const entries: DeliveryEntry[] = []

  for (const sub of subscriptions) {
    if (!sub.customers || !sub.fixed_plans) continue

    const periods = sub.fixed_plans.meal_periods
    for (const period of periods) {
      const key = `${sub.customer_id}|${period}`
      const deliveryRow = deliveryMap.get(key) ?? null

      entries.push({
        customer_id: sub.customer_id,
        subscription_id: sub.id,
        customer: sub.customers,
        plan_name: sub.fixed_plans.plan_name,
        meal_period: period,
        delivery: deliveryRow
          ? {
              id: deliveryRow.id,
              status: deliveryRow.status,
              skip_reason: deliveryRow.skip_reason,
              skip_note: deliveryRow.skip_note,
              delivered_at: deliveryRow.delivered_at,
            }
          : null,
      })
    }
  }

  // Sort: breakfast first, lunch second, dinner third, then by customer name
  entries.sort((a, b) => {
    const periodDiff = (PERIOD_ORDER[a.meal_period] ?? 9) - (PERIOD_ORDER[b.meal_period] ?? 9)
    if (periodDiff !== 0) return periodDiff
    return a.customer.full_name.localeCompare(b.customer.full_name)
  })

  const canWrite = WRITER_ROLES.includes(user.role)

  return (
    <DeliveriesModule
      entries={entries}
      selectedDate={selectedDate}
      todayDubai={todayDubai}
      canWrite={canWrite}
    />
  )
}
