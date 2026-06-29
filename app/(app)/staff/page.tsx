export const dynamic = 'force-dynamic'

import { requireRole } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { StaffModule } from '@/components/staff/staff-module'

export default async function StaffPage() {
  await requireRole(['owner'])

  let users: Awaited<ReturnType<typeof fetchUsers>> = []
  try {
    users = await fetchUsers()
  } catch (err) {
    console.error('[StaffPage] users query failed:', err)
  }

  return <StaffModule users={users} />
}

async function fetchUsers() {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('users')
    .select('*')
    .order('created_at', { ascending: true })
  if (error) {
    console.error('[StaffPage] supabase error:', error)
    return []
  }
  return data ?? []
}
