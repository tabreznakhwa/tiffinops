export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import { formatInTimeZone } from 'date-fns-tz'
import { requireAuth } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { CustomerBill } from '@/components/bills/customer-bill'
import { monthToRange } from '@/lib/bills/utils'

export default async function CustomerBillPage({
  params,
  searchParams,
}: {
  params: Promise<{ customer_id: string }>
  searchParams: Promise<{ month?: string; from?: string; to?: string }>
}) {
  await requireAuth()

  const { customer_id } = await params
  const sp = await searchParams

  const currentMonth = formatInTimeZone(new Date(), 'Asia/Dubai', 'yyyy-MM')

  const dateRe = /^\d{4}-\d{2}-\d{2}$/
  const isCustomRange = sp.from && sp.to && dateRe.test(sp.from) && dateRe.test(sp.to)

  let start: string
  let end: string
  let activeMonth: string
  let rangeFrom = ''
  let rangeTo = ''

  if (isCustomRange) {
    rangeFrom = sp.from!
    rangeTo = sp.to!
    start = rangeFrom
    const toDate = new Date(rangeTo + 'T00:00:00Z')
    toDate.setUTCDate(toDate.getUTCDate() + 1)
    end = toDate.toISOString().split('T')[0]
    activeMonth = currentMonth
  } else {
    activeMonth = sp.month && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : currentMonth
    const range = monthToRange(activeMonth)
    start = range.start
    end = range.end
  }

  const admin = createAdminClient()

  const [{ data: customer }, { data: orders }] = await Promise.all([
    admin.from('customers').select('*').eq('id', customer_id).single(),
    admin
      .from('orders')
      .select(`
        id,
        order_number,
        order_date,
        meal_period,
        subtotal,
        discount_amount,
        delivery_charge,
        total_amount,
        notes,
        order_items(id, item_name_snapshot, quantity, unit_price, total_price)
      `)
      .eq('customer_id', customer_id)
      .gte('order_date', start)
      .lt('order_date', end)
      .not('order_status', 'in', '(cancelled,voided,draft)')
      .order('order_date', { ascending: true })
      .order('created_at', { ascending: true }),
  ])

  if (!customer) notFound()

  return (
    <CustomerBill
      customer={customer}
      orders={(orders ?? []) as any}
      activeMonth={activeMonth}
      currentMonth={currentMonth}
      rangeFrom={rangeFrom}
      rangeTo={rangeTo}
    />
  )
}
