// Backdated subscription/meal-pause changes are monetary — they can shrink or
// grow an amount that was already invoiced. Per owner policy: ANY subscription
// change whose effective date is backdated (before today, or falling inside a
// billing period that's already been invoiced — draft or issued) must go
// through owner approval instead of applying immediately. Once approved, any
// already-generated invoice touched by the change — draft or issued — is
// automatically recomputed — see `reconcileInvoicesForSubscription` below.
//
// This module is plain server-side logic (no 'use server') — it's called from
// the 'use server' action files in lib/fixed-menu/actions.ts and from
// lib/approvals/actions.ts, never imported by client code directly.

import { formatInTimeZone } from 'date-fns-tz'
import type { createAdminClient } from '@/lib/supabase/admin'
import type { Database } from '@/lib/supabase/types'
import { calcSubscriptionCharge, isMealPausedOn, addDaysStr, type MealPause } from '@/lib/fixed-menu/proration'
import { computeFixedInvoiceAmounts } from '@/lib/invoices/fixedPlanInvoiceLines'
import { reconcileInvoicePaymentStatus } from '@/lib/invoices/reconcile'

type AdminClient = ReturnType<typeof createAdminClient>

export type SubscriptionApprovalKind =
  | 'meal_pause'
  | 'meal_resume'
  | 'status_change'
  | 'pause_date'
  | 'start_date'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SubscriptionApprovalPayload = Record<string, any>

