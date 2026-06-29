export const dynamic = 'force-dynamic'

import { formatInTimeZone } from 'date-fns-tz'
import { requireAuth } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { PackingModule } from '@/components/packing/packing-module'
import type { Enums } from '@/lib/supabase/types'
import type { OrderWithDetails } from '@/components/packing/packing-module'

type MealPeriod = Enums<'meal_period'>

export default async function PackingPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>
}) {
  await requireAuth()

  const { date } = await searchParams
  const now = new Date()
  const todayDubai = formatInTimeZone(now, 'Asia/Dubai', 'yyyy-MM-dd')
  const packDate =
    date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : todayDubai

  const currentHour = parseInt(formatInTimeZone(now, 'Asia/Dubai', 'H'), 10)
  const defaultPeriod: MealPeriod =
    currentHour < 10 ? 'breakfast' : currentHour < 15 ? 'lunch' : 'dinner'

  const admin = createAdminClient()

  const { data: orders } = await admin
    .from('orders')
    .select(`
      id,
      order_number,
      meal_period,
      order_status,
      total_amount,
      notes,
      created_at,
      customers(id, full_name, customer_code, area, delivery_address),
      order_items(id, item_name_snapshot, quantity, total_price)
    `)
    .eq('order_date', packDate)
    .in('order_status', ['confirmed', 'preparing', 'out_for_delivery', 'delivered'])
    .order('created_at', { ascending: true })

  return (
    <PackingModule
      orders={(orders ?? []) as unknown as OrderWithDetails[]}
      packDate={packDate}
      todayDubai={todayDubai}
      defaultPeriod={defaultPeriod}
    />
  )
}
