export const dynamic = 'force-dynamic'

import { formatInTimeZone } from 'date-fns-tz'
import { redirect } from 'next/navigation'
import { requireAuth } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { AuditModule } from '@/components/audit/audit-module'
import type { AuditLog } from '@/components/audit/audit-module'

export default async function AuditTrailPage({
  searchParams,
}: {
  searchParams: Promise<{ table?: string; action?: string; from?: string; to?: string }>
}) {
  const user = await requireAuth()
  if (user.role !== 'owner') redirect('/')

  const { table: tableFilter, action: actionFilter, from: qFrom, to: qTo } = await searchParams

  // Default date range: last 30 days in Dubai timezone
  const todayStr = formatInTimeZone(new Date(), 'Asia/Dubai', 'yyyy-MM-dd')
  const thirtyDaysAgo = formatInTimeZone(
    new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    'Asia/Dubai',
    'yyyy-MM-dd',
  )

  const from = qFrom || thirtyDaysAgo
  const to   = qTo   || todayStr

  const admin = createAdminClient()

  let query = admin
    .from('audit_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200)

  if (tableFilter) query = query.eq('table_name', tableFilter)
  if (actionFilter) query = query.eq('action', actionFilter)
  if (from) query = query.gte('created_at', from + 'T00:00:00+04:00')
  if (to)   query = query.lte('created_at', to   + 'T23:59:59+04:00')

  const [{ data: logs }, { data: users }] = await Promise.all([
    query,
    admin.from('users').select('id, full_name, email').order('full_name'),
  ])

  return (
    <AuditModule
      logs={(logs ?? []) as unknown as AuditLog[]}
      users={users ?? []}
      filters={{ table: tableFilter, action: actionFilter, from, to }}
    />
  )
}
