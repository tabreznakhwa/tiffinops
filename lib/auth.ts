import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Tables, Enums } from '@/lib/supabase/types'

export type AppUser = Tables<'users'>
export type UserRole = Enums<'user_role'>

export async function getCurrentUser(): Promise<AppUser | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  // Admin client bypasses RLS — same pattern as proxy.ts. Needed because
  // is_active_user() in the users_read policy is recursive without SECURITY
  // DEFINER, making the row invisible to the anon-key client.
  const admin = createAdminClient()
  const { data } = await admin
    .from('users')
    .select('*')
    .eq('id', user.id)
    .single()

  return data
}

// Redirects to /login if not authenticated, to /pending if not active.
// Returns the active user.
export async function requireAuth(): Promise<AppUser> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const admin = createAdminClient()
  const { data: appUser } = await admin
    .from('users')
    .select('*')
    .eq('id', user.id)
    .single()

  if (!appUser) redirect('/login')
  if (appUser.status === 'pending') redirect('/pending')
  if (appUser.status === 'inactive') redirect('/login')

  return appUser
}

// Requires a specific role. Redirects to / if role check fails.
export async function requireRole(roles: UserRole[]): Promise<AppUser> {
  const appUser = await requireAuth()

  if (!roles.includes(appUser.role)) {
    redirect('/')
  }

  return appUser
}

export function canRecordPayment(user: AppUser): boolean {
  if (user.can_record_payment !== null) return user.can_record_payment
  return ['owner', 'manager', 'accounts'].includes(user.role)
}

export function canSeeFinancials(user: AppUser): boolean {
  if (user.can_see_financials !== null) return user.can_see_financials
  return ['owner', 'manager', 'accounts'].includes(user.role)
}

export function canExportReports(user: AppUser): boolean {
  if (user.can_export_reports !== null) return user.can_export_reports
  return ['owner', 'manager', 'accounts'].includes(user.role)
}
