'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { formatInTimeZone } from 'date-fns-tz'
import { requireAuth } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Enums } from '@/lib/supabase/types'
import { isBackdatedChange, createSubscriptionApprovalRequest, reconcileInvoicesForSubscription, finalizeBackdatedSubscriptionChange } from '@/lib/fixed-menu/subscription-approval'
import { addDaysStr } from '@/lib/fixed-menu/proration'

const ADMIN_ROLES:  Enums<'user_role'>[] = ['owner', 'manager']
const CREATE_ROLES: Enums<'user_role'>[] = ['owner', 'manager', 'data_entry']

export type FixedMenuActionResult = { error?: string; pendingApproval?: boolean }

// A backdated date change is monetary (it can shrink or grow an already
// invoiced amount), so it always goes to the owner for approval instead of
// applying immediately — see lib/fixed-menu/subscription-approval.ts. The
// owner is both the requester and the sole approver in that case, so letting
// the owner apply it directly (and immediately reconciling any invoice it
// touches) skips a pointless self-approval round trip.
async function gateOrApply(
  admin: ReturnType<typeof createAdminClient>,
  isOwner: boolean,
  userId: string,
  customerId: string,
  subscriptionId: string,
  affectedFrom: string,
  affectedTo: string | null,
  kind: 'meal_pause' | 'meal_resume' | 'status_change' | 'pause_date' | 'start_date' | 'plan_change',
  reason: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: Record<string, any>,
  // `extraReconcileId` lets a compound change (e.g. plan_change, which
  // closes one row and opens another) get a second subscription's invoices
  // reconciled too — the standard finalize call below only ever reconciles
  // `subscriptionId` itself.
  apply: () => Promise<{ error?: string; extraReconcileId?: string }>,
): Promise<FixedMenuActionResult> {
  const backdated = await isBackdatedChange(admin, customerId, affectedFrom, affectedTo)
  if (backdated && !isOwner) {
    const { error } = await createSubscriptionApprovalRequest(admin, userId, kind, subscriptionId, customerId, reason, payload)
    if (error) return { error }
    return { pendingApproval: true }
  }
  const applied = await apply()
  if (applied.error) return { error: applied.error }
  if (backdated) {
    const result = await finalizeBackdatedSubscriptionChange(admin, kind, subscriptionId, customerId, payload, userId, reason)
    if (result.error) return { error: result.error }
    if (applied.extraReconcileId) {
      const extra = await reconcileInvoicesForSubscription(admin, applied.extraReconcileId, userId, reason)
      if (extra.error) return { error: extra.error }
    }
  }
  return {}
}

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

  // A new plan supersedes any live plan covering the same meal(s). Billing
  // treats plans with different meal coverage as parallel series, so without
  // this an old Dinner plan would keep billing alongside a new Lunch & Dinner
  // plan and the customer gets double-charged.
  const { data: newPlan } = await admin
    .from('fixed_plans')
    .select('meal_periods')
    .eq('id', parsed.data.fixed_plan_id)
    .single()
  const newMeals = new Set<string>(newPlan?.meal_periods ?? [])
  const { data: existingSubs } = await admin
    .from('customer_subscriptions')
    .select('id, start_date, end_date, status, fixed_plans(plan_name, meal_periods)')
    .eq('customer_id', parsed.data.customer_id)
    .in('status', ['active', 'paused'])
  for (const s of existingSubs ?? []) {
    const plan = s.fixed_plans as unknown as { plan_name: string; meal_periods: string[] } | null
    if (!(plan?.meal_periods ?? []).some(m => newMeals.has(m))) continue
    const stillBilling = !s.end_date || s.end_date >= parsed.data.start_date
    if (!stillBilling) continue
    if (s.start_date < parsed.data.start_date) {
      // Close the old plan the day before the new one begins
      const dayBefore = new Date(new Date(parsed.data.start_date + 'T00:00:00Z').getTime() - 86_400_000)
        .toISOString().slice(0, 10)
      const { error: closeError } = await admin
        .from('customer_subscriptions')
        .update({ status: 'completed', end_date: dayBefore })
        .eq('id', s.id)
      if (closeError) return { error: closeError.message }
    } else {
      return {
        error: `This customer already has a live "${plan?.plan_name ?? 'plan'}" subscription covering the same meals (started ${s.start_date}). Edit that subscription to change the plan or price — don't add a second one.`,
      }
    }
  }

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
  revalidatePath('/outstanding')
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

  // A start-date edit here is the one date field this form can move — and,
  // same as the dedicated updateSubscriptionStartDate action, a backdated
  // move can retroactively change an already-issued invoice's proration, so
  // it needs owner approval too (unless the owner is the one making it).
  const { data: existing } = await admin.from('customer_subscriptions').select('customer_id, start_date').eq('id', id).single()
  if (!existing) return { error: 'Subscription not found' }

  if (existing.start_date !== parsed.data.start_date) {
    const earliest = parsed.data.start_date < existing.start_date ? parsed.data.start_date : existing.start_date
    const result = await gateOrApply(
      admin, user.role === 'owner', user.id, existing.customer_id, id,
      earliest, null, 'start_date',
      `Change start date to ${parsed.data.start_date}`,
      {
        start_date:           parsed.data.start_date,
        fixed_plan_id:        parsed.data.fixed_plan_id,
        agreed_monthly_price: parsed.data.agreed_monthly_price.toFixed(2),
        meal_prices,
        notes:                parsed.data.notes,
      },
      async () => {
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
        return { error: error?.message }
      },
    )
    if (result.error) return result
    revalidatePath('/fixed-menu')
    return result
  }

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

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const PlanChangeSchema = z.object({
  fixed_plan_id: z.string().uuid('Invalid plan'),
  agreed_monthly_price: z.coerce
    .number({ message: 'Enter a valid price' })
    .min(0, 'Price cannot be negative'),
  effective_date: z.string().regex(DATE_RE, 'Invalid effective date'),
  notes: z.string().optional().transform(v => v?.trim() || null),
})

