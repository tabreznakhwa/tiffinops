import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
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

  const { data: rawOrders } = await admin
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

  const orders = (rawOrders ?? []) as unknown as OrderRow[]

  return (
    <div>
      {/* Back link */}
      <Link
        href="/customers"
        className="inline-flex items-center gap-1.5 text-sm font-semibold mb-5 transition-opacity hover:opacity-70"
        style={{ color: 'var(--color-muted)' }}
      >
        <ArrowLeft size={15} />
        Customers
      </Link>

      <OrdersModule
        orders={orders}
        isOwner={user.role === 'owner'}
        initialFrom={from}
        initialTo={to}
      />
    </div>
  )
}
