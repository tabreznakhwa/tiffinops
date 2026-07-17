export const dynamic = 'force-dynamic'

import { requireAuth } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSettings } from '@/lib/settings/getSettings'
import { OutstandingModule } from '@/components/outstanding/outstanding-module'
import type { CustomerBasic, OrderBasic, PaymentBasic } from '@/components/outstanding/outstanding-module'

export default async function OutstandingPage() {
  const user = await requireAuth()
  const canView = ['owner', 'manager', 'accounts'].includes(user.role)
  if (!canView) {
    return (
      <div className="flex items-center justify-center h-48">
        <p className="text-sm font-semibold" style={{ color: 'var(--color-muted)' }}>
          You don't have permission to view this report.
        </p>
      </div>
    )
  }

  const admin = createAdminClient()
  const settings = await getSettings()

  const { data: customers } = await admin
    .from('customers')
    .select('id, full_name, customer_code, customer_type, mobile_number, area, status')
    .in('status', ['active', 'paused'])
    .order('full_name', { ascending: true })

  const customerIds = (customers ?? []).map(c => c.id)

  if (customerIds.length === 0) {
    return (
      <OutstandingModule
        customers={[]}
        orders={[]}
        payments={[]}
        currency={settings.currency}
      />
    )
  }

  // Paginated fetch of all credit non-cancelled orders
  const PAGE = 1000
  const allOrders: OrderBasic[] = []
  {
    let off = 0
    while (true) {
      const { data } = await admin
        .from('orders')
        .select('customer_id, total_amount, order_date')
        .in('customer_id', customerIds)
        .eq('is_credit', true)
        .not('order_status', 'in', '(cancelled,voided,draft)')
        .range(off, off + PAGE - 1)
      if (!data || data.length === 0) break
      allOrders.push(...(data as OrderBasic[]))
      if (data.length < PAGE) break
      off += PAGE
    }
  }

  // Paginated fetch of all non-voided payments
  const allPayments: PaymentBasic[] = []
  {
    let off = 0
    while (true) {
      const { data } = await admin
        .from('payments')
        .select('customer_id, amount, payment_date')
        .in('customer_id', customerIds)
        .is('voided_at', null)
        .range(off, off + PAGE - 1)
      if (!data || data.length === 0) break
      allPayments.push(...(data as PaymentBasic[]))
      if (data.length < PAGE) break
      off += PAGE
    }
  }

  return (
    <OutstandingModule
      customers={(customers ?? []) as CustomerBasic[]}
      orders={allOrders}
      payments={allPayments}
      currency={settings.currency}
    />
  )
}
