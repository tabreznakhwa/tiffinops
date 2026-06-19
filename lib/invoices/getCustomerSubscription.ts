'use server'

import { createAdminClient } from '@/lib/supabase/admin'

export type SubscriptionInfo = {
  plan_name: string
  agreed_monthly_price: string
}

export async function getCustomerSubscription(
  customer_id: string
): Promise<SubscriptionInfo | null> {
  if (!customer_id) return null

  const admin = createAdminClient()

  const { data, error } = await admin
    .from('customer_subscriptions')
    .select('agreed_monthly_price, fixed_plans(plan_name)')
    .eq('customer_id', customer_id)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (error || !data) return null

  type JoinedSub = {
    agreed_monthly_price: string
    fixed_plans: { plan_name: string } | null
  }

  const row = data as unknown as JoinedSub
  const plan_name = row.fixed_plans?.plan_name ?? 'Fixed Plan'

  return {
    plan_name,
    agreed_monthly_price: row.agreed_monthly_price,
  }
}
