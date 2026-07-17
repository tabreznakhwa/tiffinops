export const dynamic = 'force-dynamic'

import { formatInTimeZone } from 'date-fns-tz'
import { requireAuth } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { PaymentsModule } from '@/components/payments/payments-module'
import type { PaymentRow, CustomerForModal } from '@/components/payments/payments-module'

export default async function PaymentsPage() {
  const user = await requireAuth()

  const now       = new Date()
  const todayStr  = formatInTimeZone(now, 'Asia/Dubai', 'yyyy-MM-dd')
  const monthStr  = formatInTimeZone(now, 'Asia/Dubai', 'yyyy-MM')
  const monthStart = `${monthStr}-01`
  // Exclusive upper bound for month filter (handles December → January correctly)
  const [y, m] = monthStr.split('-').map(Number)
  const monthEnd = new Date(y, m, 1).toISOString().split('T')[0] // JS months are 0-indexed, so m=12 wraps to Jan

  const admin = createAdminClient()

  const [{ data: rawPayments }, { data: customers }] = await Promise.all([
    admin
      .from('payments')
      .select(`
        id, payment_number, customer_id, payment_date, amount,
        mode, reference_number, notes, is_advance, voided_at, void_reason,
        customers(id, full_name, customer_code, mobile_number, area)
      `)
      .order('payment_date', { ascending: false })
      .order('created_at', { ascending: false }),

    admin
      .from('customers')
      .select('id, full_name, customer_code, mobile_number, area')
      .in('status', ['active', 'paused'])
      .order('full_name'),
  ])

  const payments = (rawPayments ?? []) as unknown as PaymentRow[]

  // Compute summary totals server-side (non-voided only)
  const nonVoided = payments.filter(p => !p.voided_at)

  const todayTotal = nonVoided
    .filter(p => p.payment_date === todayStr)
    .reduce((s, p) => s + parseFloat(String(p.amount)), 0)

  const monthTotal = nonVoided
    .filter(p => p.payment_date >= monthStart && p.payment_date < monthEnd)
    .reduce((s, p) => s + parseFloat(String(p.amount)), 0)

  return (
    <PaymentsModule
      payments={payments}
      customers={(customers ?? []) as CustomerForModal[]}
      todayTotal={todayTotal}
      monthTotal={monthTotal}
      isOwner={user.role === 'owner'}
    />
  )
}
