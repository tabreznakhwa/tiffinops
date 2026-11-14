export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { ArrowLeft, ClipboardPaste } from 'lucide-react'
import { formatInTimeZone } from 'date-fns-tz'
import { requireAuth } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { OrdersModule } from '@/components/orders/orders-module'
import type { OrderRow } from '@/components/orders/orders-module'

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{
    from?: string
    to?: string
    search?: string
    period?: string
  }>
}) {
  const user = await requireAuth()
  const params = await searchParams

  const now = new Date()
  const todayDubai   = formatInTimeZone(now, 'Asia/Dubai', 'yyyy-MM-dd')
  const monthStr     = formatInTimeZone(now, 'Asia/Dubai', 'yyyy-MM')
  const monthStart   = `${monthStr}-01`

  const from = params.from ?? monthStart
  const to   = params.to   ?? todayDubai

  const admin = createAdminClient()

  // Fetch and page only the parent orders first. Embedding the one-to-many
  // order_items relationship makes PostgREST apply its response row cap to the
  // expanded result, so a busy month can stop after exactly 1,000 displayed
  // orders even though more matching orders exist.
  type OrderBase = Omit<OrderRow, 'customers' | 'order_items'>
  const PAGE = 1000
  const orderBases: OrderBase[] = []
  let offset = 0
  while (true) {
    const { data, error } = await admin
      .from('orders')
      .select(`
        id,
        order_number,
        customer_id,
        order_date,
        meal_period,
        subtotal,
        discount_amount,
        delivery_charge,
        total_amount,
        order_status,
        payment_status,
        voided_at,
        void_reason,
        notes
      `)
      .gte('order_date', from)
      .lte('order_date', to)
      .order('order_date', { ascending: false })
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + PAGE - 1)
    if (error) throw new Error(`Could not load orders: ${error.message}`)
    const batch = (data ?? []) as unknown as OrderBase[]
    orderBases.push(...batch)
    if (batch.length < PAGE) break
    offset += PAGE
  }

  // Load related rows separately in bounded batches, then attach them to their
  // parent order. This avoids both the 1,000-row embedded-result cap and overly
  // long PostgREST URLs.
  type CustomerSummary = { id: string; full_name: string; customer_code: string }
  type ItemSummary = { order_id: string; item_name_snapshot: string; quantity: string }
  const customerById = new Map<string, CustomerSummary>()
  const itemsByOrder = new Map<string, ItemSummary[]>()
  const ID_BATCH = 200

  const customerIds = [...new Set(orderBases.map(order => order.customer_id))]
  for (let i = 0; i < customerIds.length; i += ID_BATCH) {
    const { data, error } = await admin
      .from('customers')
      .select('id, full_name, customer_code')
      .in('id', customerIds.slice(i, i + ID_BATCH))
    if (error) throw new Error(`Could not load order customers: ${error.message}`)
    for (const customer of (data ?? []) as CustomerSummary[]) customerById.set(customer.id, customer)
  }

  for (let i = 0; i < orderBases.length; i += ID_BATCH) {
    const orderIds = orderBases.slice(i, i + ID_BATCH).map(order => order.id)
    let itemOffset = 0
    while (true) {
      const { data, error } = await admin
        .from('order_items')
        .select('id, order_id, item_name_snapshot, quantity')
        .in('order_id', orderIds)
        .order('id')
        .range(itemOffset, itemOffset + PAGE - 1)
      if (error) throw new Error(`Could not load order items: ${error.message}`)
      const itemBatch = (data ?? []) as ItemSummary[]
      for (const item of itemBatch) {
        const list = itemsByOrder.get(item.order_id)
        if (list) list.push(item)
        else itemsByOrder.set(item.order_id, [item])
      }
      if (itemBatch.length < PAGE) break
      itemOffset += PAGE
    }
  }

  const orders: OrderRow[] = orderBases.map(order => ({
    ...order,
    customers: customerById.get(order.customer_id) ?? null,
    order_items: itemsByOrder.get(order.id) ?? [],
  }))

  return (
    <div>
      {/* Back link + WhatsApp import */}
      <div className="flex items-center justify-between gap-3 mb-5">
        <Link
          href="/customers"
          className="inline-flex items-center gap-1.5 text-sm font-semibold transition-opacity hover:opacity-70"
          style={{ color: 'var(--color-muted)' }}
        >
          <ArrowLeft size={15} />
          Customers
        </Link>
        {['owner', 'manager', 'data_entry'].includes(user.role) && (
          <Link
            href="/orders/paste"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-[10px] text-sm font-bold transition-opacity"
            style={{ background: '#1A6B6B', color: '#fff' }}
          >
            <ClipboardPaste size={14} />
            Import from WhatsApp
          </Link>
        )}
      </div>

      <OrdersModule
        // Force a full remount on every date-range navigation — otherwise the
        // table can be left showing a stale render from the previous range
        // (e.g. Apply to a new date still showing the old range's rows)
        // if the client router doesn't cleanly replace this subtree.
        key={`${from}-${to}`}
        orders={orders}
        isOwner={user.role === 'owner'}
        initialFrom={from}
        initialTo={to}
      />
    </div>
  )
}