function todayDubai(): string {
  return formatInTimeZone(new Date(), 'Asia/Dubai', 'yyyy-MM-dd')
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

// Inclusive day count between two 'YYYY-MM-DD' dates — an invoice's own
// billing-cycle length, used as the proration denominator below so a
// prepaid anniversary cycle crossing two calendar months of different
// lengths still reconciles against its own fixed cycle length rather than
// being refragmented per calendar month.
function daySpan(from: string, to: string): number {
  const a = new Date(from + 'T00:00:00Z').getTime()
  const b = new Date(to + 'T00:00:00Z').getTime()
  return Math.round((b - a) / 86400000) + 1
}

// ── Stale orders: staff didn't act on a stop request in time ────────────────
// When a meal/subscription is retroactively stopped, any credit order that
// was still logged after the new cutoff represents an operational mistake —
// staff kept preparing/delivering after the customer had already asked to
// stop — not the customer choosing to eat outside the plan. Those orders get
// voided (a straight credit) instead of being billed as "out of plan"
// extras, so the pro-rata plan credit isn't cancelled out by re-billing the
// very orders that shouldn't have happened. See `finalizeBackdatedSubscriptionChange`.
type StaleOrder = { id: string; order_number: string; total_amount: number }

async function findStaleCreditOrders(
  admin: AdminClient,
  customerId: string,
  mealPeriods: string[],
  fromDate: string,
  toDate: string | null,
): Promise<StaleOrder[]> {
  if (!mealPeriods.length) return []
  let q = admin
    .from('orders')
    .select('id, order_number, total_amount')
    .eq('customer_id', customerId)
    .in('meal_period', mealPeriods as Database['public']['Enums']['meal_period'][])
    .eq('is_credit', true)
    .gte('order_date', fromDate)
    .not('order_status', 'in', '(cancelled,voided,draft)')
    .is('voided_at', null)
  if (toDate) q = q.lte('order_date', toDate)
  const { data } = await q
  return (data ?? []).map(o => ({ id: o.id, order_number: o.order_number, total_amount: parseFloat(String(o.total_amount)) }))
}

async function voidStaleOrders(
  admin: AdminClient,
  orders: StaleOrder[],
  actorId: string,
  reason: string,
): Promise<{ error?: string }> {
  if (!orders.length) return {}
  const { error } = await admin
    .from('orders')
    .update({ order_status: 'voided', voided_at: new Date().toISOString(), voided_by: actorId, void_reason: reason })
    .in('id', orders.map(o => o.id))
    .is('voided_at', null)
  if (error) return { error: error.message }
  return {}
}

// The credit-order window a change just closed off — null when the change
// doesn't shrink coverage (e.g. re-activating, or a start-date/resume change,
// which this doesn't attempt to auto-void: expanding coverage never needs it,
// and a start-date move is a front-edge case ambiguous enough to leave manual).
// For pause_date/status_change we only need the NEW cutoff, not the old one:
// querying "credit orders after the new cutoff" is direction-safe on its own —
// if coverage shrank, real stale orders exist past the new cutoff and get
// caught; if coverage expanded, no order predates "today" past the new
// (later) cutoff, so the query naturally returns nothing.
async function staleOrderWindow(
  admin: AdminClient,
  subscriptionId: string,
  kind: SubscriptionApprovalKind,
  payload: SubscriptionApprovalPayload,
): Promise<{ mealPeriods: string[]; from: string; to: string | null } | null> {
  if (kind === 'meal_pause') {
    return { mealPeriods: [payload.meal_period], from: payload.pause_start, to: payload.pause_end ?? null }
  }
  if (kind === 'pause_date' || kind === 'status_change') {
    const newEnd: string | null = kind === 'pause_date' ? payload.end_date : (payload.effective_date ?? null)
    if (!newEnd) return null
    const { data: sub } = await admin
      .from('customer_subscriptions')
      .select('fixed_plans(meal_periods)')
      .eq('id', subscriptionId)
      .single()
    const plan = sub?.fixed_plans as unknown as { meal_periods: string[] } | null
    if (!plan?.meal_periods?.length) return null
    return { mealPeriods: plan.meal_periods, from: addDaysStr(newEnd, 1), to: null }
  }
  return null
}

// Read-only preview of the same window, for the Approvals page to show the
// owner "N orders (AED X) will be voided as a staff-error credit" before they
// decide — no writes.
export async function previewSubscriptionApprovalImpact(
  admin: AdminClient,
  subscriptionId: string,
  changes: (SubscriptionApprovalPayload & { kind?: SubscriptionApprovalKind }) | null,
): Promise<{ count: number; total: number } | null> {
  if (!changes?.kind || !changes.customer_id) return null
  const window = await staleOrderWindow(admin, subscriptionId, changes.kind, changes)
  if (!window) return null
  const stale = await findStaleCreditOrders(admin, changes.customer_id, window.mealPeriods, window.from, window.to)
  return stale.length ? { count: stale.length, total: round2(stale.reduce((s, o) => s + o.total_amount, 0)) } : null
}

// ── Backdating check ─────────────────────────────────────────────────────────
// A change is "backdated" — and so needs owner approval — when the earliest
// date it affects is already in the past, OR falls inside a billing period
// that's already been invoiced (draft/issued/partial/paid — a still-draft
// invoice already represents a real billing commitment for that period, so a
// change touching it needs the same reconciliation as an issued one; treating
// it as "not yet billed" would let it get issued later with a stale amount
// and no adjustment trail). A future-dated change that hasn't been invoiced
// in any form yet is safe to apply immediately.
export async function isBackdatedChange(
  admin: AdminClient,
  customerId: string,
  affectedFrom: string,
  affectedTo: string | null,
): Promise<boolean> {
  const today = todayDubai()
  if (affectedFrom < today) return true

  const { data: invoices } = await admin
    .from('invoices')
    .select('billing_period_start, billing_period_end')
    .eq('customer_id', customerId)
    .eq('invoice_type', 'fixed_monthly')
    .in('status', ['draft', 'issued', 'partial', 'paid'])

  const to = affectedTo ?? '9999-12-31'
  return (invoices ?? []).some(inv => {
    if (!inv.billing_period_start) return false
    const start = inv.billing_period_start
    const end = inv.billing_period_end ?? inv.billing_period_start
    return start <= to && end >= affectedFrom
  })
}

// ── Requesting approval ──────────────────────────────────────────────────────

export async function createSubscriptionApprovalRequest(
  admin: AdminClient,
  requestedBy: string,
  kind: SubscriptionApprovalKind,
  subscriptionId: string,
  customerId: string,
  reason: string,
  payload: SubscriptionApprovalPayload,
): Promise<{ error?: string }> {
  const { error } = await admin.from('approval_requests').insert({
    request_type: 'edit',
    target_table: 'subscription',
    target_id: subscriptionId,
    reason,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    proposed_changes: { kind, customer_id: customerId, ...payload } as any,
    status: 'pending',
    requested_by: requestedBy,
    requested_at: new Date().toISOString(),
  })
  if (error) return { error: error.message }
  return {}
}

// ── Applying an approved request ─────────────────────────────────────────────
// Runs the actual mutation the request describes (the same write each gated
// action would have made immediately if the change hadn't been backdated),
// then recomputes any already-issued invoice the change touches.

export async function applySubscriptionApproval(
  admin: AdminClient,
  req: { id: string; target_id: string; reason: string; proposed_changes: unknown },
  actorId: string,
): Promise<{ error?: string }> {
  const changes = req.proposed_changes as (SubscriptionApprovalPayload & { kind: SubscriptionApprovalKind }) | null
  if (!changes?.kind) return { error: 'Malformed subscription approval request' }

  const subscriptionId = req.target_id

  switch (changes.kind) {
    case 'meal_pause': {
      const { error } = await admin.from('subscription_meal_pauses').insert({
        subscription_id: subscriptionId,
        meal_period: changes.meal_period,
        pause_start: changes.pause_start,
        pause_end: changes.pause_end ?? null,
        reason: changes.reason ?? null,
        created_by: actorId,
      })
      if (error) return { error: error.message }
      break
    }
    case 'meal_resume': {
      const { error } = await admin
        .from('subscription_meal_pauses')
        .update({ pause_end: changes.resume_date })
        .eq('id', changes.pause_id)
      if (error) return { error: error.message }
      break
    }
    case 'status_change': {
      const { error } = await admin
        .from('customer_subscriptions')
        .update({ status: changes.status, end_date: changes.effective_date ?? null })
        .eq('id', subscriptionId)
      if (error) return { error: error.message }
      break
    }
    case 'pause_date': {
      const { error } = await admin
        .from('customer_subscriptions')
        .update(changes.sets_paused ? { end_date: changes.end_date, status: 'paused' } : { end_date: changes.end_date })
        .eq('id', subscriptionId)
      if (error) return { error: error.message }
      break
    }
    case 'start_date': {
      // Carries the whole edit-subscription form, not just the date — a
      // deferred approval must apply everything the requester submitted,
      // not silently drop the plan/price/notes changes that came with it.
      const update: Database['public']['Tables']['customer_subscriptions']['Update'] = { start_date: changes.start_date }
      if (changes.fixed_plan_id !== undefined) update.fixed_plan_id = changes.fixed_plan_id
      if (changes.agreed_monthly_price !== undefined) update.agreed_monthly_price = changes.agreed_monthly_price
      if (changes.meal_prices !== undefined) update.meal_prices = changes.meal_prices
      if (changes.notes !== undefined) update.notes = changes.notes
      const { error } = await admin.from('customer_subscriptions').update(update).eq('id', subscriptionId)
      if (error) return { error: error.message }
      break
    }
    default:
      return { error: `Unknown subscription approval kind: ${changes.kind}` }
  }

  const result = await finalizeBackdatedSubscriptionChange(admin, changes.kind, subscriptionId, changes.customer_id, changes, actorId, req.reason)
  if (result.error) return { error: result.error }
  return {}
}

// ── Void stale orders, then reconcile ────────────────────────────────────────
// Shared tail for both the owner-direct path (gateOrApply in actions.ts, when
// the owner makes a backdated change themselves) and the post-approval path
// (applySubscriptionApproval above) — same side effects either way: close out
// any orders staff logged after the new cutoff as a staff-error credit, fold
// that into the reason so it shows up on the invoice's adjustment line, then
// recompute the invoice.
export async function finalizeBackdatedSubscriptionChange(
  admin: AdminClient,
  kind: SubscriptionApprovalKind,
  subscriptionId: string,
  customerId: string,
  payload: SubscriptionApprovalPayload,
  actorId: string,
  reason: string,
): Promise<{ error?: string; voided?: { count: number; total: number } }> {
  let finalReason = reason
  let voided: { count: number; total: number } | undefined

  const window = await staleOrderWindow(admin, subscriptionId, kind, payload)
  if (window) {
    const stale = await findStaleCreditOrders(admin, customerId, window.mealPeriods, window.from, window.to)
    if (stale.length) {
      const total = round2(stale.reduce((s, o) => s + o.total_amount, 0))
      const { error } = await voidStaleOrders(
        admin, stale, actorId,
        `Staff error credit — orders logged after a retroactive stop (${reason}), not billed`,
      )
      if (error) return { error }
      voided = { count: stale.length, total }
      finalReason = `${reason} — ${stale.length} order(s) already logged after the requested stop date (AED ${total.toFixed(2)}) voided as a staff-error credit, not billed to the customer`
    }
  }

  const result = await reconcileInvoicesForSubscription(admin, subscriptionId, actorId, finalReason)
  if (result.error) return { error: result.error, voided }
  return { voided }
}

// ── Automatic invoice reconciliation ─────────────────────────────────────────
// After a backdated subscription/meal-pause change is applied, any invoice
// already generated (draft or issued) for a billing period the change
// touches is now wrong. This recomputes the correct flat-plan charge for
// each such invoice and books the difference as a "Proration adjustment"
// line — never editing the original generated line items, so the invoice
// keeps a full audit trail of what was originally billed and what was
// corrected after the fact. Reaching still-draft invoices here (not just
// issued ones) matters: without it, a draft sitting untouched through a
// backdated change would carry its stale original amount all the way to
// issueInvoice with no adjustment ever recorded — see isBackdatedChange
// above, which is why it treats a draft the same as an issued invoice too.
export async function reconcileInvoicesForSubscription(
  admin: AdminClient,
  subscriptionId: string,
  actorId: string,
  reason: string,
): Promise<{ adjusted: { invoice_number: string; delta: number }[]; error?: string }> {
  const { data: sub } = await admin
    .from('customer_subscriptions')
    .select('id, customer_id, start_date, end_date, status, agreed_monthly_price, meal_prices, fixed_plans(meal_periods), customers(customer_type)')
    .eq('id', subscriptionId)
    .single()
  if (!sub) return { adjusted: [], error: 'Subscription not found' }

  const plan = sub.fixed_plans as unknown as { meal_periods: string[] | null } | null
  const customer = sub.customers as unknown as { customer_type: string } | null
  const mealPeriods = plan?.meal_periods ?? []
  const agreedPrice = parseFloat(String(sub.agreed_monthly_price))

  const { data: pauseRows } = await admin
    .from('subscription_meal_pauses')
    .select('meal_period, pause_start, pause_end')
    .eq('subscription_id', subscriptionId)
  const pauses: MealPause[] = (pauseRows ?? []).map(p => ({
    meal_period: p.meal_period, pause_start: p.pause_start, pause_end: p.pause_end,
  }))

  const { data: settingsRow } = await admin.from('app_settings').select('vat_percent').eq('id', 1).single()
  const vatRate = parseFloat(String(settingsRow?.vat_percent ?? '5'))

  const windowEnd = sub.end_date ?? '9999-12-31'

  // No lower bound on billing_period_start: a start-date correction can move
  // start_date LATER than an already-issued invoice's period (e.g. fixing a
  // wrong early start date) — that invoice is exactly the one that now needs
  // reconciling (part of its billed period falls before the real start), so
  // it must not be filtered out here. calcSubscriptionCharge's own clamping
  // (clampedStart = max(subStart, rangeFrom)) already handles excluding the
  // pre-start days from the fresh amount correctly.
  const { data: invoiceRows } = await admin
    .from('invoices')
    .select('id, invoice_number, billing_period_start, billing_period_end, subtotal, discount_amount, tax_amount, total_amount, status')
    .eq('customer_id', sub.customer_id)
    .eq('invoice_type', 'fixed_monthly')
    .in('status', ['draft', 'issued', 'partial', 'paid'])
    .lte('billing_period_start', windowEnd)

  const invoices = (invoiceRows ?? []).filter(inv => inv.billing_period_start && inv.billing_period_end)
  const adjusted: { invoice_number: string; delta: number }[] = []

  for (const inv of invoices) {
    const periodStart = inv.billing_period_start as string
    const periodEnd = inv.billing_period_end as string

    const { data: items } = await admin
      .from('invoice_items')
      .select('description, total_price')
      .eq('invoice_id', inv.id)

    const planLine = (items ?? []).find(i => i.description.startsWith('Monthly Fixed Plan'))
    const originalAmount = planLine ? parseFloat(String(planLine.total_price)) : 0
    const usageLine = (items ?? []).find(i => i.description.startsWith('Extra items'))
    const originalInPlanUsage = usageLine ? parseFloat(String(usageLine.total_price)) : 0
    const originalOutOfPlan = (items ?? [])
      .filter(i => i.description.includes('outside plan'))
      .reduce((s, i) => s + parseFloat(String(i.total_price)), 0)
    const priorAdjustment = (items ?? [])
      .filter(i => i.description.startsWith('Proration adjustment'))
      .reduce((s, i) => s + parseFloat(String(i.total_price)), 0)

    const freshAmount = calcSubscriptionCharge({
      mealPeriods,
      agreedMonthlyPrice: agreedPrice,
      mealPrices: sub.meal_prices,
      subStart: sub.start_date,
      subEnd: sub.end_date,
      subStatus: sub.status,
      pauses,
      rangeFrom: periodStart,
      rangeTo: periodEnd,
      cycleDays: daySpan(periodStart, periodEnd),
    })

    let freshInPlanUsage = 0
    let freshOutOfPlan = 0
    if (customer?.customer_type === 'fixed_menu') {
      const { data: orders } = await admin
        .from('orders')
        .select('meal_period, order_date, total_amount')
        .eq('customer_id', sub.customer_id)
        .eq('is_credit', true)
        .not('order_status', 'in', '(cancelled,voided,draft)')
        .gte('order_date', periodStart)
        .lte('order_date', periodEnd)
      const coveredMeals = new Set(mealPeriods)
      for (const o of orders ?? []) {
        const amt = parseFloat(String(o.total_amount))
        if (coveredMeals.has(o.meal_period) && !isMealPausedOn(pauses, o.meal_period, o.order_date)) {
          freshInPlanUsage += amt
        } else {
          freshOutOfPlan += amt
        }
      }
    }

    const freshAmounts = computeFixedInvoiceAmounts(freshAmount, freshInPlanUsage, freshOutOfPlan, vatRate)
    const originalAmounts = computeFixedInvoiceAmounts(originalAmount, originalInPlanUsage, originalOutOfPlan, vatRate)

    const requiredDelta = Math.round(
      (parseFloat(freshAmounts.total_amount) - parseFloat(originalAmounts.total_amount) - priorAdjustment) * 100
    ) / 100
    if (Math.abs(requiredDelta) < 0.01) continue

    const { error: itemErr } = await admin.from('invoice_items').insert({
      invoice_id: inv.id,
      order_id: null,
      description: `Proration adjustment — ${reason} (owner-approved, ${todayDubai()})`,
      quantity: '1',
      unit_price: requiredDelta.toFixed(2),
      total_price: requiredDelta.toFixed(2),
    })
    if (itemErr) return { adjusted, error: itemErr.message }

    const taxDelta = (requiredDelta * vatRate) / (100 + vatRate)
    const { error: invErr } = await admin
      .from('invoices')
      .update({
        subtotal:     (parseFloat(String(inv.subtotal)) + requiredDelta).toFixed(2),
        tax_amount:   (parseFloat(String(inv.tax_amount)) + taxDelta).toFixed(2),
        total_amount: (parseFloat(String(inv.total_amount)) + requiredDelta).toFixed(2),
      })
      .eq('id', inv.id)
    if (invErr) return { adjusted, error: invErr.message }

    const { data: ledgerRow } = await admin
      .from('ledger_entries')
      .select('id, debit_amount')
      .eq('reference_table', 'invoices')
      .eq('reference_id', inv.id)
      .maybeSingle()
    if (ledgerRow) {
      await admin
        .from('ledger_entries')
        .update({ debit_amount: (parseFloat(String(ledgerRow.debit_amount)) + requiredDelta).toFixed(2) })
        .eq('id', ledgerRow.id)
    }

    await reconcileInvoicePaymentStatus(admin, inv.id)
    adjusted.push({ invoice_number: inv.invoice_number, delta: requiredDelta })
  }

  return { adjusted }
}
