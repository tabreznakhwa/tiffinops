export const dynamic = 'force-dynamic'

import { requireAuth } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { InventoryModule } from '@/components/inventory/inventory-module'

const MASTER_ROLES = ['owner', 'manager']
const TXN_ROLES = ['owner', 'manager', 'data_entry']

export default async function InventoryPage() {
  const user = await requireAuth()
  const admin = createAdminClient()

  const { data: items } = await admin
    .from('inventory_items')
    .select('*')
    .order('name')

  return (
    <InventoryModule
      items={items ?? []}
      canManageItems={MASTER_ROLES.includes(user.role)}
      canRecordTxns={TXN_ROLES.includes(user.role)}
    />
  )
}