// Switches a subscription onto a different plan mid-cycle (e.g. a customer's
// duty change moves them from Dinner to Lunch) without corrupting billing
// history. Unlike updateSubscription's in-place plan edit, this never
// mutates the existing row's fixed_plan_id — it closes the current row the
// day before `effective_date` and opens a new row on the new plan from
// `effective_date`, exactly the two-row shape createSubscription's
// auto-supersede already produces and chargeForCustomer/the invoice cron
// already bill correctly (each row keeps its own plan for its own dates).
export async function changeSubscriptionPlan(
  id: string,
  input: { fixed_plan_id: string; agreed_monthly_price: number; meal_prices?: Record<string, string>; effective_date: string; notes?: string },
): Promise<FixedMenuActionResult> {
  const user = await requireAuth()
  if (!CREATE_ROLES.includes(user.role)) return { error: 'Owner, Manager or Data Entry role required' }

  const parsed = PlanChangeSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  const admin = createAdminClient()

  const { data: existing } = await admin
    .from('customer_subscriptions')
    .select('customer_id, start_date, status')
    .eq('id', id)
    .single()
  if (!existing) return { error: 'Subscription not found' }
  if (existing.status === 'cancelled' || existing.status === 'completed') {
    return { error: 'This subscription has already ended — start a new subscription instead' }
  }

  const dayBefore = addDaysStr(parsed.data.effective_date, -1)
  if (dayBefore < existing.start_date) {
    return { error: `Effective date must be after this subscription's start date (${existing.start_date})` }
  }

  const { error: mealPricesError, meal_prices } = await resolveMealPrices(
    admin, parsed.data.fixed_plan_id, parsed.data.agreed_monthly_price, input.meal_prices
  )
  if (mealPricesError) return { error: mealPricesError }

  // Guard against ending up with two live subscriptions covering the same
  // meal(s) — e.g. the customer already has a separate live plan that also
  // includes the meal being switched to. Unlike createSubscription, this
  // doesn't auto-close a third-party row on the caller's behalf (surprising
  // for a targeted plan switch) — it just asks the user to resolve it first.
  const { data: newPlan } = await admin
    .from('fixed_plans')
    .select('meal_periods')
    .eq('id', parsed.data.fixed_plan_id)
    .single()
  const newMeals = new Set<string>(newPlan?.meal_periods ?? [])
  const { data: otherSubs } = await admin
    .from('customer_subscriptions')
    .select('id, end_date, fixed_plans(plan_name, meal_periods)')
    .eq('customer_id', existing.customer_id)
    .in('status', ['active', 'paused'])
    .neq('id', id)
  for (const s of otherSubs ?? []) {
    const plan = s.fixed_plans as unknown as { plan_name: string; meal_periods: string[] } | null
    if (!(plan?.meal_periods ?? []).some(m => newMeals.has(m))) continue
    if (!s.end_date || s.end_date >= parsed.data.effective_date) {
      return { error: `This customer already has a live "${plan?.plan_name ?? 'plan'}" subscription covering the same meal(s) — end that one first, then try again.` }
    }
  }

  const result = await gateOrApply(
    admin, user.role === 'owner', user.id, existing.customer_id, id,
    parsed.data.effective_date, null, 'plan_change',
    `Switch plan effective ${parsed.data.effective_date}`,
    {
      customer_id: existing.customer_id,
      day_before: dayBefore,
      effective_date: parsed.data.effective_date,
      new_plan_id: parsed.data.fixed_plan_id,
      new_agreed_price: parsed.data.agreed_monthly_price.toFixed(2),
      new_meal_prices: meal_prices,
      new_notes: parsed.data.notes,
    },
    async () => {
      const { error: closeErr } = await admin
        .from('customer_subscriptions')
        .update({ status: 'completed', end_date: dayBefore })
        .eq('id', id)
      if (closeErr) return { error: closeErr.message }

      const { data: newSub, error: insertErr } = await admin
        .from('customer_subscriptions')
        .insert({
          customer_id: existing.customer_id,
          fixed_plan_id: parsed.data.fixed_plan_id,
          start_date: parsed.data.effective_date,
          agreed_monthly_price: parsed.data.agreed_monthly_price.toFixed(2),
          meal_prices,
          notes: parsed.data.notes,
          status: 'active',
          created_by: user.id,
        })
        .select('id')
        .single()
      if (insertErr) return { error: insertErr.message }
      return { extraReconcileId: newSub?.id }
    },
  )
  if (result.error) return result
  revalidatePath('/fixed-menu')
  revalidatePath('/outstanding')
  return result
}

