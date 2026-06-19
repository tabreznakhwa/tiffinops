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
  searchParams: Promise<{ month?: string }>
}) {
  await requireAuth()

  const { customer_id } = await params
  const { month } = await searchParams

  const currentMonth = formatInTimeZone(new Date(), 'Asia/Dubai', 'yyyy-MM')
  const activeMonth = month && /^\d{4}-\d{2}$/.test(month) ? month : currentMonth

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
      .gte('order_date', monthToRange(activeMonth).start)
      .lt('order_date', monthToRange(activeMonth).end)
      .not('order_status', 'in', '(cancelled,voided,draft)')
      .eq('is_credit', true)
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
    />
  )
}
