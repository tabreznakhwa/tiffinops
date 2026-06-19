import { formatInTimeZone } from 'date-fns-tz'
import { requireAuth } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { BillsModule } from '@/components/bills/bills-module'
import { monthToRange } from '@/lib/bills/utils'

export default async function BillsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>
}) {
  await requireAuth()

  const { month } = await searchParams
  const currentMonth = formatInTimeZone(new Date(), 'Asia/Dubai', 'yyyy-MM')
  const activeMonth = month && /^\d{4}-\d{2}$/.test(month) ? month : currentMonth

  const { start, end } = monthToRange(activeMonth)
  const admin = createAdminClient()

  // Fetch all credit orders for the month with customer info
  const { data: orders } = await admin
    .from('orders')
    .select('customer_id, total_amount, customers(id, full_name, customer_code, customer_type, mobile_number, area)')
    .gte('order_date', start)
    .lt('order_date', end)
    .not('order_status', 'in', '(cancelled,voided,draft)')
    .eq('is_credit', true)

  // Aggregate per customer in JS
  type BillRow = {
    customerId: string
    fullName: string
    customerCode: string
    customerType: string
    mobileNumber: string
    area: string | null
    orderCount: number
    total: number
  }

  const map = new Map<string, BillRow>()
  for (const o of orders ?? []) {
    const c = o.customers as {
      id: string; full_name: string; customer_code: string
      customer_type: string; mobile_number: string; area: string | null
    } | null
    if (!c) continue
    if (!map.has(o.customer_id)) {
      map.set(o.customer_id, {
        customerId: o.customer_id,
        fullName: c.full_name,
        customerCode: c.customer_code,
        customerType: c.customer_type,
        mobileNumber: c.mobile_number,
        area: c.area,
        orderCount: 0,
        total: 0,
      })
    }
    const row = map.get(o.customer_id)!
    row.orderCount++
    row.total += parseFloat(String(o.total_amount))
  }

  const bills = Array.from(map.values()).sort((a, b) => b.total - a.total)

  return (
    <BillsModule
      bills={bills}
      activeMonth={activeMonth}
      currentMonth={currentMonth}
    />
  )
}
