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
  meal_prices?: Record<string, string>
  notes?: string
}

// A plan covering 2+ meals needs a per-meal price breakdown (must sum to the
// agreed monthly price) so a single paused meal can be prorated correctly.
// Single-meal plans don't need a split — that one meal IS the whole price.
async function resolveMealPrices(
  admin: ReturnType<typeof createAdminClient>,
  fixedPlanId: string,
  agreedPrice: number,
  mealPrices: Record<string, string> | undefined,
): Promise<{ error?: string; meal_prices: Record<string, string> | null }> {
  const { data: plan } = await admin
    .from('fixed_plans')
    .select('meal_periods')
    .eq('id', fixedPlanId)
    .single()
  if (!plan) return { error: 'Plan not found', meal_prices: null }

  if (plan.meal_periods.length <= 1) return { meal_prices: null }

  if (!mealPrices) return { error: 'Enter a price for each meal', meal_prices: null }

  let sum = 0
  const cleaned: Record<string, string> = {}
  for (const meal of plan.meal_periods) {
    const n = parseFloat(mealPrices[meal] ?? '')
    if (!Number.isFinite(n) || n < 0) {
      return { error: `Enter a valid price for ${meal}`, meal_prices: null }
    }
    cleaned[meal] = n.toFixed(2)
    sum += n
  }
  if (Math.abs(sum - agreedPrice) > 0.02) {
    return {
      error: `Meal prices must add up to ${agreedPrice.toFixed(2)} (currently ${sum.toFixed(2)})`,
      meal_prices: null,
    }
  }
  return { meal_prices: cleaned }
}

