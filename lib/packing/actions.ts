'use server'

import { revalidatePath } from 'next/cache'
import { requireAuth } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Enums } from '@/lib/supabase/types'

const PACK_ROLES: Enums<'user_role'>[] = ['owner', 'manager', 'data_entry']

const NEXT_STATUS: Partial<Record<Enums<'order_status'>, Enums<'order_status'>>> = {
  confirmed: 'preparing',
  preparing: 'out_for_delivery',
  out_for_delivery: 'delivered',
}

export async function advanceOrderStatus(orderId: string): Promise<{ error?: string }> {
  const user = await requireAuth()
  if (!PACK_ROLES.includes(user.role)) return { error: 'Insufficient permissions' }

  const admin = createAdminClient()

  const { data: order } = await admin
    .from('orders')
    .select('order_status')
    .eq('id', orderId)
    .single()

  if (!order) return { error: 'Order not found' }

  const nextStatus = NEXT_STATUS[order.order_status as Enums<'order_status'>]
  if (!nextStatus) return { error: 'Order cannot be advanced further' }

  const { error } = await admin
    .from('orders')
    .update({ order_status: nextStatus, updated_by: user.id })
    .eq('id', orderId)

  if (error) return { error: error.message }

  revalidatePath('/packing')
  return {}
}
