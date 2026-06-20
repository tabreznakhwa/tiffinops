import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Enums } from '@/lib/supabase/types'

type UserRole   = Enums<'user_role'>
type UserStatus = Enums<'user_status'>

const ASSIGNABLE_ROLES: UserRole[] = ['manager', 'accounts', 'data_entry', 'packer', 'viewer']

export async function POST(req: NextRequest) {
  try {
    const caller = await requireAuth()
    const body = await req.json() as {
      action: 'role' | 'status' | 'permissions'
      id: string
      role?: UserRole
      status?: UserStatus
      can_record_payment?: boolean | null
      can_see_financials?: boolean | null
      can_export_reports?: boolean | null
    }

    if (!body.id) {
      return NextResponse.json({ error: 'Missing user id' }, { status: 400 })
    }

    const admin = createAdminClient()

    if (body.action === 'role') {
      if (caller.role !== 'owner') return NextResponse.json({ error: 'Only the owner can change roles' }, { status: 403 })
      if (body.id === caller.id)   return NextResponse.json({ error: 'You cannot change your own role' }, { status: 400 })
      if (!body.role || !ASSIGNABLE_ROLES.includes(body.role)) {
        return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
      }
      const { error } = await admin
        .from('users')
        .update({ role: body.role })
        .eq('id', body.id)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ ok: true })
    }

    if (body.action === 'status') {
      if (caller.role !== 'owner') return NextResponse.json({ error: 'Only the owner can change status' }, { status: 403 })
      if (body.id === caller.id)   return NextResponse.json({ error: 'You cannot deactivate your own account' }, { status: 400 })
      if (!body.status) return NextResponse.json({ error: 'Missing status' }, { status: 400 })
      const { error } = await admin
        .from('users')
        .update({ status: body.status })
        .eq('id', body.id)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ ok: true })
    }

    if (body.action === 'permissions') {
      if (!['owner', 'manager'].includes(caller.role)) return NextResponse.json({ error: 'No permission' }, { status: 403 })
      if (body.id === caller.id) return NextResponse.json({ error: 'Use your own profile' }, { status: 400 })
      const { error } = await admin
        .from('users')
        .update({
          can_record_payment: body.can_record_payment ?? null,
          can_see_financials: body.can_see_financials ?? null,
          can_export_reports: body.can_export_reports ?? null,
        })
        .eq('id', body.id)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err) {
    console.error('[staff/update]', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Server error' }, { status: 500 })
  }
}