export async function updateSubscriptionStatus(
  id: string,
  status: 'active' | 'paused' | 'cancelled' | 'completed',
  effectiveDate?: string,
): Promise<FixedMenuActionResult> {
  const user = await requireAuth()
  const isDestructive = status === 'cancelled' || status === 'completed'
  if (isDestructive && !ADMIN_ROLES.includes(user.role)) return { error: 'Only Owner or Manager can cancel or complete subscriptions' }
  if (!isDestructive && !CREATE_ROLES.includes(user.role)) return { error: 'Owner, Manager or Data Entry role required' }

  const admin = createAdminClient()
  // Record the date for any terminal/paused transition; clear it when re-activating.
  // A caller-supplied date (e.g. "this was actually a pause from the 3rd") wins when
  // valid; otherwise falls back to today, matching the old always-today behavior.
  const endDate = (status === 'cancelled' || status === 'completed' || status === 'paused')
    ? (effectiveDate && DATE_RE.test(effectiveDate) ? effectiveDate : formatInTimeZone(new Date(), 'Asia/Dubai', 'yyyy-MM-dd'))
    : null

  // Reactivating (clearing end_date) only expands future billing — it never
  // retroactively shrinks an already-issued invoice, so it never needs approval.
  if (!endDate) {
    const { error } = await admin.from('customer_subscriptions').update({ status, end_date: null }).eq('id', id)
    if (error) return { error: error.message }
    revalidatePath('/fixed-menu')
    return {}
  }

  const { data: sub } = await admin.from('customer_subscriptions').select('customer_id').eq('id', id).single()
  if (!sub) return { error: 'Subscription not found' }

  const result = await gateOrApply(
    admin, user.role === 'owner', user.id, sub.customer_id, id,
    endDate, null, 'status_change',
    `${status === 'paused' ? 'Pause' : status === 'cancelled' ? 'Cancel' : 'Complete'} subscription effective ${endDate}`,
    { status, effective_date: endDate },
    async () => {
      const { error } = await admin.from('customer_subscriptions').update({ status, end_date: endDate }).eq('id', id)
      return { error: error?.message }
    },
  )
  if (result.error) return result
  revalidatePath('/fixed-menu')
  return result
}

