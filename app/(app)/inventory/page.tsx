export const dynamic = 'force-dynamic'

import { formatInTimeZone } from 'date-fns-tz'
import { requireAuth } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { InventoryModule } from '@/components/inventory/inventory-module'

const MASTER_ROLES = ['owner', 'manager']
const TXN_ROLES = ['owner', 'manager', 'data_entry']

export default async function InventoryPage() {
  const user = await requireAuth()
  const admin = createAdminClient()

  const monthStart = `${formatInTimeZone(new Date(), 'Asia/Dubai', 'yyyy-MM')}-01`

  const [{ data: items }, { data: monthPurchases }, { data: monthTxns }] = await Promise.all([
    admin.from('inventory_items').select('*').order('name'),
    admin
      .from('purchases')
      .select('total_amount, voided_at')
      .gte('purchase_date', monthStart),
    admin
      .from('inventory_transactions')
      .select('transaction_type, total_value')
      .gte('transaction_date', monthStart)
      .in('transaction_type', ['consumption', 'damaged']),
  ])

  const purchasesMonth = (monthPurchases ?? [])
    .filter(p => !p.voided_at)
    .reduce((s, p) => s + parseFloat(p.total_amount), 0)
  let consumptionMonth = 0
  let wastageMonth = 0
  for (const t of monthTxns ?? []) {
    const v = t.total_value != null ? parseFloat(t.total_value) : 0
    if (t.transaction_type === 'consumption') consumptionMonth += v
    else wastageMonth += v
  }

  return (
    <InventoryModule
      items={items ?? []}
      canManageItems={MASTER_ROLES.includes(user.role)}
      canRecordTxns={TXN_ROLES.includes(user.role)}
      stats={{
        purchasesMonth,
        consumptionMonth,
        wastageMonth,
      }}
    />
  )
}
