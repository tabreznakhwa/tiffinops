export const dynamic = 'force-dynamic'

import { requireAuth } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { MenuModule } from '@/components/menu/menu-module'

const WRITE_ROLES = ['owner', 'manager', 'data_entry']

export default async function MenuPage() {
  const user = await requireAuth()
  const admin = createAdminClient()

  const { data: items } = await admin
    .from('menu_items')
    .select('*')
    .order('name')

  return (
    <MenuModule
      items={items ?? []}
      canWrite={WRITE_ROLES.includes(user.role)}
    />
  )
}
