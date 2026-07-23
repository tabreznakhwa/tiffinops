'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAuth } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Enums } from '@/lib/supabase/types'

const WRITER_ROLES: Enums<'user_role'>[] = ['owner', 'manager', 'data_entry']
const ADMIN_ROLES: Enums<'user_role'>[] = ['owner', 'manager']

const CustomerSchema = z.object({
  full_name: z.string().min(2, 'Name must be at least 2 characters'),
  mobile_number: z.string().min(7, 'Enter a valid mobile number'),
  customer_type: z.enum(['a_la_carte', 'fixed_menu', 'hybrid']),
  area: z.string().transform(v => v.trim() || null),
  whatsapp_number: z.string().transform(v => v.trim() || null),
  email: z.string().transform(v => v.trim() || null),
  delivery_address: z.string().transform(v => v.trim() || null),
  // optional: not exposed in the current form, reserved for future fields
  delivery_instructions: z.string().optional().transform(v => v?.trim() || null),
  notes: z.string().transform(v => v.trim() || null),
  referral_source: z.enum(['none', 'customer', 'external']).optional().default('none'),
  referred_by_customer_id: z.string().optional().transform(v => v?.trim() || null),
  referrer_name: z.string().optional().transform(v => v?.trim() || null),
  referrer_phone: z.string().optional().transform(v => v?.trim() || null),
  referral_reward_amount: z.string().optional().transform(v => {
    if (!v) return '0.00'
    const n = parseFloat(v)
    return Number.isFinite(n) && n >= 0 ? n.toFixed(2) : '0.00'
  }),
  billing_day: z.string().optional().transform(v => {
    if (!v) return null
    const n = parseInt(v, 10)
    return !isNaN(n) && n >= 1 && n <= 31 ? n : null
  }),
}).transform(({ referral_source, ...data }) => {
  if (referral_source === 'customer') {
    return {
      ...data,
      referrer_name: null,
      referrer_phone: null,
    }
  }

  if (referral_source === 'external') {
    return {
      ...data,
      referred_by_customer_id: null,
      referrer_name: data.referrer_name,
      referrer_phone: data.referrer_phone,
    }
  }

  return {
    ...data,
    referred_by_customer_id: null,
    referrer_name: null,
    referrer_phone: null,
    referral_reward_amount: '0.00',
  }
}).refine(
  data => !!data.referred_by_customer_id || !!data.referrer_name || Number(data.referral_reward_amount) === 0,
  { message: 'Select a customer referrer or enter a non-customer referrer name' },
)

export type CustomerActionResult = { error?: string }

export async function createCustomer(
  formData: FormData
): Promise<CustomerActionResult> {
  const user = await requireAuth()
  if (!WRITER_ROLES.includes(user.role)) return { error: 'Insufficient permissions' }

  const raw = Object.fromEntries(
    [...formData.entries()].map(([k, v]) => [k, v.toString()])
  )
  const parsed = CustomerSchema.safeParse(raw)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Validation error' }

  const admin = createAdminClient()
  const { data: code, error: codeErr } = await admin.rpc('next_customer_code')
  if (codeErr || !code) {
    return { error: 'Could not generate customer code — run 02_customers_enhancements.sql first.' }
  }

  const { error } = await admin.from('customers').insert({
    ...parsed.data,
    customer_code: code as string,
    created_by: user.id,
  })
  if (error) return { error: error.message }

  revalidatePath('/customers')
  return {}
}

export async function updateCustomer(
  id: string,
  formData: FormData
): Promise<CustomerActionResult> {
  const user = await requireAuth()
  if (!WRITER_ROLES.includes(user.role)) return { error: 'Insufficient permissions' }

  const raw = Object.fromEntries(
    [...formData.entries()].map(([k, v]) => [k, v.toString()])
  )
  const parsed = CustomerSchema.safeParse(raw)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Validation error' }

  if (parsed.data.referred_by_customer_id === id) {
    return { error: 'Customer cannot refer themself' }
  }

  const admin = createAdminClient()
  const { error } = await admin.from('customers').update(parsed.data).eq('id', id)
  if (error) return { error: error.message }

  revalidatePath('/customers')
  revalidatePath(`/customers/${id}`)
  return {}
}

export async function setCustomerStatus(
  id: string,
  status: Enums<'customer_status'>
): Promise<CustomerActionResult> {
  const user = await requireAuth()
  if (
    (status === 'inactive' || status === 'blacklisted') &&
    !ADMIN_ROLES.includes(user.role)
  ) {
    return { error: 'Only owner/manager can deactivate or blacklist customers' }
  }
  if (!WRITER_ROLES.includes(user.role)) return { error: 'Insufficient permissions' }

  const admin = createAdminClient()
  const { error } = await admin.from('customers').update({ status }).eq('id', id)
  if (error) return { error: error.message }

  revalidatePath('/customers')
  revalidatePath(`/customers/${id}`)
  return {}
}