export async function updateSubscriptionStartDate(
  id: string,
  startDate: string,
): Promise<FixedMenuActionResult> {
  const user = await requireAuth()
  if (user.role !== 'owner') return { error: 'Only Owner can change the start date' }

  const admin = createAdminClient()
  const { data: existing } = await admin.from('customer_subscriptions').select('customer_id, start_date').eq('id', id).single()

  const { error } = await admin
    .from('customer_subscriptions')
    .update({ start_date: startDate })
    .eq('id', id)

  if (error) return { error: error.message }

  // The owner is the sole approver for backdated changes anyway — apply
  // directly, but still auto-reconcile any already-issued invoice this
  // start-date correction affects.
  if (existing) {
    const earliest = startDate < existing.start_date ? startDate : existing.start_date
    if (await isBackdatedChange(admin, existing.customer_id, earliest, null)) {
      await reconcileInvoicesForSubscription(admin, id, user.id, `Start date changed to ${startDate}`)
    }
  }

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

  // This field is only ever meant to fine-tune the pause/cancel date on a
  // subscription that's already paused/cancelled/completed — it must never be
  // the thing that silently puts a subscription into "active with an end_date
  // set" (an invariant violation: only updateSubscriptionStatus's non-active
  // branches should ever set end_date, and always alongside a status change).
  // If someone uses this field on a still-active row, treat setting a date as
  // implicitly pausing it, matching what the date visually communicates.
  if (endDate) {
    const { data: current } = await admin
      .from('customer_subscriptions')
      .select('customer_id, status')
      .eq('id', id)
      .single()
    if (!current) return { error: 'Subscription not found' }

    const setsToPaused = current.status === 'active'
    const result = await gateOrApply(
      admin, user.role === 'owner', user.id, current.customer_id, id,
      endDate, null, 'pause_date',
      `Set pause/end date to ${endDate}`,
      { end_date: endDate, sets_paused: setsToPaused },
      async () => {
        const { error } = await admin
          .from('customer_subscriptions')
          .update(setsToPaused ? { end_date: endDate, status: 'paused' } : { end_date: endDate })
          .eq('id', id)
        return { error: error?.message }
      },
    )
    if (result.error) return result
    revalidatePath('/outstanding')
    revalidatePath('/fixed-menu')
    return result
  }

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
    .select('customer_id, fixed_plan_id, fixed_plans(meal_periods)')
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

  const result = await gateOrApply(
    admin, user.role === 'owner', user.id, sub.customer_id, parsed.data.subscription_id,
    parsed.data.pause_start, parsed.data.pause_end ?? null, 'meal_pause',
    `Stop ${parsed.data.meal_period} from ${parsed.data.pause_start}${parsed.data.reason ? ` — ${parsed.data.reason}` : ''}`,
    {
      meal_period: parsed.data.meal_period,
      pause_start: parsed.data.pause_start,
      pause_end: parsed.data.pause_end ?? null,
      reason: parsed.data.reason ?? null,
    },
    async () => {
      const { error } = await admin.from('subscription_meal_pauses').insert({
        subscription_id: parsed.data.subscription_id,
        meal_period: parsed.data.meal_period,
        pause_start: parsed.data.pause_start,
        pause_end: parsed.data.pause_end ?? null,
        reason: parsed.data.reason,
        created_by: user.id,
      })
      return { error: error?.message }
    },
  )
  if (result.error) return result

  revalidatePath('/fixed-menu')
  revalidatePath('/outstanding')
  return result
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
    .select('subscription_id, pause_start, pause_end, customer_subscriptions(customer_id)')
    .eq('id', pauseId)
    .single()
  if (!pause) return { error: 'Pause record not found' }
  if (pause.pause_end) return { error: 'This pause has already ended' }
  const customerId = (pause.customer_subscriptions as unknown as { customer_id: string } | null)?.customer_id
  if (!customerId) return { error: 'Subscription not found' }

  const end = resumeDate ?? formatInTimeZone(new Date(), 'Asia/Dubai', 'yyyy-MM-dd')
  if (end < pause.pause_start) return { error: 'Resume date cannot be before the pause start date' }

  const result = await gateOrApply(
    admin, user.role === 'owner', user.id, customerId, pause.subscription_id,
    end, null, 'meal_resume',
    `Resume meal from ${end} (pause ${pauseId})`,
    { pause_id: pauseId, resume_date: end },
    async () => {
      const { error } = await admin.from('subscription_meal_pauses').update({ pause_end: end }).eq('id', pauseId)
      return { error: error?.message }
    },
  )
  if (result.error) return result

  revalidatePath('/fixed-menu')
  revalidatePath('/outstanding')
  return result
}

export async function deleteSubscriptionMealPause(id: string): Promise<FixedMenuActionResult> {
  const user = await requireAuth()
  if (user.role !== 'owner') return { error: 'Only the owner can delete a pause record' }

  const admin = createAdminClient()
  const { data: pause } = await admin.from('subscription_meal_pauses').select('subscription_id, pause_start').eq('id', id).single()

  const { error } = await admin.from('subscription_meal_pauses').delete().eq('id', id)
  if (error) return { error: error.message }

  // Deleting a pause can retroactively change what an already-issued
  // invoice should have charged — only the owner can do this, so apply +
  // reconcile directly rather than routing through approval.
  if (pause) {
    await reconcileInvoicesForSubscription(admin, pause.subscription_id, user.id, `Removed pause record starting ${pause.pause_start}`)
  }

  revalidatePath('/fixed-menu')
  revalidatePath('/outstanding')
  return {}
}
