export const dynamic = 'force-dynamic'

import { requireAuth } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { FaqsModule } from '@/components/faqs/faqs-module'

// These facts are quoted verbatim to customers by the WhatsApp agent — owner
// only, matching the faq_facts_write RLS policy (migrations/039_faq_facts.sql).
const WRITE_ROLES = ['owner']

export default async function FaqsPage() {
  const user = await requireAuth()
  const admin = createAdminClient()

  const { data: facts } = await admin
    .from('faq_facts')
    .select('*')
    .order('sort_order')
    .order('created_at')

  return (
    <FaqsModule
      facts={facts ?? []}
      canWrite={WRITE_ROLES.includes(user.role)}
    />
  )
}
