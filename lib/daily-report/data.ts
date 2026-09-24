// Shared data-loading for the Daily Report — used by both the on-screen page
// and its print route so they never drift. Accepts a date range (from/to);
// a single day is just from === to.
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

// Every calendar date from `from` to `to` inclusive — UTC-based so this never
// drifts a day under DST, matching the date-math already used in the UI.
function datesInRange(from: string, to: string): string[] {
  const out: string[] = []
  const d = new Date(from + 'T00:00:00Z')
  const end = new Date(to + 'T00:00:00Z')
  while (d <= end) {
    out.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}

export async function loadDailyReportData(from: string, to: string): Promise<{
  orders: OrderRow[]
  fixedMenuCounts: FixedMenuCounts
  costByItem: Record<string, number>
}> {
  const admin = createAdminClient()

  const [{ data: orders }, { data: subsData }, { data: pauseRows }, { data: menuItems }] = await Promise.all([
    // Every non-cancelled/voided/draft order in the range — à la carte orders
    // plus hybrid customers' "extra" orders. This is the only place dish-level
    // data exists; fixed-menu subscription meals have none (see below).
    admin
      .from('orders')
      .select('id, meal_period, order_status, total_amount, order_items(id, item_name_snapshot, quantity, total_price)')
      .gte('order_date', from)
      .lte('order_date', to)
      .not('order_status', 'in', '(cancelled,voided,draft)'),

    // Every subscription row — needed to resolve, per customer per day, which
    // meal periods were actually in force (and not paused).
    admin
      .from('customer_subscriptions')
      .select('id, customer_id, start_date, end_date, agreed_monthly_price, meal_prices, status, fixed_plans(meal_periods)'),

    // Meal-level pauses overlapping any part of the range
    admin
      .from('subscription_meal_pauses')
      .select('subscription_id, meal_period, pause_start, pause_end')
      .lte('pause_start', to)
      .or(`pause_end.is.null,pause_end.gte.${from}`),

    // Cost price per item (optional — only set for vendor-bought items like
    // Moti Roti / Rumali Roti). Used to compute profit in the report.
    admin
      .from('menu_items')
      .select('name, cost_price'),
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

  // Fixed-menu attendance: how many customer-meal-instances had that period
  // in force (not past end_date, not meal-paused) on each date in the range —
  // same resolution rule the Outstanding report uses for "in force", summed
  // across every day. There is no dish-level record for these meals anywhere
  // in the system (daily_menu_items has never been used), so this is a
  // headcount only, not a per-item split.
  const fixedMenuCounts: FixedMenuCounts = { breakfast: 0, lunch: 0, dinner: 0 }
  for (const date of datesInRange(from, to)) {
    for (const [, custSubs] of subsByCustomer) {
      const covered = mealPeriodsCoveredOn(custSubs, date)
      if (!covered) continue
      for (const period of covered) {
        if (period === 'breakfast' || period === 'lunch' || period === 'dinner') fixedMenuCounts[period]++
      }
    }
  }

  const costByItem: Record<string, number> = {}
  for (const m of (menuItems ?? []) as { name: string; cost_price: string | null }[]) {
    if (m.cost_price == null) continue
    const key = m.name.trim().toLowerCase()
    if (!(key in costByItem)) costByItem[key] = parseFloat(m.cost_price) || 0
  }

  return {
    orders: (orders ?? []) as unknown as OrderRow[],
    fixedMenuCounts,
    costByItem,
  }
}
