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

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0')
}

// A customer's billing day within a given (year, month): the same
// day-of-month as their start_date, clamped to that month's length — a
// customer who started on the 31st bills on the 28th/29th in February and
// reverts to the 31st in a month that has one. Always re-derived from the
// original start_date, never chained off an already-clamped date.
function anniversaryDateForMonth(startDate: string, year: number, month: number): string {
  const startDay = Number(startDate.slice(8, 10))
  const day = Math.min(startDay, daysInMonth(year, month))
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`
}

// The smallest anniversary date strictly AFTER `from`. Unlike a simple
// "next month's anniversary", this checks THIS month's anniversary first —
// needed because `from` is often a bridging date partway through a month
// (e.g. the day after an old calendar-month invoice ended), not always an
// anniversary itself. Getting this wrong would skip a whole cycle.
function nextAnniversaryStrictlyAfter(startDate: string, from: string): string {
  let year  = Number(from.slice(0, 4))
  let month = Number(from.slice(5, 7))
  let candidate = anniversaryDateForMonth(startDate, year, month)
  if (candidate <= from) {
    month += 1
    if (month > 12) { month = 1; year += 1 }
    candidate = anniversaryDateForMonth(startDate, year, month)
  }
  return candidate
}

function addDays(date: string, n: number): string {
  const d = new Date(date + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function daySpan(from: string, to: string): number {
  const a = new Date(from + 'T00:00:00Z').getTime()
  const b = new Date(to + 'T00:00:00Z').getTime()
  return Math.round((b - a) / 86400000) + 1
}

function monthLabelFor(date: string): string {
  const [y, m] = date.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
}

export type FixedCycle = {
  customerId:  string
  periodStart: string
  periodEnd:   string
}

/**
 * Every elapsed-but-uninvoiced monthly cycle for one postpaid fixed
 * subscription, as of `today` — in arrears, so a cycle is only included
 * once it has fully ended (periodEnd < today). Anchored to `lastBilledThrough`
 * (the latest billing_period_end across ALL of the customer's non-cancelled
 * invoices, of any invoice_type — a manually-issued replacement invoice
 * counts as billed too) rather than blindly re-deriving from start_date, so
 * a customer transitioning off the old calendar-month system never has an
 * already-invoiced day re-billed. The very first post-transition cycle is
 * often a short "bridge" back onto the customer's own day-of-month; every
 * cycle after that is a normal full month on their anniversary.
 *
 * A subscription can be more than one cycle behind (e.g. never billed since
 * it started weeks ago) — this returns every elapsed cycle in order, capped
 * at 24 to guard against a bad date turning this into an infinite loop.
 */
export function pendingCyclesFor(
  startDate: string,
  subEnd: string | null,
  lastBilledThrough: string | null,
  today: string,
): FixedCycle[] {
  const cycles: FixedCycle[] = []
  let cycleStart = lastBilledThrough ? addDays(lastBilledThrough, 1) : startDate
  if (cycleStart < startDate) cycleStart = startDate

  for (let i = 0; i < 24; i++) {
    if (cycleStart > today) break
    if (subEnd && cycleStart > subEnd) break

    let cycleEnd = addDays(nextAnniversaryStrictlyAfter(startDate, cycleStart), -1)
    if (subEnd && subEnd < cycleEnd) cycleEnd = subEnd
    if (cycleEnd >= today) break // this cycle hasn't fully elapsed yet — bill it next run

    cycles.push({ customerId: '', periodStart: cycleStart, periodEnd: cycleEnd })
    cycleStart = addDays(cycleEnd, 1)
  }
  return cycles
}

/**
 * Generate draft fixed_monthly invoices for POSTPAID fixed_menu subscribers,
 * one per completed monthly cycle measured from their OWN start-date
 * anniversary — not a shared calendar month. A customer who joined on the
 * 16th bills the 16th of every month, in arrears (the invoice for the
 * 16th-to-15th cycle is generated once that cycle is over, i.e. on the next
 * 16th), same rule for every area including Mai Dubai.
 *
 * Meant to run daily. Each customer's next due cycle is derived from the
 * latest billing_period_end across their own non-cancelled invoices (any
 * invoice_type) so a customer with prior calendar-month invoices — every
 * existing postpaid fixed customer, from before this generator existed —
 * transitions cleanly: their next cycle picks up the day after whatever was
 * last actually billed, then self-realigns onto their own anniversary day
 * from there on, with no re-billed or skipped days.
 *
 * @param today      'YYYY-MM-DD', Dubai-local "today"
 * @param createdBy  auth user ID to stamp on each invoice (or 'system-cron')
 */
export async function generateFixedAnniversaryInvoices(
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
      customers(full_name, customer_code, payment_terms, customer_type, status)
    `)
    .eq('status', 'active')

  if (subsErr) return { generated: 0, skipped: 0, referralRewardsGenerated: 0, errors: [subsErr.message], month: today }

  // fixed_menu only — a handful of "hybrid" customers (customer_type
  // a_la_carte but with a flat-price subscription row) are deliberately left
  // to the old calendar-cycle generateMonthlyInvoices, unchanged, so this
  // doesn't touch a population it was never asked to.
  const postpaidSubs = (subs ?? []).filter(s => {
    const c = s.customers as unknown as { payment_terms?: string; status?: string; customer_type?: string } | null
    return c?.payment_terms === 'postpaid' && c?.customer_type === 'fixed_menu' && (c?.status === 'active' || c?.status === 'paused')
  })

  if (postpaidSubs.length === 0) {
    return { generated: 0, skipped: 0, referralRewardsGenerated: 0, errors: [], month: today }
  }

  // Latest non-cancelled billing_period_end per customer, across every
  // invoice type — a manually-issued replacement invoice (the Mai Dubai
  // workaround pattern) counts as billed exactly like a normal one.
  const { data: priorInvoices } = await admin
    .from('invoices')
    .select('customer_id, billing_period_end, status')
    .in('customer_id', postpaidSubs.map(s => s.customer_id))
    .not('billing_period_end', 'is', null)
    .neq('status', 'cancelled')

  const lastBilledThroughByCustomer = new Map<string, string>()
  for (const inv of priorInvoices ?? []) {
    if (!inv.customer_id || !inv.billing_period_end) continue
    const cur = lastBilledThroughByCustomer.get(inv.customer_id)
    if (!cur || inv.billing_period_end > cur) lastBilledThroughByCustomer.set(inv.customer_id, inv.billing_period_end)
  }

  // Every elapsed, uninvoiced cycle for every subscriber — usually zero or
  // one per customer per day, but a customer stuck without billing for a
  // while can owe several at once.
  type Due = { sub: typeof postpaidSubs[number]; periodStart: string; periodEnd: string }
  const due: Due[] = []
  for (const sub of postpaidSubs) {
    const lastThrough = lastBilledThroughByCustomer.get(sub.customer_id) ?? null
    const cycles = pendingCyclesFor(sub.start_date, sub.end_date, lastThrough, today)
    for (const c of cycles) due.push({ sub, periodStart: c.periodStart, periodEnd: c.periodEnd })
  }

  if (due.length === 0) {
    return { generated: 0, skipped: 0, referralRewardsGenerated: 0, errors: [], month: today }
  }

  const spanStart = due.reduce((a, d) => (d.periodStart < a ? d.periodStart : a), due[0].periodStart)
  const spanEnd    = due.reduce((a, d) => (d.periodEnd > a ? d.periodEnd : a), due[0].periodEnd)

  const fixedCustomerIds = [...new Set(
    postpaidSubs
      .filter(s => (s.customers as unknown as { customer_type?: string } | null)?.customer_type === 'fixed_menu')
      .map(s => s.customer_id)
  )]
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
        .gte('order_date', spanStart)
        .lte('order_date', spanEnd)
        .range(offset, offset + PAGE - 1)
      const batch = (data ?? []) as unknown as FixedOrderRow[]
      fixedOrders.push(...batch)
      if (batch.length < PAGE) break
      offset += PAGE
    }
  }

  const pausesBySub = new Map<string, MealPause[]>()
  const dueSubIds = [...new Set(due.map(d => d.sub.id))]
  if (dueSubIds.length) {
    const { data: pauseRows } = await admin
      .from('subscription_meal_pauses')
      .select('subscription_id, meal_period, pause_start, pause_end')
      .in('subscription_id', dueSubIds)
      .lte('pause_start', spanEnd)
      .or(`pause_end.is.null,pause_end.gte.${spanStart}`)
    for (const p of pauseRows ?? []) {
      const list = pausesBySub.get(p.subscription_id) ?? []
      list.push({ meal_period: p.meal_period, pause_start: p.pause_start, pause_end: p.pause_end })
      pausesBySub.set(p.subscription_id, list)
    }
  }

  // Idempotency — skip a (customer, periodStart) already invoiced (handles a
  // cron re-run the same day). Excludes cancelled invoices, same as
  // lastBilledThroughByCustomer above — a cancelled invoice (e.g. a
  // corrected/replaced one) must free its period up for regeneration, not
  // block it forever.
  const { data: existingInvoices } = await admin
    .from('invoices')
    .select('customer_id, billing_period_start')
    .eq('invoice_type', 'fixed_monthly')
    .neq('status', 'cancelled')
    .in('customer_id', due.map(d => d.sub.customer_id))
  const alreadyInvoiced = new Set(
    (existingInvoices ?? []).map(i => `${i.customer_id}|${i.billing_period_start}`)
  )

  let generated = 0
  let skipped = 0
  const errors: string[] = []

  for (const { sub, periodStart, periodEnd } of due) {
    const customer = sub.customers as unknown as { full_name: string; customer_code: string; customer_type: string } | null

    if (alreadyInvoiced.has(`${sub.customer_id}|${periodStart}`)) {
      skipped++
      continue
    }

    const plan = sub.fixed_plans as unknown as { plan_name: string; meal_periods: string[] | null } | null
    const rawAmount = parseFloat(String(sub.agreed_monthly_price))
    if (!rawAmount || rawAmount <= 0) {
      skipped++
      continue
    }

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
        due_date:              today, // postpaid, billed in arrears — due on generation, same as the old cycles
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

  return { generated, skipped, referralRewardsGenerated: 0, errors, month: today }
}
