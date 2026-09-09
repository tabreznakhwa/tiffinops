import { createAdminClient } from '@/lib/supabase/admin'
import { computeFixedInvoiceAmounts, buildFixedPlanLineItems } from './fixedPlanInvoiceLines'
import type { GenerateResult } from './generateMonthlyInvoices'
import { calcSubscriptionCharge, isMealPausedOn, type MealPause } from '@/lib/fixed-menu/proration'

// Human-readable note for the invoice line when a meal pause reduced the
// flat plan rate for this billing period — keeps the bill self-explanatory.
function prorationNoteFor(pauses: MealPause[]): string | undefined {
  if (!pauses.length) return undefined
  const label = (m: string) => m.charAt(0).toUpperCase() + m.slice(1)
  return pauses
    .map(p => `${label(p.meal_period)} paused ${p.pause_start}${p.pause_end ? ` to ${p.pause_end}` : ' onward'}`)
    .join('; ')
}

// Days in a given calendar month (month is 1-based, matching 'YYYY-MM-DD').
function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0')
}

/**
 * A customer's billing day within a given (year, month): the same
 * day-of-month as their start_date, clamped to that month's length. A
 * customer who started on the 31st bills on the 28th/29th in February, and
 * reverts to the 31st in a month that has one — the day is always re-derived
 * from the original start_date, never chained off an already-clamped date.
 */
