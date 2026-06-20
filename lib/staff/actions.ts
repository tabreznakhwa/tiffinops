'use server'

import { z } from 'zod'
import { requireAuth } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Enums } from '@/lib/supabase/types'

export type StaffActionResult = { error?: string }

type UserRole   = Enums<'user_role'>
type UserStatus = Enums<'user_status'>

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

  // Pre-insert the users row so the trigger ON CONFLICT DO NOTHING preserves role + active status
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

const RoleSchema = z.object({
  role: z.enum(['manager', 'accounts', 'data_entry', 'packer', 'viewer']),
})

export async function updateStaffRole(
  id: string,
  role: UserRole
): Promise<StaffActionResult> {
  const caller = await requireAuth()
  if (caller.role !== 'owner') return { error: 'Only the owner can change roles' }
  if (id === caller.id)        return { error: 'You cannot change your own role' }

  const parsed = RoleSchema.safeParse({ role })
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid role' }

  const admin = createAdminClient()
  // Use rpc to bypass PostgREST RLS policy check with service role
  const { error } = await admin.rpc('admin_update_user_role', {
    p_id:   id,
    p_role: parsed.data.role,
  })

  if (error) return { error: error.message }
  return {}
}

export async function updateStaffStatus(
  id: string,
  status: UserStatus
): Promise<StaffActionResult> {
  const caller = await requireAuth()
  if (caller.role !== 'owner') return { error: 'Only the owner can change account status' }
  if (id === caller.id)        return { error: 'You cannot deactivate your own account' }

  const admin = createAdminClient()
  const { error } = await admin.rpc('admin_update_user_status', {
    p_id:     id,
    p_status: status,
  })

  if (error) return { error: error.message }
  return {}
}

export async function updateStaffPermissions(
  id: string,
  perms: {
    can_record_payment:  boolean | null
    can_see_financials:  boolean | null
    can_export_reports:  boolean | null
  }
): Promise<StaffActionResult> {
  const caller = await requireAuth()
  if (!['owner', 'manager'].includes(caller.role)) {
    return { error: 'Only owner or manager can change permissions' }
  }
  if (id === caller.id) return { error: 'Use your own profile to change your permissions' }

  const admin = createAdminClient()
  const { error } = await admin.rpc('admin_update_user_permissions', {
    p_id:                 id,
    p_can_record_payment: perms.can_record_payment,
    p_can_see_financials: perms.can_see_financials,
    p_can_export_reports: perms.can_export_reports,
  })

  if (error) return { error: error.message }
  return {}
}

export { ASSIGNABLE_ROLES }
