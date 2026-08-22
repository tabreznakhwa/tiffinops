export const dynamic = 'force-dynamic'

import { formatInTimeZone } from 'date-fns-tz'
import { requireAuth } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { ConsumptionModule } from '@/components/inventory/consumption-module'
import type { ConsumptionRow } from '@/components/inventory/consumption-module'

const TXN_ROLES = ['owner', 'manager', 'data_entry']

export default async function ConsumptionPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>
}) {
  const user = await requireAuth()
  const params = await searchParams
  const todayDubai = formatInTimeZone(new Date(), 'Asia/Dubai', 'yyyy-MM-dd')
  const date = params.date ?? todayDubai

  const admin = createAdminClient()

  const [{ data: items }, { data: entries }] = await Promise.all([
    admin.from('inventory_items').select('*').eq('is_active', true).order('name'),
    admin
      .from('inventory_transactions')
      .select('id, quantity, notes, created_at, inventory_items ( name, unit_of_measure )')
      .eq('transaction_type', 'consumption')
      .eq('transaction_date', date)
      .order('created_at', { ascending: false }),
  ])

  return (
    <ConsumptionModule
      items={items ?? []}
      entries={(entries ?? []) as unknown as ConsumptionRow[]}
      date={date}
      canWrite={TXN_ROLES.includes(user.role)}
      isOwner={user.role === 'owner'}
    />
  )
}
