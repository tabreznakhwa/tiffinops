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

// ── Most recent payment per customer (all-time, not scoped to any range) ─────
// Independent of the Outstanding report's date filter — a customer's last
// payment stays visible even when it falls outside whatever window is
// currently selected, since "when did they last pay" is a fact about the
// customer, not about the report's range.

export type CustomerLastPayment = {
  customer_id: string
  last_payment_date: string
  last_payment_amount: number
  last_payment_mode: string
}

type RawLastPaymentRow = {
  customer_id: string
  last_payment_date: string
  last_payment_amount: string | number
  last_payment_mode: string
}

export async function getCustomerLastPayments(admin: Admin): Promise<CustomerLastPayment[]> {
  const { data, error } = await (admin as unknown as RpcCallable).rpc('customer_last_payments')
  if (!error && data) {
    return (data as RawLastPaymentRow[]).map(r => ({
      customer_id:          r.customer_id,
      last_payment_date:    r.last_payment_date,
      last_payment_amount:  num(r.last_payment_amount),
      last_payment_mode:    r.last_payment_mode,
    }))
  }

  // Fallback: page through every payment and keep the latest per customer
  // (run migration 033 to avoid this on large payment tables).
  const rows = await fetchAllPages<{
    customer_id: string
    payment_date: string
    amount: string
    mode: string
    created_at: string
  }>((f, t) =>
    admin.from('payments')
      .select('customer_id, payment_date, amount, mode, created_at')
      .is('voided_at', null)
      .range(f, t) as never,
  )
  const map = new Map<string, CustomerLastPayment & { created_at: string }>()
  for (const p of rows) {
    if (!p.customer_id) continue
    const existing = map.get(p.customer_id)
    const isNewer = !existing
      || p.payment_date > existing.last_payment_date
      || (p.payment_date === existing.last_payment_date && p.created_at > existing.created_at)
    if (isNewer) {
      map.set(p.customer_id, {
        customer_id: p.customer_id,
        last_payment_date: p.payment_date,
        last_payment_amount: num(p.amount),
        last_payment_mode: p.mode,
        created_at: p.created_at,
      })
    }
  }
  return [...map.values()]
}

// ── Oldest unpaid order date per customer (FIFO) ─────────────────────────────
// "How long has their balance been outstanding" — payments cover the earliest
// orders first, so outstanding_since is the first order that hasn't been fully
// paid down. Fully-paid customers return no row.

export type CustomerOutstandingSince = {
  customer_id: string
  outstanding_since: string
}

type RawOutstandingSinceRow = {
  customer_id: string
  outstanding_since: string
}

export async function getCustomerOutstandingSince(admin: Admin): Promise<CustomerOutstandingSince[]> {
  const { data, error } = await (admin as unknown as RpcCallable).rpc('customer_outstanding_since')
  if (!error && data) {
    return (data as RawOutstandingSinceRow[]).map(r => ({
      customer_id:        r.customer_id,
      outstanding_since:  r.outstanding_since,
    }))
  }

  // Fallback: FIFO match in JS (run migration 034 to avoid this).
  const [orders, payments] = await Promise.all([
    fetchAllPages<{ customer_id: string | null; order_date: string; total_amount: string }>((f, t) =>
      admin.from('orders')
        .select('customer_id, order_date, total_amount')
        .eq('is_credit', true)
        .not('order_status', 'in', EXCLUDED_ORDER_STATUSES)
        .range(f, t) as never,
    ),
    fetchAllPages<{ customer_id: string; amount: string }>((f, t) =>
      admin.from('payments')
        .select('customer_id, amount')
        .is('voided_at', null)
        .range(f, t) as never,
    ),
  ])

  const paidByCustomer = new Map<string, number>()
  for (const p of payments) {
    if (!p.customer_id) continue
    paidByCustomer.set(p.customer_id, (paidByCustomer.get(p.customer_id) ?? 0) + num(p.amount))
  }

  const byCustomer = new Map<string, { date: string; amount: number }[]>()
  for (const o of orders) {
    if (!o.customer_id) continue
    const list = byCustomer.get(o.customer_id) ?? []
    list.push({ date: o.order_date, amount: num(o.total_amount) })
    byCustomer.set(o.customer_id, list)
  }

  const out: CustomerOutstandingSince[] = []
  for (const [customerId, list] of byCustomer) {
    const paid = paidByCustomer.get(customerId) ?? 0
    list.sort((a, b) => a.date.localeCompare(b.date) || a.amount - b.amount)
    let cum = 0
    for (const d of list) {
      cum += d.amount
      if (paid < cum) {
        out.push({ customer_id: customerId, outstanding_since: d.date })
        break
      }
    }
  }
  return out
}

// ── Oldest unpaid invoice due date per customer ──────────────────────────────
// The aging anchor for subscription-only debt (fixed_monthly bills), which the
// order FIFO above can't see. Returns min(due_date) across unpaid invoices.

export type CustomerOldestUnpaidInvoice = {
  customer_id: string
  oldest_due_date: string
}

type RawOldestInvoiceRow = {
  customer_id: string
  oldest_due_date: string
}

export async function getCustomerOldestUnpaidInvoice(admin: Admin): Promise<CustomerOldestUnpaidInvoice[]> {
  const { data, error } = await (admin as unknown as RpcCallable).rpc('customer_oldest_unpaid_invoice')
  if (!error && data) {
    return (data as RawOldestInvoiceRow[]).map(r => ({
      customer_id:     r.customer_id,
      oldest_due_date: r.oldest_due_date,
    }))
  }

  // Fallback: page through unpaid invoices (run migration 034 to avoid this).
  const rows = await fetchAllPages<{ customer_id: string; due_date: string }>((f, t) =>
    admin.from('invoices')
      .select('customer_id, due_date')
      .in('status', ['issued', 'overdue', 'partial'])
      .range(f, t) as never,
  )
  const map = new Map<string, string>()
  for (const i of rows) {
    if (!i.customer_id) continue
    const existing = map.get(i.customer_id)
    if (!existing || i.due_date < existing) map.set(i.customer_id, i.due_date)
  }
  return [...map.entries()].map(([customer_id, oldest_due_date]) => ({ customer_id, oldest_due_date }))
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
