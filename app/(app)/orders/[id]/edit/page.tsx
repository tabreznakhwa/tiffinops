import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { notFound, redirect } from 'next/navigation'
import { requireAuth } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { EditOrderForm } from '@/components/orders/edit-order-form'
import type { EditableOrder } from '@/components/orders/edit-order-form'

export default async function EditOrderPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  await requireAuth()

  const admin = createAdminClient()

  const { data: order, error } = await admin
    .from('orders')
    .select(`
      id,
      order_number,
      customer_id,
      order_date,
      meal_period,
      discount_amount,
      delivery_charge,
      notes,
      order_status,
      payment_status,
      order_items (
        menu_item_id,
        item_name_snapshot,
        quantity,
        unit_price
      )
    `)
    .eq('id', id)
    .single()

  if (error || !order) notFound()
  if (order.order_status === 'voided') redirect('/orders')

  const [{ data: customers }, { data: menuItems }] = await Promise.all([
    admin
      .from('customers')
      .select('*')
      .in('status', ['active', 'paused'])
      .order('full_name'),
    admin
      .from('menu_items')
      .select('*')
      .order('meal_period')
      .order('name'),
  ])

  return (
    <div>
      <Link
        href="/orders"
        className="inline-flex items-center gap-1.5 text-sm font-semibold mb-5 transition-opacity hover:opacity-70"
        style={{ color: 'var(--color-muted)' }}
      >
        <ArrowLeft size={15} />
        Orders
      </Link>

      <div className="mb-5">
        <p
          className="text-xs font-bold uppercase tracking-widest"
          style={{ color: 'var(--color-saffron)', letterSpacing: '.12em' }}
        >
          Edit Order
        </p>
        <h1
          className="font-display font-bold text-[25px] mt-0.5"
          style={{ color: 'var(--color-ink)' }}
        >
          {order.order_number}
        </h1>
      </div>

      <EditOrderForm
        order={order as unknown as EditableOrder}
        customers={customers ?? []}
        menuItems={menuItems ?? []}
      />
    </div>
  )
}
