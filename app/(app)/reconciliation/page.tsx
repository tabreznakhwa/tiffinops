export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { requireAuth } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { computeSurplusCandidates } from '@/lib/invoices/reconcileSurplus'
import { ReconciliationModule } from '@/components/reconciliation/reconciliation-module'

export default async function ReconciliationPage() {
  const user = await requireAuth()
  if (user.role !== 'owner') redirect('/')

  const admin = createAdminClient()
  const candidates = await computeSurplusCandidates(admin)

  return <ReconciliationModule candidates={candidates} />
}
