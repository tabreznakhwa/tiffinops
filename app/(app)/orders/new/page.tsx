export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { formatInTimeZone } from 'date-fns-tz'
import { requireAuth } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { NewOrderForm } from '@/components/orders/new-order-form'
import type { Enums } from '@/lib/supabase/types'

type MealPeriod = Enums<'meal_period'>

export default async function NewOrderPage({
  searchParams,
}: {
  searchParams: Promise<{ customer_id?: string }>
}) {
  await requireAuth()

  const { customer_id } = await searchParams
  const admin = createAdminClient()

  const [{ data: customers }, { data: menuItems }] = await Promise.all([
    admin
      .from('customers')
      .select('*')
      .in('status', ['active', 'paused'])
      .order('full_name'),
    admin
      .from('menu_items')
      .select('*')
      .eq('is_available', true)
      .order('name'),
  ])

  const preselectedCustomer =
    customer_id && customers
      ? (customers.find((c) => c.id === customer_id) ?? null)
      : null

  const now = new Date()
  const todayDubai = formatInTimeZone(now, 'Asia/Dubai', 'yyyy-MM-dd')
  const currentHour = parseInt(formatInTimeZone(now, 'Asia/Dubai', 'H'), 10)
  const defaultMealPeriod: MealPeriod =
    currentHour < 10 ? 'breakfast' : currentHour < 15 ? 'lunch' : 'dinner'

  return (
    <div>
      <Link
        href="/customers"
        className="inline-flex items-center gap-1.5 text-sm font-semibold mb-5 transition-opacity hover:opacity-70"
        style={{ color: 'var(--color-muted)' }}
      >
        <ArrowLeft size={15} />
        Customers
      </Link>

      <div className="mb-5">
        <p
          className="text-xs font-bold uppercase tracking-widest"
          style={{ color: 'var(--color-saffron)', letterSpacing: '.12em' }}
        >
          New Order
        </p>
        <h1
          className="font-display font-bold text-[25px] mt-0.5"
          style={{ color: 'var(--color-ink)' }}
        >
          A La Carte Entry
        </h1>
      </div>

      <NewOrderForm
        customers={customers ?? []}
        menuItems={menuItems ?? []}
        todayDubai={todayDubai}
        defaultMealPeriod={defaultMealPeriod}
        preselectedCustomer={preselectedCustomer}
      />
    </div>
  )
}
