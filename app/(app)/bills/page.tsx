import { formatInTimeZone } from 'date-fns-tz'
import { requireAuth } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { BillsModule } from '@/components/bills/bills-module'
import { monthToRange } from '@/lib/bills/utils'

export const dynamic = 'force-dynamic'

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

  // Fetch customers and paginate through orders (Supabase caps at 1000 rows/request)
  const PAGE_SIZE = 1000
  const allOrdersRaw: { customer_id: string; total_amount: string }[] = []
  let from = 0
  const [{ data: allCustomers }] = await Promise.all([
    admin.from('customers').select('id, full_name, customer_code, customer_type, mobile_number, area'),
    (async () => {
      while (true) {
        const { data } = await admin
          .from('orders')
          .select('customer_id, total_amount')
          .gte('order_date', start)
          .lt('order_date', end)
          .not('order_status', 'in', '(cancelled,voided,draft)')
          .range(from, from + PAGE_SIZE - 1)
        if (!data || data.length === 0) break
        allOrdersRaw.push(...data)
        if (data.length < PAGE_SIZE) break
        from += PAGE_SIZE
      }
    })(),
  ])
  const orders = allOrdersRaw

  // Build a lookup map of ALL customers
  const customerMap = new Map((allCustomers ?? []).map(c => [c.id, c]))

  // Aggregate orders per customer
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
    if (!o.customer_id) continue
    const c = customerMap.get(o.customer_id)
    if (!c) continue
    if (!map.has(o.customer_id)) {
      map.set(o.customer_id, {
        customerId: o.customer_id,
        fullName: c.full_name,
        customerCode: c.customer_code,
        customerType: c.customer_type,
        mobileNumber: c.mobile_number ?? '',
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
