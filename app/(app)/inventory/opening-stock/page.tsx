export const dynamic = 'force-dynamic'

import { requireRole } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { OpeningStockModule } from '@/components/inventory/opening-stock-module'
import type { Enums } from '@/lib/supabase/types'

const TXN_ROLES: Enums<'user_role'>[] = ['owner', 'manager', 'data_entry']

export default async function OpeningStockPage() {
  await requireRole(TXN_ROLES)

  const admin = createAdminClient()
  const { data: items } = await admin
    .from('inventory_items')
    .select('*')
    .eq('is_active', true)
    .order('name')

  return <OpeningStockModule items={items ?? []} />
}
