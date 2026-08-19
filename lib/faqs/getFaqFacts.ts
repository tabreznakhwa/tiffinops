// Read-only helper, deliberately not 'use server' — mirrors
// lib/settings/getSettings.ts, the only other cross-module read helper called
// directly from app/api/whatsapp/inbound/route.ts.

import type { createAdminClient } from '@/lib/supabase/admin'

type Admin = ReturnType<typeof createAdminClient>

/** Active facts, in display/prompt order. Empty array if none configured (or migrations/039 not run yet). */
export async function getActiveFaqFacts(admin: Admin): Promise<string[]> {
  const { data } = await admin
    .from('faq_facts')
    .select('fact')
    .eq('is_active', true)
    .order('sort_order')
    .order('created_at')
  return (data ?? []).map(r => r.fact)
}
