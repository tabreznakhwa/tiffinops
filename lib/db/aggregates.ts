// Server-side aggregate helpers backed by the RPCs in
// migrations/031_balance_aggregates.sql.
//
// Each helper falls back to the old client-side paginated aggregation if the
// migration has not been applied yet, so deploying the code before running the
// SQL degrades to the previous behaviour instead of breaking the page.

import type { createAdminClient } from '@/lib/supabase/admin'

type Admin = ReturnType<typeof createAdminClient>

// The generated Database types don't know about these functions, so the rpc
// call is made through a narrow untyped view of the client.
type RpcCallable = {
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{
    data: unknown
    error: { message: string; code?: string } | null
  }>
}

const EXCLUDED_ORDER_STATUSES = '(cancelled,voided,draft)'
const PAGE = 1000

export type CustomerBalance = {
  customer_id: string
  order_total: number
  payment_total: number
}

type RawBalanceRow = {
  customer_id: string
  order_total: string | number
  payment_total: string | number
}

function num(v: unknown): number {
  const n = parseFloat(String(v ?? 0))
  return Number.isFinite(n) ? n : 0
}

function mapBalances(rows: RawBalanceRow[]): CustomerBalance[] {
  return rows.map(r => ({
    customer_id:   r.customer_id,
    order_total:   num(r.order_total),
    payment_total: num(r.payment_total),
  }))
}

/** Page through a query that returns at most PAGE rows per call. */
async function fetchAllPages<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null }>,
): Promise<T[]> {
  const out: T[] = []
  let offset = 0
  while (true) {
    const { data } = await build(offset, offset + PAGE - 1)
    const batch = data ?? []
    out.push(...batch)
    if (batch.length < PAGE) break
    offset += PAGE
  }
  return out
}

// ── All-time per-customer balances ───────────────────────────────────────────

export async function getCustomerBalances(admin: Admin): Promise<CustomerBalance[]> {
  const { data, error } = await (admin as unknown as RpcCallable).rpc('customer_balances')
  if (!error && data) return mapBalances(data as RawBalanceRow[])

  // Fallback: aggregate in JS (slow — run migration 031).
  const [orders, payments] = await Promise.all([
    fetchAllPages<{ customer_id: string | null; total_amount: string }>((from, to) =>
      admin.from('orders')
        .select('customer_id, total_amount')
        .eq('is_credit', true)
        .not('order_status', 'in', EXCLUDED_ORDER_STATUSES)
        .range(from, to) as never,
    ),
    fetchAllPages<{ customer_id: string; amount: string }>((from, to) =>
      admin.from('payments')
        .select('customer_id, amount')
        .is('voided_at', null)
        .range(from, to) as never,
    ),
  ])
  return combine(orders, payments)
}

// ── Per-customer balances within a date range ────────────────────────────────
// Both bounds inclusive.

export async function getCustomerBalancesInRange(
  admin: Admin,
  from: string,
  to: string,
): Promise<CustomerBalance[]> {
  const { data, error } = await (admin as unknown as RpcCallable)
    .rpc('customer_balances_in_range', { p_from: from, p_to: to })
  if (!error && data) return mapBalances(data as RawBalanceRow[])

  const [orders, payments] = await Promise.all([
    fetchAllPages<{ customer_id: string | null; total_amount: string }>((f, t) =>
      admin.from('orders')
        .select('customer_id, total_amount')
        .eq('is_credit', true)
        .not('order_status', 'in', EXCLUDED_ORDER_STATUSES)
        .gte('order_date', from)
        .lte('order_date', to)
        .range(f, t) as never,
    ),
    fetchAllPages<{ customer_id: string; amount: string }>((f, t) =>
      admin.from('payments')
        .select('customer_id, amount')
        .is('voided_at', null)
        .gte('payment_date', from)
        .lte('payment_date', to)
        .range(f, t) as never,
    ),
  ])
  return combine(orders, payments)
}

function combine(
  orders: { customer_id: string | null; total_amount: string }[],
  payments: { customer_id: string; amount: string }[],
): CustomerBalance[] {
  const map = new Map<string, CustomerBalance>()
  const row = (id: string) => {
    let r = map.get(id)
    if (!r) { r = { customer_id: id, order_total: 0, payment_total: 0 }; map.set(id, r) }
    return r
  }
  for (const o of orders) {
    if (!o.customer_id) continue
    row(o.customer_id).order_total += num(o.total_amount)
  }
  for (const p of payments) {
    if (!p.customer_id) continue
    row(p.customer_id).payment_total += num(p.amount)
  }
  return [...map.values()]
}

// ── Order total for a half-open date range [from, to) ────────────────────────

export async function getOrderTotalInRange(
  admin: Admin,
  from: string,
  toExclusive: string,
): Promise<number> {
  const { data, error } = await (admin as unknown as RpcCallable)
    .rpc('order_total_in_range', { p_from: from, p_to: toExclusive })
  if (!error && data !== null && data !== undefined) return num(data)

  const rows = await fetchAllPages<{ total_amount: string }>((f, t) =>
    admin.from('orders')
      .select('total_amount')
      .gte('order_date', from)
      .lt('order_date', toExclusive)
      .not('order_status', 'in', EXCLUDED_ORDER_STATUSES)
      .range(f, t) as never,
  )
  return rows.reduce((s, o) => s + num(o.total_amount), 0)
}

// ── Daily order totals for a closed range [from, to] ─────────────────────────

export async function getOrderDailyTotals(
  admin: Admin,
  from: string,
  to: string,
): Promise<Map<string, number>> {
  const { data, error } = await (admin as unknown as RpcCallable)
    .rpc('order_daily_totals', { p_from: from, p_to: to })

  const map = new Map<string, number>()
  if (!error && data) {
    for (const r of data as { day: string; total: string | number }[]) {
      map.set(String(r.day).slice(0, 10), num(r.total))
    }
    return map
  }

  const rows = await fetchAllPages<{ order_date: string; total_amount: string }>((f, t) =>
    admin.from('orders')
      .select('order_date, total_amount')
      .gte('order_date', from)
      .lte('order_date', to)
      .not('order_status', 'in', EXCLUDED_ORDER_STATUSES)
      .range(f, t) as never,
  )
  for (const o of rows) {
    map.set(o.order_date, (map.get(o.order_date) ?? 0) + num(o.total_amount))
  }
  return map
}
