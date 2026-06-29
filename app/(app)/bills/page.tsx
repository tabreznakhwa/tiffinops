import { formatInTimeZone } from 'date-fns-tz'
import { requireAuth } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { BillsModule } from '@/components/bills/bills-module'
import { monthToRange } from '@/lib/bills/utils'

export const dynamic = 'force-dynamic'

export default async function BillsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; from?: string; to?: string }>
}) {
  await requireAuth()

  const params = await searchParams
  const currentMonth = formatInTimeZone(new Date(), 'Asia/Dubai', 'yyyy-MM')

  const dateRe = /^\d{4}-\d{2}-\d{2}$/
  const isCustomRange = params.from && params.to && dateRe.test(params.from) && dateRe.test(params.to)

  let start: string
  let end: string
  let activeMonth: string
  let rangeFrom = ''
  let rangeTo = ''

  if (isCustomRange) {
    rangeFrom = params.from!
    rangeTo = params.to!
    start = rangeFrom
    // end is exclusive — add 1 day to 'to'
    const toDate = new Date(rangeTo + 'T00:00:00Z')
    toDate.setUTCDate(toDate.getUTCDate() + 1)
    end = toDate.toISOString().split('T')[0]
    activeMonth = currentMonth // keep for fallback navigation
  } else {
    activeMonth = params.month && /^\d{4}-\d{2}$/.test(params.month) ? params.month : currentMonth
    const range = monthToRange(activeMonth)
    start = range.start
    end = range.end
  }

  const admin = createAdminClient()

  const PAGE_SIZE = 1000
  const allOrdersRaw: { customer_id: string; total_amount: string }[] = []
  let offset = 0
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
          .range(offset, offset + PAGE_SIZE - 1)
        if (!data || data.length === 0) break
        allOrdersRaw.push(...data)
        if (data.length < PAGE_SIZE) break
        offset += PAGE_SIZE
      }
    })(),
  ])

  const customerMap = new Map((allCustomers ?? []).map(c => [c.id, c]))

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
  for (const o of allOrdersRaw) {
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
      rangeFrom={rangeFrom}
      rangeTo={rangeTo}
    />
  )
}