function anniversaryDateForMonth(startDate: string, year: number, month: number): string {
  const startDay = Number(startDate.slice(8, 10))
  const day = Math.min(startDay, daysInMonth(year, month))
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`
}

// The following month's anniversary date for this subscription.
function nextAnniversaryAfter(startDate: string, from: string): string {
  let year  = Number(from.slice(0, 4))
  let month = Number(from.slice(5, 7)) + 1
  if (month > 12) { month = 1; year += 1 }
  return anniversaryDateForMonth(startDate, year, month)
}

// The most recent anniversary date <= `today` for a subscription starting on
// `startDate` — `today` itself when today is the anniversary, otherwise the
// closest one before it (never earlier than startDate). Used for the
// catch-up path below: a subscriber whose exact anniversary day already
// passed this month with no invoice yet still needs to be billed for THAT
// cycle, not a fresh one starting today.
function mostRecentAnniversaryOnOrBefore(startDate: string, today: string): string {
  let year  = Number(today.slice(0, 4))
  let month = Number(today.slice(5, 7))
  let candidate = anniversaryDateForMonth(startDate, year, month)
  if (candidate > today) {
    month -= 1
    if (month < 1) { month = 12; year -= 1 }
    candidate = anniversaryDateForMonth(startDate, year, month)
  }
  return candidate < startDate ? startDate : candidate
}

function addDays(date: string, n: number): string {
  const d = new Date(date + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

// Inclusive day count between two 'YYYY-MM-DD' dates.
function daySpan(from: string, to: string): number {
  const a = new Date(from + 'T00:00:00Z').getTime()
  const b = new Date(to + 'T00:00:00Z').getTime()
  return Math.round((b - a) / 86400000) + 1
}

function monthLabelFor(date: string): string {
  const [y, m] = date.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
}

/**
 * Generate draft fixed_monthly invoices for PREPAID subscribers who are due:
 * either their billing anniversary (the day-of-month they started on) falls
 * on `today`, OR they have never had a single fixed_monthly invoice
 * generated for them at all (catch-up — see below). Meant to run daily —
 * most days this processes an empty or near-empty batch, since each
 * customer is normally only due once a month, on their own start-date
 * anniversary.
 *
 * Each invoice is due the same day its own billing period starts (prepaid =
 * pay in advance, no lead-time notice) and covers the period from that
 * period start through the day before the customer's next anniversary.
 * For a normal on-time run the period start is `today`; for a catch-up run
 * it's the most recent anniversary that already passed with no invoice ever
 * generated, so the invoice correctly shows overdue immediately instead of
 * getting a fresh grace period just because today is when it happened to be
 * generated.
 *
 * Catch-up rationale: a subscription row created (or backdated) after its
 * own anniversary day has already passed this month is invisible to the
 * exact-day check alone — it wouldn't be picked up again until next month's
 * anniversary, silently skipping an entire cycle of billing even though the
 * customer is actively being served. The catch-up check only fires for
 * customers with ZERO fixed_monthly invoices ever, so it never touches
 * existing prepaid customers already invoiced under the old shared
 * calendar-month cycle (see scripts/audit-prepaid-missing-invoices.ts, which
 * confirmed no false positives under this narrower definition).
 *
 * @param today      'YYYY-MM-DD', Dubai-local "today" (or an override for a missed/manual run)
 * @param createdBy  auth user ID to stamp on each invoice (or 'system-cron')
 */
export async function generatePrepaidAnniversaryInvoices(
  today: string,
  createdBy: string,
): Promise<GenerateResult> {
  const admin = createAdminClient()

  const { data: settingsRow } = await admin
    .from('app_settings').select('vat_percent').eq('id', 1).single()
  const vatRate = parseFloat(String(settingsRow?.vat_percent ?? '5'))

  const { data: subs, error: subsErr } = await admin
    .from('customer_subscriptions')
    .select(`
      id,
      customer_id,
      start_date,
      end_date,
      status,
      agreed_monthly_price,
      meal_prices,
      fixed_plan_id,
      fixed_plans(plan_name, meal_periods),
      customers(full_name, customer_code, payment_terms, customer_type)
    `)
    .eq('status', 'active')

  if (subsErr) return { generated: 0, skipped: 0, referralRewardsGenerated: 0, errors: [subsErr.message], month: today }

  const todayYear  = Number(today.slice(0, 4))
  const todayMonth = Number(today.slice(5, 7))

  const prepaidActive = (subs ?? []).filter(s => {
    const customer = s.customers as unknown as { payment_terms?: string } | null
    return customer?.payment_terms === 'prepaid' && today >= s.start_date
  })

  // Catch-up: a subscriber who has NEVER been invoiced at all, even though
  // their cycle already started, is due today regardless of whether today
  // happens to be their exact anniversary day-of-month. Without this, a
  // subscription created a few days after its stated start_date (late data
  // entry, or a backdated start) silently misses its entire first cycle —
  // the exact-day check below wouldn't fire again until next month. See
  // scripts/audit-prepaid-missing-invoices.ts (found 8 real customers stuck
  // this way — up to 25 days overdue with zero invoices ever generated).
  const { data: everInvoicedRows } = prepaidActive.length
    ? await admin
        .from('invoices')
        .select('customer_id')
        .eq('invoice_type', 'fixed_monthly')
        .in('customer_id', prepaidActive.map(s => s.customer_id))
    : { data: [] }
  const everInvoiced = new Set((everInvoicedRows ?? []).map(r => r.customer_id))

  const dueToday = prepaidActive.filter(s =>
    anniversaryDateForMonth(s.start_date, todayYear, todayMonth) === today || !everInvoiced.has(s.customer_id)
  )

  if (dueToday.length === 0) {
    return { generated: 0, skipped: 0, referralRewardsGenerated: 0, errors: [], month: today }
  }

  // Each due subscriber's own current cycle start — today for a normal
  // on-time run, or (catch-up) the most recent anniversary already passed.
  // Never assume it's `today`: that's only true in the normal case.
  const periodStartByCustomer = new Map<string, string>()
  for (const s of dueToday) {
    periodStartByCustomer.set(s.customer_id, mostRecentAnniversaryOnOrBefore(s.start_date, today))
  }

  // Fixed-menu customers pay a flat plan rate regardless of what they order —
  // fetch their credit orders across today's batch (each customer's own
  // period, but they all start today) so each invoice can show usage.
  const fixedCustomerIds = dueToday
    .map(s => (s.customers as unknown as { customer_type?: string } | null)?.customer_type === 'fixed_menu' ? s.customer_id : null)
    .filter((x): x is string => !!x)

  // periodEnd differs per customer (depends on their own start day) — and for
  // a catch-up subscriber it's anchored to THEIR period start, not today, so
  // a stale cycle resolves to its own real end date instead of jumping
  // straight to next month's (which would silently swallow the gap).
  const periodEndByCustomer = new Map<string, string>()
  for (const s of dueToday) {
    const periodStart = periodStartByCustomer.get(s.customer_id)!
    periodEndByCustomer.set(s.customer_id, addDays(nextAnniversaryAfter(s.start_date, periodStart), -1))
  }
  const furthestPeriodEnd = [...periodEndByCustomer.values()].reduce((a, b) => (a > b ? a : b), today)
  // Earliest period start in this batch — a catch-up subscriber's cycle can
  // start well before today, so orders/pauses fetched below must reach back
  // that far too, not just from today.
  const earliestPeriodStart = [...periodStartByCustomer.values()].reduce((a, b) => (a < b ? a : b), today)

  type FixedOrderRow = { customer_id: string; order_date: string; meal_period: string; total_amount: string }
  const fixedOrders: FixedOrderRow[] = []
  if (fixedCustomerIds.length) {
    const PAGE = 1000
    let offset = 0
    while (true) {
      const { data } = await admin
        .from('orders')
        .select('customer_id, order_date, meal_period, total_amount')
        .in('customer_id', fixedCustomerIds)
        .eq('is_credit', true)
        .not('order_status', 'in', '(cancelled,voided,draft)')
        .gte('order_date', earliestPeriodStart)
        .lte('order_date', furthestPeriodEnd)
        .range(offset, offset + PAGE - 1)
      const batch = (data ?? []) as unknown as FixedOrderRow[]
      fixedOrders.push(...batch)
      if (batch.length < PAGE) break
      offset += PAGE
    }
  }

  // Meal pauses overlapping any customer's period in this batch — used to
  // prorate the flat plan rate for any meal a customer stopped mid-cycle.
  // Filtered per-subscription against that customer's own periodEnd below.
  const pausesBySub = new Map<string, MealPause[]>()
  const dueTodaySubIds = dueToday.map(s => s.id)
  if (dueTodaySubIds.length) {
    const { data: pauseRows } = await admin
      .from('subscription_meal_pauses')
      .select('subscription_id, meal_period, pause_start, pause_end')
      .in('subscription_id', dueTodaySubIds)
      .lte('pause_start', furthestPeriodEnd)
      .or(`pause_end.is.null,pause_end.gte.${earliestPeriodStart}`)
    for (const p of pauseRows ?? []) {
      const list = pausesBySub.get(p.subscription_id) ?? []
      list.push({ meal_period: p.meal_period, pause_start: p.pause_start, pause_end: p.pause_end })
      pausesBySub.set(p.subscription_id, list)
    }
  }

  // Idempotency — skip anyone who already has a fixed_monthly invoice for
  // their own period start (handles a cron re-run on the same day; period
  // start varies per customer now, so this can't just check `today`).
  const distinctPeriodStarts = [...new Set(periodStartByCustomer.values())]
  const { data: existingInvoices } = await admin
    .from('invoices')
    .select('customer_id, billing_period_start')
    .eq('invoice_type', 'fixed_monthly')
    .in('billing_period_start', distinctPeriodStarts)
    .in('customer_id', dueToday.map(s => s.customer_id))

  const alreadyInvoiced = new Set(
    (existingInvoices ?? [])
      .filter(i => periodStartByCustomer.get(i.customer_id) === i.billing_period_start)
      .map(i => i.customer_id)
  )

  let generated = 0
  let skipped = 0
  const errors: string[] = []

  for (const sub of dueToday) {
    const customer = sub.customers as unknown as { full_name: string; customer_code: string; customer_type: string } | null

    if (alreadyInvoiced.has(sub.customer_id)) {
      skipped++
      continue
    }

    const plan = sub.fixed_plans as unknown as { plan_name: string; meal_periods: string[] | null } | null

    const rawAmount = parseFloat(String(sub.agreed_monthly_price))
    if (!rawAmount || rawAmount <= 0) {
      skipped++
      continue
    }

    const periodEnd = periodEndByCustomer.get(sub.customer_id)!
    const periodStart = periodStartByCustomer.get(sub.customer_id)!

    // Prorate the flat plan rate for any meal the customer stopped mid-cycle
    // (subscription_meal_pauses) — see lib/fixed-menu/proration.ts. cycleDays
    // is this customer's own anniversary cycle length (periodStart →
    // periodEnd) — it's charged in full at that fixed denominator regardless
    // of which/how many calendar months the cycle happens to cross, and only
    // reduced when the cycle itself is genuinely cut short (a pause, or
    // subEnd mid-cycle). periodStart is today for a normal on-time run, or
    // (catch-up) the real anniversary that already passed.
    const subPauses = pausesBySub.get(sub.id) ?? []
    const amount = calcSubscriptionCharge({
      mealPeriods:        plan?.meal_periods ?? [],
      agreedMonthlyPrice: rawAmount,
      mealPrices:         sub.meal_prices,
      subStart:           sub.start_date,
      subEnd:             sub.end_date,
      subStatus:          sub.status,
      pauses:             subPauses,
      rangeFrom:          periodStart,
      rangeTo:            periodEnd,
      cycleDays:          daySpan(periodStart, periodEnd),
    })
    const prorationNote = prorationNoteFor(subPauses)
    const monthLabel = monthLabelFor(periodStart)

    // Orders from a meal period the plan covers are "usage" absorbed by a
    // matching discount; orders from a meal period the plan does NOT cover
    // are genuine extras and are billed in full.
    const coveredMeals = new Set(plan?.meal_periods ?? [])
    let inPlanUsage = 0
    const outOfPlanExtras: Partial<Record<'breakfast' | 'lunch' | 'dinner', number>> = {}
    if (customer?.customer_type === 'fixed_menu') {
      for (const o of fixedOrders) {
        if (o.customer_id !== sub.customer_id) continue
        if (o.order_date < periodStart || o.order_date > periodEnd) continue
        const amt = parseFloat(o.total_amount)
        if (coveredMeals.has(o.meal_period) && !isMealPausedOn(subPauses, o.meal_period, o.order_date)) {
          inPlanUsage += amt
        } else {
          const key = o.meal_period as 'breakfast' | 'lunch' | 'dinner'
          outOfPlanExtras[key] = (outOfPlanExtras[key] ?? 0) + amt
        }
      }
    }
    const outOfPlanTotal = Object.values(outOfPlanExtras).reduce((s, v) => s + (v ?? 0), 0)

    // A meal pause covering the whole period can bring the prorated plan
    // charge to zero — skip only if there's truly nothing to bill.
    if (amount <= 0 && outOfPlanTotal <= 0) {
      skipped++
      continue
    }

    const { data: invoiceNumber, error: numErr } = await admin.rpc('next_invoice_number')
    if (numErr || !invoiceNumber) {
      errors.push(`${customer?.full_name ?? sub.customer_id}: could not generate invoice number`)
      continue
    }

    const { data: invoice, error: insertErr } = await admin
      .from('invoices')
      .insert({
        invoice_number:        invoiceNumber as string,
        customer_id:           sub.customer_id,
        invoice_date:          today,
        // prepaid — due on the cycle's own start date, no lead time. For a
        // normal on-time run periodStart === today; for a catch-up run
        // (see dueToday above) it's the real anniversary that already
        // passed, so the invoice correctly shows overdue immediately
        // instead of getting a fresh grace period just because today is
        // when it happened to be generated.
        due_date:              periodStart,
        invoice_type:          'fixed_monthly',
        billing_period_start:  periodStart,
        billing_period_end:    periodEnd,
        ...computeFixedInvoiceAmounts(amount, inPlanUsage, outOfPlanTotal, vatRate),
        status:                'draft',
        notes:                 null,
        created_by:            createdBy === 'system-cron' ? null : createdBy,
      })
      .select('id')
      .single()

    if (insertErr || !invoice) {
      errors.push(`${customer?.full_name ?? sub.customer_id}: ${insertErr?.message ?? 'insert failed'}`)
      continue
    }

    const lineItems = buildFixedPlanLineItems({
      invoiceId: invoice.id,
      planName:  plan?.plan_name ?? 'Fixed Plan',
      monthLabel,
      amount,
      inPlanUsage,
      outOfPlanExtras,
      prorationNote,
    })

    const { error: itemErr } = await admin.from('invoice_items').insert(lineItems)

    if (itemErr) {
      await admin.from('invoices').delete().eq('id', invoice.id)
      errors.push(`${customer?.full_name ?? sub.customer_id}: ${itemErr.message}`)
      continue
    }

    generated++
  }

  // Referral rewards stay tied to the postpaid monthly cron (generateMonthlyInvoices) —
  // that's a once-a-month, calendar-month-scoped concept, unrelated to daily anniversary checks.
  return { generated, skipped, referralRewardsGenerated: 0, errors, month: today }
}
