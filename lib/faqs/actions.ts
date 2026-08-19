'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAuth } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Enums } from '@/lib/supabase/types'

// These facts are quoted verbatim to customers by the WhatsApp agent — owner
// only, same tier as app_settings, matching the faq_facts_write RLS policy.
const WRITE_ROLES: Enums<'user_role'>[] = ['owner']

export type FaqActionResult = { error?: string }

const FactSchema = z.object({
  fact: z.string().min(1, 'Fact is required').transform(v => v.trim()),
  sort_order: z
    .string()
    .optional()
    .transform(v => (v && v.trim() ? v.trim() : '0'))
    .refine(v => !isNaN(parseInt(v, 10)), 'Enter a valid order number')
    .transform(v => parseInt(v, 10)),
})

function formToRaw(formData: FormData): Record<string, string> {
  return Object.fromEntries([...formData.entries()].map(([k, v]) => [k, v.toString()]))
}

export async function createFaqFact(formData: FormData): Promise<FaqActionResult> {
  const user = await requireAuth()
  if (!WRITE_ROLES.includes(user.role)) return { error: 'Only the owner can manage FAQ facts' }

  const parsed = FactSchema.safeParse(formToRaw(formData))
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Validation error' }

  const admin = createAdminClient()
  const { error } = await admin.from('faq_facts').insert({ ...parsed.data, created_by: user.id })
  if (error) return { error: error.message }

  revalidatePath('/faqs')
  return {}
}

export async function updateFaqFact(id: string, formData: FormData): Promise<FaqActionResult> {
  const user = await requireAuth()
  if (!WRITE_ROLES.includes(user.role)) return { error: 'Only the owner can manage FAQ facts' }

  const parsed = FactSchema.safeParse(formToRaw(formData))
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Validation error' }

  const admin = createAdminClient()
  const { error } = await admin.from('faq_facts').update(parsed.data).eq('id', id)
  if (error) return { error: error.message }

  revalidatePath('/faqs')
  return {}
}

export async function toggleFaqActive(id: string, is_active: boolean): Promise<FaqActionResult> {
  const user = await requireAuth()
  if (!WRITE_ROLES.includes(user.role)) return { error: 'Only the owner can manage FAQ facts' }

  const admin = createAdminClient()
  const { error } = await admin.from('faq_facts').update({ is_active }).eq('id', id)
  if (error) return { error: error.message }

  revalidatePath('/faqs')
  return {}
}
