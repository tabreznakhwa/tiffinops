export const dynamic = 'force-dynamic'

import { requireAuth } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { SupplierModule } from '@/components/inventory/supplier-module'

const MASTER_ROLES = ['owner', 'manager']

export default async function SuppliersPage() {
  const user = await requireAuth()
  const admin = createAdminClient()

  const { data: suppliers } = await admin
    .from('suppliers')
    .select('*')
    .order('name')

  return (
    <SupplierModule
      suppliers={suppliers ?? []}
      canWrite={MASTER_ROLES.includes(user.role)}
    />
  )
}