export async function createSubscription(input: SubscriptionInput): Promise<FixedMenuActionResult> {
  const user = await requireAuth()
  if (!CREATE_ROLES.includes(user.role)) return { error: 'Owner, Manager or Data Entry role required' }

  const parsed = SubscriptionSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  const admin = createAdminClient()

  const { error: mealPricesError, meal_prices } = await resolveMealPrices(
    admin, parsed.data.fixed_plan_id, parsed.data.agreed_monthly_price, input.meal_prices
  )
  if (mealPricesError) return { error: mealPricesError }

  const { error } = await admin.from('customer_subscriptions').insert({
    customer_id: parsed.data.customer_id,
    fixed_plan_id: parsed.data.fixed_plan_id,
    start_date: parsed.data.start_date,
    agreed_monthly_price: parsed.data.agreed_monthly_price.toFixed(2),
    meal_prices,
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

  const { error: mealPricesError, meal_prices } = await resolveMealPrices(
    admin, parsed.data.fixed_plan_id, parsed.data.agreed_monthly_price, input.meal_prices
  )
  if (mealPricesError) return { error: mealPricesError }

  const { error } = await admin
    .from('customer_subscriptions')
    .update({
      fixed_plan_id:        parsed.data.fixed_plan_id,
      start_date:           parsed.data.start_date,
      agreed_monthly_price: parsed.data.agreed_monthly_price.toFixed(2),
      meal_prices,
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
  const isDestructive = status === 'cancelled' || status === 'completed'
  if (isDestructive && !ADMIN_ROLES.includes(user.role)) return { error: 'Only Owner or Manager can cancel or complete subscriptions' }
  if (!isDestructive && !CREATE_ROLES.includes(user.role)) return { error: 'Owner, Manager or Data Entry role required' }

  const admin = createAdminClient()
  // Record the date for any terminal/paused transition; clear it when re-activating
  const endDate = (status === 'cancelled' || status === 'completed' || status === 'paused')
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

export async function updateSubscriptionStartDate(
  id: string,
  startDate: string,
): Promise<FixedMenuActionResult> {
  const user = await requireAuth()
  if (user.role !== 'owner') return { error: 'Only Owner can change the start date' }

  const admin = createAdminClient()
  const { error } = await admin
    .from('customer_subscriptions')
    .update({ start_date: startDate })
    .eq('id', id)

  if (error) return { error: error.message }
  revalidatePath('/outstanding')
  revalidatePath('/fixed-menu')
  return {}
}

export async function updateSubscriptionPauseDate(
  id: string,
  endDate: string | null,
): Promise<FixedMenuActionResult> {
  const user = await requireAuth()
  if (!CREATE_ROLES.includes(user.role)) return { error: 'Owner, Manager or Data Entry role required' }

  const admin = createAdminClient()
  const { error } = await admin
    .from('customer_subscriptions')
    .update({ end_date: endDate })
    .eq('id', id)

  if (error) return { error: error.message }
  revalidatePath('/outstanding')
  revalidatePath('/fixed-menu')
  return {}
}

// ── Per-meal pauses ───────────────────────────────────────────────────────────
// Lets a shift-working customer stop just one meal (e.g. Breakfast) for a date
// range while the rest of their plan keeps running. Billing prorates the
// paused meal on a per-day basis — see lib/fixed-menu/proration.ts.

const MealPauseSchema = z.object({
  subscription_id: z.string().uuid('Invalid subscription'),
  meal_period: z.enum(['breakfast', 'lunch', 'dinner']),
  pause_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid start date'),
  pause_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  reason: z.string().optional().transform(v => v?.trim() || null),
})

export async function pauseSubscriptionMeal(input: {
  subscription_id: string
  meal_period: 'breakfast' | 'lunch' | 'dinner'
  pause_start: string
  pause_end?: string | null
  reason?: string
}): Promise<FixedMenuActionResult> {
  const user = await requireAuth()
  if (!CREATE_ROLES.includes(user.role)) return { error: 'Owner, Manager or Data Entry role required' }

  const parsed = MealPauseSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  if (parsed.data.pause_end && parsed.data.pause_end < parsed.data.pause_start) {
    return { error: 'Resume date cannot be before the pause start date' }
  }

  const admin = createAdminClient()

  const { data: sub } = await admin
    .from('customer_subscriptions')
    .select('fixed_plan_id, fixed_plans(meal_periods)')
    .eq('id', parsed.data.subscription_id)
    .single()
  if (!sub) return { error: 'Subscription not found' }
  const plan = sub.fixed_plans as unknown as { meal_periods: string[] } | null
  if (!plan?.meal_periods.includes(parsed.data.meal_period)) {
    return { error: `This plan does not include ${parsed.data.meal_period}` }
  }

  const { data: existingOpen } = await admin
    .from('subscription_meal_pauses')
    .select('id')
    .eq('subscription_id', parsed.data.subscription_id)
    .eq('meal_period', parsed.data.meal_period)
    .is('pause_end', null)
  if (existingOpen && existingOpen.length > 0) {
    return { error: `${parsed.data.meal_period} is already paused — resume it first` }
  }

  const { error } = await admin.from('subscription_meal_pauses').insert({
    subscription_id: parsed.data.subscription_id,
    meal_period: parsed.data.meal_period,
    pause_start: parsed.data.pause_start,
    pause_end: parsed.data.pause_end ?? null,
    reason: parsed.data.reason,
    created_by: user.id,
  })
  if (error) return { error: error.message }

  revalidatePath('/fixed-menu')
  revalidatePath('/outstanding')
  return {}
}

export async function resumeSubscriptionMeal(
  pauseId: string,
  resumeDate?: string,
): Promise<FixedMenuActionResult> {
  const user = await requireAuth()
  if (!CREATE_ROLES.includes(user.role)) return { error: 'Owner, Manager or Data Entry role required' }

  const admin = createAdminClient()
  const { data: pause } = await admin
    .from('subscription_meal_pauses')
    .select('pause_start, pause_end')
    .eq('id', pauseId)
    .single()
  if (!pause) return { error: 'Pause record not found' }
  if (pause.pause_end) return { error: 'This pause has already ended' }

  const end = resumeDate ?? formatInTimeZone(new Date(), 'Asia/Dubai', 'yyyy-MM-dd')
  if (end < pause.pause_start) return { error: 'Resume date cannot be before the pause start date' }

  const { error } = await admin
    .from('subscription_meal_pauses')
    .update({ pause_end: end })
    .eq('id', pauseId)
  if (error) return { error: error.message }

  revalidatePath('/fixed-menu')
  revalidatePath('/outstanding')
  return {}
}

export async function deleteSubscriptionMealPause(id: string): Promise<FixedMenuActionResult> {
  const user = await requireAuth()
  if (user.role !== 'owner') return { error: 'Only the owner can delete a pause record' }

  const admin = createAdminClient()
  const { error } = await admin.from('subscription_meal_pauses').delete().eq('id', id)
  if (error) return { error: error.message }

  revalidatePath('/fixed-menu')
  revalidatePath('/outstanding')
  return {}
}
