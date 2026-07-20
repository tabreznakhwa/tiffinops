'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { formatInTimeZone } from 'date-fns-tz'
import { requireAuth } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Enums } from '@/lib/supabase/types'

const ADMIN_ROLES:  Enums<'user_role'>[] = ['owner', 'manager']
const CREATE_ROLES: Enums<'user_role'>[] = ['owner', 'manager', 'data_entry']

export type FixedMenuActionResult = { error?: string }

// ── Plans ──────────────────────────────────────────────────────────────────────

const PlanSchema = z.object({
  plan_name: z.string().min(1, 'Plan name is required').max(100),
  description: z.string().optional().transform(v => v?.trim() || null),
  meal_periods: z
    .array(z.enum(['breakfast', 'lunch', 'dinner']))
    .min(1, 'Select at least one meal period'),
  default_monthly_price: z.coerce
    .number({ message: 'Enter a valid price' })
    .min(0, 'Price cannot be negative'),
})

type PlanInput = {
  plan_name: string
  description?: string
  meal_periods: string[]
  default_monthly_price: number
}

export async function createPlan(input: PlanInput): Promise<FixedMenuActionResult> {
  const user = await requireAuth()
  if (!CREATE_ROLES.includes(user.role)) return { error: 'Owner, Manager or Data Entry role required' }

  const parsed = PlanSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  const admin = createAdminClient()
  const { error } = await admin.from('fixed_plans').insert({
    plan_name: parsed.data.plan_name,
    description: parsed.data.description,
    meal_periods: parsed.data.meal_periods,
    default_monthly_price: parsed.data.default_monthly_price.toFixed(2),
    created_by: user.id,
  })

  if (error) return { error: error.message }
  revalidatePath('/fixed-menu')
  return {}
}

export async function updatePlan(id: string, input: PlanInput): Promise<FixedMenuActionResult> {
  const user = await requireAuth()
  if (!ADMIN_ROLES.includes(user.role)) return { error: 'Owner or Manager role required' }

  const parsed = PlanSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  const admin = createAdminClient()
  const { error } = await admin
    .from('fixed_plans')
    .update({
      plan_name: parsed.data.plan_name,
      description: parsed.data.description,
      meal_periods: parsed.data.meal_periods,
      default_monthly_price: parsed.data.default_monthly_price.toFixed(2),
    })
    .eq('id', id)

  if (error) return { error: error.message }
  revalidatePath('/fixed-menu')
  return {}
}

export async function togglePlanStatus(id: string): Promise<FixedMenuActionResult> {
  const user = await requireAuth()
  if (!ADMIN_ROLES.includes(user.role)) return { error: 'Owner or Manager role required' }

  const admin = createAdminClient()
  const { data: plan } = await admin
    .from('fixed_plans')
    .select('is_active')
    .eq('id', id)
    .single()

  if (!plan) return { error: 'Plan not found' }

  const { error } = await admin
    .from('fixed_plans')
    .update({ is_active: !plan.is_active })
    .eq('id', id)

  if (error) return { error: error.message }
  revalidatePath('/fixed-menu')
  return {}
}

// ── Subscriptions ──────────────────────────────────────────────────────────────

const SubscriptionSchema = z.object({
  customer_id: z.string().uuid('Invalid customer'),
  fixed_plan_id: z.string().uuid('Invalid plan'),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid start date'),
  agreed_monthly_price: z.coerce
    .number({ message: 'Enter a valid price' })
    .min(0, 'Price cannot be negative'),
  notes: z.string().optional().transform(v => v?.trim() || null),
})

type SubscriptionInput = {
  customer_id: string
  fixed_plan_id: string
  start_date: string
  agreed_monthly_price: number
  notes?: string
}

export async function createSubscription(input: SubscriptionInput): Promise<FixedMenuActionResult> {
  const user = await requireAuth()
  if (!CREATE_ROLES.includes(user.role)) return { error: 'Owner, Manager or Data Entry role required' }

  const parsed = SubscriptionSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  const admin = createAdminClient()
  const { error } = await admin.from('customer_subscriptions').insert({
    customer_id: parsed.data.customer_id,
    fixed_plan_id: parsed.data.fixed_plan_id,
    start_date: parsed.data.start_date,
    agreed_monthly_price: parsed.data.agreed_monthly_price.toFixed(2),
    notes: parsed.data.notes,
    status: 'active',
    created_by: user.id,
  })

  if (error) return { error: error.message }
  revalidatePath('/fixed-menu')
  return {}
}

export async function updateSubscription(
  id: string,
  input: SubscriptionInput
): Promise<FixedMenuActionResult> {
  const user = await requireAuth()
  if (!CREATE_ROLES.includes(user.role)) return { error: 'Owner, Manager or Data Entry role required' }

  const parsed = SubscriptionSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  const admin = createAdminClient()
  const { error } = await admin
    .from('customer_subscriptions')
    .update({
      fixed_plan_id:        parsed.data.fixed_plan_id,
      start_date:           parsed.data.start_date,
      agreed_monthly_price: parsed.data.agreed_monthly_price.toFixed(2),
      notes:                parsed.data.notes,
    })
    .eq('id', id)

  if (error) return { error: error.message }
  revalidatePath('/fixed-menu')
  return {}
}

export async function updateSubscriptionStatus(
  id: string,
  status: 'active' | 'paused' | 'cancelled' | 'completed'
): Promise<FixedMenuActionResult> {
  const user = await requireAuth()
  if (!ADMIN_ROLES.includes(user.role)) return { error: 'Owner or Manager role required' }

  const admin = createAdminClient()
  const endDate = (status === 'cancelled' || status === 'completed')
    ? formatInTimeZone(new Date(), 'Asia/Dubai', 'yyyy-MM-dd')
    : null

  const { error } = await admin
    .from('customer_subscriptions')
    .update({ status, end_date: endDate })
    .eq('id', id)

  if (error) return { error: error.message }
  revalidatePath('/fixed-menu')
  return {}
}
