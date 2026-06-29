export const dynamic = 'force-dynamic'

import { requireAuth } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { FixedMenuModule } from '@/components/fixed-menu/fixed-menu-module'
import type { SubscriptionRow, CustomerSummary } from '@/components/fixed-menu/fixed-menu-module'

export default async function FixedMenuPage() {
  await requireAuth()

  const admin = createAdminClient()

  const [{ data: plans }, { data: rawSubs }, { data: customers }] = await Promise.all([
    admin
      .from('fixed_plans')
      .select('*')
      .order('plan_name'),

    admin
      .from('customer_subscriptions')
      .select(`
        id, customer_id, fixed_plan_id, start_date, end_date,
        agreed_monthly_price, status, notes, created_at,
        customers(id, full_name, customer_code, mobile_number, area, customer_type)
      `)
      .not('status', 'in', '(cancelled,completed)')
      .order('created_at', { ascending: false }),

    admin
      .from('customers')
      .select('id, full_name, customer_code, mobile_number, customer_type')
      .in('status', ['active', 'paused'])
      .order('full_name'),
  ])

  return (
    <FixedMenuModule
      plans={plans ?? []}
      subscriptions={(rawSubs ?? []) as unknown as SubscriptionRow[]}
      customers={(customers ?? []) as CustomerSummary[]}
    />
  )
}
