import { requireRole } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { StaffModule } from '@/components/staff/staff-module'

export default async function StaffPage() {
  await requireRole(['owner'])
  const admin = createAdminClient()

  const { data: users } = await admin
    .from('users')
    .select('*')
    .order('created_at', { ascending: true })

  return <StaffModule users={users ?? []} />
}
