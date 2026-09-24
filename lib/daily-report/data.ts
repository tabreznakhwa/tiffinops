// Shared data-loading for the Daily Report — used by both the on-screen page
// and its print route so they never drift.
import { createAdminClient } from '@/lib/supabase/admin'
import { groupSubscriptionsByCustomer, mealPeriodsCoveredOn } from '@/lib/billing/subscription-charge'
import type { ChargeableSubscription } from '@/lib/billing/subscription-charge'

export type OrderItemRow = { id: string; item_name_snapshot: string; quantity: string; total_price: string }
export type OrderRow = {
  id: string
  meal_period: 'breakfast' | 'lunch' | 'dinner'
  order_status: string
  total_amount: string
  order_items: OrderItemRow[]
}
export type FixedMenuCounts = { breakfast: number; lunch: number; dinner: number }

export async function loadDailyReportData(reportDate: string): Promise<{
  orders: OrderRow[]
  fixedMenuCounts: FixedMenuCounts
}> {
  const admin = createAdminClient()

  const [{ data: orders }, { data: subsData }, { data: pauseRows }] = await Promise.all([
    // Every non-cancelled/voided/draft order for the day — à la carte orders
    // plus hybrid customers' "extra" orders. This is the only place dish-level
    // data exists; fixed-menu subscription meals have none (see below).
    admin
      .from('orders')
      .select('id, meal_period, order_status, total_amount, order_items(id, item_name_snapshot, quantity, total_price)')
      .eq('order_date', reportDate)
      .not('order_status', 'in', '(cancelled,voided,draft)'),

    // Every subscription row — needed to resolve, per customer, which meal
    // periods were actually in force (and not paused) on this date.
    admin
      .from('customer_subscriptions')
      .select('id, customer_id, start_date, end_date, agreed_monthly_price, meal_prices, status, fixed_plans(meal_periods)'),

    // Meal-level pauses active on this date
    admin
      .from('subscription_meal_pauses')
      .select('subscription_id, meal_period, pause_start, pause_end')
      .lte('pause_start', reportDate)
      .or(`pause_end.is.null,pause_end.gte.${reportDate}`),
  ])

  const pausesBySub = new Map<string, { meal_period: string; pause_start: string; pause_end: string | null }[]>()
  for (const p of pauseRows ?? []) {
    const list = pausesBySub.get(p.subscription_id)
    const row = { meal_period: p.meal_period, pause_start: p.pause_start, pause_end: p.pause_end }
    if (list) list.push(row)
    else pausesBySub.set(p.subscription_id, [row])
  }

  const allSubs = ((subsData ?? []) as unknown as {
    id: string
    customer_id: string
    start_date: string
    end_date: string | null
    agreed_monthly_price: string
    meal_prices: Record<string, string> | null
    status: string
    fixed_plans: { meal_periods: string[] | null } | null
  }[]).map(s => ({
    ...s,
    meal_periods: s.fixed_plans?.meal_periods ?? null,
    meal_pauses: pausesBySub.get(s.id) ?? [],
  })) as unknown as (ChargeableSubscription & { customer_id: string })[]

  const subsByCustomer = groupSubscriptionsByCustomer(allSubs)

  // Fixed-menu attendance per period: how many customers had that meal period
  // in force (not past end_date, not meal-paused) on this date — same
  // resolution rule the Outstanding report uses for "in force". There is no
  // dish-level record for these meals anywhere in the system (daily_menu_items
  // has never been used), so this is a headcount only, not a per-item split.
  const fixedMenuCounts: FixedMenuCounts = { breakfast: 0, lunch: 0, dinner: 0 }
  for (const [, custSubs] of subsByCustomer) {
    const covered = mealPeriodsCoveredOn(custSubs, reportDate)
    if (!covered) continue
    for (const period of covered) {
      if (period === 'breakfast' || period === 'lunch' || period === 'dinner') fixedMenuCounts[period]++
    }
  }

  return {
    orders: (orders ?? []) as unknown as OrderRow[],
    fixedMenuCounts,
  }
}
