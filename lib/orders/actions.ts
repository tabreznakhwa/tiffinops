'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAuth } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Enums } from '@/lib/supabase/types'

const WRITE_ROLES: Enums<'user_role'>[] = ['owner', 'manager', 'data_entry']

const OrderItemSchema = z.object({
  menu_item_id: z.string().uuid(),
  item_name_snapshot: z.string().min(1),
  quantity: z.number().positive(),
  unit_price: z.coerce.string(),
})

const CreateOrderSchema = z.object({
  customer_id: z.string().uuid('Invalid customer'),
  order_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date'),
  meal_period: z.enum(['breakfast', 'lunch', 'dinner']),
  items: z.array(OrderItemSchema).min(1, 'Add at least one item'),
  discount_amount: z.string().default('0'),
  delivery_charge: z.string().default('0'),
  notes: z.string().nullable().optional(),
})

export type CreateOrderInput = z.infer<typeof CreateOrderSchema>
export type OrderActionResult = { error?: string; order_number?: string; order_id?: string }

export async function createOrder(input: CreateOrderInput): Promise<OrderActionResult> {
  const user = await requireAuth()
  if (!WRITE_ROLES.includes(user.role)) return { error: 'Insufficient permissions' }

  const parsed = CreateOrderSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Validation error' }

  const { customer_id, order_date, meal_period, items, discount_amount, delivery_charge, notes } =
    parsed.data

  const subtotal = items.reduce((s, i) => s + i.quantity * parseFloat(i.unit_price), 0)
  const discountAmt = Math.max(0, parseFloat(discount_amount) || 0)
  const deliveryAmt = Math.max(0, parseFloat(delivery_charge) || 0)
  const totalAmount = subtotal - discountAmt + deliveryAmt

  const admin = createAdminClient()

  const { data: orderNumber, error: codeErr } = await admin.rpc('next_order_number')
  if (codeErr || !orderNumber) {
    return { error: 'Could not generate order number — run 03_order_enhancements.sql in Supabase first.' }
  }

  const { data: order, error: orderErr } = await admin
    .from('orders')
    .insert({
      order_number: orderNumber as string,
      customer_id,
      order_date,
      meal_period,
      subtotal: subtotal.toFixed(2),
      discount_amount: discountAmt.toFixed(2),
      delivery_charge: deliveryAmt.toFixed(2),
      total_amount: totalAmount.toFixed(2),
      payment_status: 'unpaid',
      order_status: 'confirmed',
      is_credit: true,
      notes: notes || null,
      created_by: user.id,
    })
    .select('id')
    .single()

  if (orderErr || !order) return { error: orderErr?.message ?? 'Failed to create order' }

  const { error: itemsErr } = await admin.from('order_items').insert(
    items.map((item) => ({
      order_id: order.id,
      menu_item_id: item.menu_item_id,
      item_name_snapshot: item.item_name_snapshot,
      quantity: item.quantity.toString(),
      unit_price: item.unit_price,
      total_price: (item.quantity * parseFloat(item.unit_price)).toFixed(2),
    }))
  )

  if (itemsErr) {
    await admin.from('orders').delete().eq('id', order.id)
    return { error: itemsErr.message }
  }

  revalidatePath('/customers')
  revalidatePath(`/customers/${customer_id}`)

  return { order_number: orderNumber as string, order_id: order.id }
}

// ── Update order ───────────────────────────────────────────────────────────────

const UpdateOrderSchema = z.object({
  order_id:       z.string().uuid(),
  order_status:   z.enum(['draft', 'confirmed', 'preparing', 'out_for_delivery', 'delivered', 'cancelled']),
  payment_status: z.enum(['unpaid', 'partial', 'paid', 'refunded', 'written_off']),
  notes:          z.string().nullable().optional(),
  discount_amount: z.coerce.number().min(0).default(0),
  delivery_charge: z.coerce.number().min(0).default(0),
})

export type UpdateOrderInput = z.infer<typeof UpdateOrderSchema>
export type UpdateOrderResult = { error?: string }

export async function updateOrder(input: UpdateOrderInput): Promise<UpdateOrderResult> {
  const user = await requireAuth()
  if (!WRITE_ROLES.includes(user.role)) return { error: 'Insufficient permissions' }

  const parsed = UpdateOrderSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Validation error' }

  const { order_id, order_status, payment_status, notes, discount_amount, delivery_charge } = parsed.data

  const admin = createAdminClient()

  const { data: order, error: fetchErr } = await admin
    .from('orders')
    .select('subtotal, customer_id')
    .eq('id', order_id)
    .single()

  if (fetchErr || !order) return { error: 'Order not found' }

  const subtotal    = parseFloat(String(order.subtotal))
  const totalAmount = subtotal - discount_amount + delivery_charge

  const { error: updateErr } = await admin
    .from('orders')
    .update({
      order_status,
      payment_status,
      notes:           notes || null,
      discount_amount: discount_amount.toFixed(2),
      delivery_charge: delivery_charge.toFixed(2),
      total_amount:    totalAmount.toFixed(2),
    })
    .eq('id', order_id)

  if (updateErr) return { error: updateErr.message }

  revalidatePath('/orders')
  revalidatePath(`/customers/${order.customer_id}`)

  return {}
}
