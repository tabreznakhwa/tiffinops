import { createAdminClient } from '@/lib/supabase/admin'
import { computeFixedInvoiceAmounts, buildMultiPlanLineItems } from './fixedPlanInvoiceLines'
import type { GenerateResult } from './generateMonthlyInvoices'
import { calcSubscriptionCharge, isMealPausedOn, type MealPause } from '@/lib/fixed-menu/proration'

// A customer can hold more than one concurrent fixed plan at once (e.g. a
// separate Breakfast plan and a separate Dinner plan) — each is its own
// customer_subscriptions row, each with its own start_date and therefore its
// own anniversary day. The invoices table only supports ONE invoice per
// (customer, invoice_type, billing_period_start) — idx_invoices_idempotent
// enforces this at the DB level — so every plan whose cycle happens to start
// on the same day as another must be billed on the SAME invoice, one line
// item per plan. buildMultiPlanLineItems (in fixedPlanInvoiceLines.ts,
// shared with generateMonthlyInvoices' and
// generateFixedAnniversaryInvoices.ts's own multi-plan grouping) builds
// those combined line items.

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

  const prepaidActive = (subs ?? []).filter(s => {
    const customer = s.customers as unknown as { payment_terms?: string } | null
    return customer?.payment_terms === 'prepaid' && today >= s.start_date
  })

  if (prepaidActive.length === 0) {
    return { generated: 0, skipped: 0, referralRewardsGenerated: 0, errors: [], month: today }
  }

  // Each active prepaid subscription's own current cycle start — today for a
  // normal on-time run, or the most recent anniversary that already passed.
  // Computed for EVERY active prepaid sub (not just today's anniversaries) so
  // a cycle whose exact anniversary day the cron happened to miss still gets
  // picked up on the next run, instead of being silently skipped until the
  // following month. Keyed by SUBSCRIPTION id, not customer id: a customer can
  // hold more than one concurrent plan (e.g. separate Breakfast and Dinner
  // subscriptions) started on different dates, so their anniversary cycles
  // don't necessarily align. Keying by customer alone used to silently let one
  // plan's period clobber another's in this map — same bug class already found
  // and fixed in generateFixedAnniversaryInvoices.ts (see the
  // idx_invoices_idempotent multi-plan grouping there).
  const periodStartBySub = new Map<string, string>()
  for (const s of prepaidActive) {
    periodStartBySub.set(s.id, mostRecentAnniversaryOnOrBefore(s.start_date, today))
  }

  // periodEnd differs per subscription (depends on its own start day) — and
  // for a catch-up subscriber it's anchored to ITS OWN period start, not
  // today, so a stale cycle resolves to its own real end date instead of
  // jumping straight to next month's (which would silently swallow the gap).
  const periodEndBySub = new Map<string, string>()
  for (const s of prepaidActive) {
    const periodStart = periodStartBySub.get(s.id)!
    periodEndBySub.set(s.id, addDays(nextAnniversaryAfter(s.start_date, periodStart), -1))
  }

  // Every non-cancelled fixed_monthly invoice for these customers — used both
  // to skip a (customer, periodStart) already invoiced (idempotency for a same
  // day re-run) AND to skip a customer whose legacy calendar-month invoice
  // already covers the current cycle's start. That second guard stops a
  // mid-month start_date from re-billing days a calendar-month invoice already
  // collected — e.g. a customer migrated from the old calendar-month system
  // whose subscription start_date is the 3rd but whose last invoice ran the
  // 1st–30th.
  const { data: existingInvoices } = await admin
    .from('invoices')
    .select('customer_id, billing_period_start, billing_period_end')
    .eq('invoice_type', 'fixed_monthly')
    .neq('status', 'cancelled')
    .in('customer_id', prepaidActive.map(s => s.customer_id))

  const alreadyInvoiced = new Set(
    (existingInvoices ?? []).map(i => `${i.customer_id}|${i.billing_period_start}`)
  )
  const coveredThroughByCustomer = new Map<string, string>()
  for (const inv of existingInvoices ?? []) {
    if (!inv.customer_id || !inv.billing_period_end) continue
    const cur = coveredThroughByCustomer.get(inv.customer_id)
    if (!cur || inv.billing_period_end > cur) coveredThroughByCustomer.set(inv.customer_id, inv.billing_period_end)
  }

  const dueToday = prepaidActive.filter(s => {
    const periodStart = periodStartBySub.get(s.id)!
    if (alreadyInvoiced.has(`${s.customer_id}|${periodStart}`)) return false
    const coveredThrough = coveredThroughByCustomer.get(s.customer_id)
    if (coveredThrough && coveredThrough >= periodStart) return false
    return true
  })

  if (dueToday.length === 0) {
    return { generated: 0, skipped: 0, referralRewardsGenerated: 0, errors: [], month: today }
  }

  const furthestPeriodEnd = [...dueToday.map(s => periodEndBySub.get(s.id)!)].reduce((a, b) => (a > b ? a : b), today)
  // Earliest period start in this batch — a catch-up subscriber's cycle can
  // start well before today, so orders/pauses fetched below must reach back
  // that far too, not just from today.
  const earliestPeriodStart = [...dueToday.map(s => periodStartBySub.get(s.id)!)].reduce((a, b) => (a < b ? a : b), today)

  // fixed_menu AND hybrid customers pay a flat plan rate regardless of what
  // they order (from a meal period their plan covers) — fetch their credit
  // orders across today's batch so each invoice can show usage and net it
  // against the flat price. A plain a_la_carte customer who merely holds a
  // legacy subscription row gets no netting, same as before.
  const nettingCustomerIds = [...new Set(
    dueToday
      .map(s => {
        const c = s.customers as unknown as { customer_type?: string } | null
        return (c?.customer_type === 'fixed_menu' || c?.customer_type === 'hybrid') ? s.customer_id : null
      })
      .filter((x): x is string => !!x)
  )]

  type FixedOrderRow = { customer_id: string; order_date: string; meal_period: string; total_amount: string }
  const fixedOrders: FixedOrderRow[] = []
  if (nettingCustomerIds.length) {
    const PAGE = 1000
    let offset = 0
    while (true) {
      const { data } = await admin
        .from('orders')
        .select('customer_id, order_date, meal_period, total_amount')
        .in('customer_id', nettingCustomerIds)
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

  // Meal pauses overlapping any subscription's period in this batch — used
  // to prorate the flat plan rate for any meal a customer stopped mid-cycle.
  // Filtered per-subscription against that subscription's own periodEnd below.
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

  // A customer can hold more than one concurrent fixed plan. Group by
  // (customer, periodStart) so every plan whose cycle happens to start on
  // the same day lands on ONE invoice, matching idx_invoices_idempotent's
  // one-invoice-per-customer-per-period rule instead of colliding with it.
  type Group = { customerId: string; periodStart: string; periodEnd: string; members: typeof dueToday }
  const groupsByKey = new Map<string, Group>()
  for (const sub of dueToday) {
    const periodStart = periodStartBySub.get(sub.id)!
    const periodEnd   = periodEndBySub.get(sub.id)!
    const key = `${sub.customer_id}|${periodStart}`
    const g = groupsByKey.get(key)
    if (g) {
      g.members.push(sub)
      if (periodEnd > g.periodEnd) g.periodEnd = periodEnd
    } else {
      groupsByKey.set(key, { customerId: sub.customer_id, periodStart, periodEnd, members: [sub] })
    }
  }
  const groups = [...groupsByKey.values()]

  let generated = 0
  let skipped = 0
  const errors: string[] = []

  for (const group of groups) {
    const customer = group.members[0].customers as unknown as { full_name: string; customer_code: string; customer_type: string } | null

    if (alreadyInvoiced.has(`${group.customerId}|${group.periodStart}`)) {
      skipped++
      continue
    }

    // Compute each member plan's own charge independently — preserves
    // per-plan pricing, proration and pause handling exactly as if each were
    // billed alone — then combine. A member with no positive charge (bad
    // data) is dropped rather than sinking the whole group's invoice.
    const planCharges: { plan: { plan_name: string; meal_periods: string[] | null } | null; amount: number; prorationNote?: string; subPauses: MealPause[] }[] = []
    for (const sub of group.members) {
      const plan = sub.fixed_plans as unknown as { plan_name: string; meal_periods: string[] | null } | null
      const rawAmount = parseFloat(String(sub.agreed_monthly_price))
      if (!rawAmount || rawAmount <= 0) continue

      const subPeriodStart = periodStartBySub.get(sub.id)!
      const subPeriodEnd   = periodEndBySub.get(sub.id)!

      // Prorate the flat plan rate for any meal the customer stopped
      // mid-cycle (subscription_meal_pauses) — see lib/fixed-menu/proration.ts.
      // cycleDays is THIS plan's own anniversary cycle length — it's charged
      // in full at that fixed denominator regardless of which/how many
      // calendar months the cycle happens to cross, and only reduced when
      // the cycle itself is genuinely cut short (a pause, or subEnd
      // mid-cycle).
      const subPauses = pausesBySub.get(sub.id) ?? []
      const amount = calcSubscriptionCharge({
        mealPeriods:        plan?.meal_periods ?? [],
        agreedMonthlyPrice: rawAmount,
        mealPrices:         sub.meal_prices,
        subStart:           sub.start_date,
        subEnd:             sub.end_date,
        subStatus:          sub.status,
        pauses:             subPauses,
        rangeFrom:          subPeriodStart,
        rangeTo:            subPeriodEnd,
        cycleDays:          daySpan(subPeriodStart, subPeriodEnd),
      })
      planCharges.push({ plan, amount, prorationNote: prorationNoteFor(subPauses), subPauses })
    }

    const monthLabel = monthLabelFor(group.periodStart)
    const totalAmount = planCharges.reduce((s, p) => s + p.amount, 0)

    // Orders classify against the UNION of every plan's covered meals (a
    // dinner order is in-plan if ANY of the customer's plans covers dinner)
    // and against the union of every plan's own pauses.
    const coveredMeals = new Set(planCharges.flatMap(p => p.plan?.meal_periods ?? []))
    const allPauses = planCharges.flatMap(p => p.subPauses)
    let inPlanUsage = 0
    const outOfPlanExtras: Partial<Record<'breakfast' | 'lunch' | 'dinner', number>> = {}
    if (customer?.customer_type === 'fixed_menu' || customer?.customer_type === 'hybrid') {
      for (const o of fixedOrders) {
        if (o.customer_id !== group.customerId) continue
        if (o.order_date < group.periodStart || o.order_date > group.periodEnd) continue
        const amt = parseFloat(o.total_amount)
        if (coveredMeals.has(o.meal_period) && !isMealPausedOn(allPauses, o.meal_period, o.order_date)) {
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
    if (totalAmount <= 0 && outOfPlanTotal <= 0) {
      skipped++
      continue
    }

    const { data: invoiceNumber, error: numErr } = await admin.rpc('next_invoice_number')
    if (numErr || !invoiceNumber) {
      errors.push(`${customer?.full_name ?? group.customerId}: could not generate invoice number`)
      continue
    }

    const amounts = computeFixedInvoiceAmounts(totalAmount, inPlanUsage, outOfPlanTotal, vatRate)

    const { data: invoice, error: insertErr } = await admin
      .from('invoices')
      .insert({
        invoice_number:        invoiceNumber as string,
        customer_id:           group.customerId,
        invoice_date:          today,
        // prepaid — due on the cycle's own start date, no lead time. For a
        // normal on-time run periodStart === today; for a catch-up run
        // (see dueToday above) it's the real anniversary that already
        // passed, so the invoice correctly shows overdue immediately
        // instead of getting a fresh grace period just because today is
        // when it happened to be generated.
        due_date:              group.periodStart,
        invoice_type:          'fixed_monthly',
        billing_period_start:  group.periodStart,
        billing_period_end:    group.periodEnd,
        ...amounts,
        // Prepaid fixed-menu bills are a flat, agreed rate (with automatic
        // usage netting) and are due the moment their cycle starts — there is
        // nothing to review before charging. Issue immediately so the customer
        // sees a real bill (and a ledger debit) on their anniversary, instead
        // of an invisible draft that only ever gets issued if a manager
        // remembers to click "Issue" by hand. That manual step is exactly what
        // let bills pile up as drafts and show customers as "overdue" with no
        // bill behind them.
        status:                'issued',
        notes:                 null,
        created_by:            createdBy === 'system-cron' ? null : createdBy,
      })
      .select('id')
      .single()

    if (insertErr || !invoice) {
      errors.push(`${customer?.full_name ?? group.customerId}: ${insertErr?.message ?? 'insert failed'}`)
      continue
    }

    const lineItems = buildMultiPlanLineItems({
      invoiceId:  invoice.id,
      monthLabel,
      plans:      planCharges.map(p => ({ planName: p.plan?.plan_name ?? 'Fixed Plan', amount: p.amount, prorationNote: p.prorationNote })),
      inPlanUsage,
      outOfPlanExtras,
    })

    const { error: itemErr } = await admin.from('invoice_items').insert(lineItems)

    if (itemErr) {
      await admin.from('invoices').delete().eq('id', invoice.id)
      errors.push(`${customer?.full_name ?? group.customerId}: ${itemErr.message}`)
      continue
    }

    // The ledger debit that used to be created only at the manual "Issue"
    // step — created here so the issued invoice actually lands on the
    // customer's balance at generation time.
    const { error: ledgerErr } = await admin.from('ledger_entries').insert({
      customer_id:     group.customerId,
      entry_date:      today,
      entry_type:      'invoice',
      debit_amount:    amounts.total_amount,
      credit_amount:   '0.00',
      description:     `Invoice ${invoiceNumber}`,
      reference_table: 'invoices',
      reference_id:    invoice.id,
      created_by:      createdBy === 'system-cron' ? null : createdBy,
    })

    if (ledgerErr) {
      await admin.from('invoices').update({ status: 'draft' }).eq('id', invoice.id)
      errors.push(`${customer?.full_name ?? group.customerId}: ${ledgerErr.message}`)
      continue
    }

    generated++
  }

  // Referral rewards stay tied to the postpaid monthly cron (generateMonthlyInvoices) —
  // that's a once-a-month, calendar-month-scoped concept, unrelated to daily anniversary checks.
  return { generated, skipped, referralRewardsGenerated: 0, errors, month: today }
}
