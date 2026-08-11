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

  // Paged — a busy month can exceed the 1,000-row cap, which used to silently
  // drop the oldest orders in the range.
  const PAGE = 1000
  const orders: OrderRow[] = []
  let offset = 0
  while (true) {
    const { data } = await admin
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
        notes,
        customers (
          full_name,
          customer_code
        ),
        order_items (
          item_name_snapshot,
          quantity
        )
      `)
      .gte('order_date', from)
      .lte('order_date', to)
      .order('order_date', { ascending: false })
      .order('created_at', { ascending: false })
      .range(offset, offset + PAGE - 1)
    const batch = (data ?? []) as unknown as OrderRow[]
    orders.push(...batch)
    if (batch.length < PAGE) break
    offset += PAGE
  }

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
        orders={orders}
        isOwner={user.role === 'owner'}
        initialFrom={from}
        initialTo={to}
      />
    </div>
  )
}
