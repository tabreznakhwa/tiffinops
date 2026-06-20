'use server'

import { z } from 'zod'
import { requireAuth } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Enums } from '@/lib/supabase/types'

export type StaffActionResult = { error?: string }

type UserRole = Enums<'user_role'>

// Roles that can be assigned to invited staff (owner is reserved)
const ASSIGNABLE_ROLES: UserRole[] = ['manager', 'accounts', 'data_entry', 'packer', 'viewer']

const InviteSchema = z.object({
  email:     z.string().email('Enter a valid email address'),
  full_name: z.string().min(2, 'Full name is required'),
  role:      z.enum(['manager', 'accounts', 'data_entry', 'packer', 'viewer']),
})

export async function inviteStaff(input: {
  email: string
  full_name: string
  role: UserRole
}): Promise<StaffActionResult> {
  const caller = await requireAuth()
  if (caller.role !== 'owner') return { error: 'Only the owner can invite staff' }

  const parsed = InviteSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  const admin = createAdminClient()

  const { data: inviteData, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(
    parsed.data.email,
    { data: { full_name: parsed.data.full_name } }
  )
  if (inviteErr) {
    if (inviteErr.message?.toLowerCase().includes('already')) {
      return { error: 'A user with this email already exists' }
    }
    return { error: inviteErr.message ?? 'Failed to send invite' }
  }

  // Pre-insert so the auth trigger's ON CONFLICT DO NOTHING preserves role + status
  const { error: insertErr } = await admin.from('users').insert({
    id:         inviteData.user.id,
    email:      parsed.data.email,
    full_name:  parsed.data.full_name,
    role:       parsed.data.role,
    status:     'active',
  })
  if (insertErr && !insertErr.message?.includes('duplicate')) {
    return { error: insertErr.message }
  }

  return {}
}

export { ASSIGNABLE_ROLES }
