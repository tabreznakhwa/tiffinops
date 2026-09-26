import { createAdminClient } from '@/lib/supabase/admin'
import { formatInTimeZone } from 'date-fns-tz'
import { computeFixedInvoiceAmounts, buildMultiPlanLineItems } from './fixedPlanInvoiceLines'
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

export type GenerateResult = {
  generated: number
  skipped: number
  referralRewardsGenerated: number
  errors: string[]
  month: string
}

// Returns YYYY-MM-DD for first and last day of the given month
function monthBounds(yyyyMM: string): { start: string; end: string } {
  const [y, m] = yyyyMM.split('-').map(Number)
  const start = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-01`
  const lastDay = new Date(y, m, 0).getDate()
  const end   = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
  return { start, end }
}

function monthLabelFor(yyyyMM: string): string {
  const [y, m] = yyyyMM.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
}

// Advance one month: '2026-06' → '2026-07'
export function nextMonth(yyyyMM: string): string {
  const [y, m] = yyyyMM.split('-').map(Number)
  const d = new Date(y, m, 1) // 1st of next month
  return formatInTimeZone(d, 'Asia/Dubai', 'yyyy-MM')
}

// Go back one month: '2026-07' → '2026-06'
export function prevMonth(yyyyMM: string): string {
  const [y, m] = yyyyMM.split('-').map(Number)
  const d = new Date(y, m - 2, 1) // 1st of previous month
  return formatInTimeZone(d, 'Asia/Dubai', 'yyyy-MM')
}

// Inclusive day count between two 'YYYY-MM-DD' dates — passed to
// calcSubscriptionCharge as `cycleDays` so a flat plan price is prorated
// against its OWN cycle's real length rather than fragmented calendar-month
// by calendar-month. For the plain calendar-month cycle this is a no-op
// (periodStart/periodEnd already bound exactly one month, so the fragment
// and whole-cycle math agree). For Mai Dubai's 26-of-prev→25-of-target
// cycle — which always straddles two calendar months of possibly different
// lengths — fragmenting by month over/under-charges a customer active the
// whole cycle (e.g. 6 days of a 31-day month + 25 days of a 30-day month
// sums to ~102.7% of the flat price, not 100%). Whole-cycle proration keeps
// a fully-active cycle exactly at the agreed flat price, and only a
// genuinely partial cycle (mid-cycle join, pause, or early end) is charged
// less, in proportion to the cycle's own length — matching "fixed means
// fixed" for every customer, Mai Dubai included.
function daySpan(from: string, to: string): number {
  const a = new Date(from + 'T00:00:00Z').getTime()
  const b = new Date(to + 'T00:00:00Z').getTime()
  return Math.round((b - a) / 86400000) + 1
}

// Mai Dubai customers' bills must be ready by the 26th (their salaries land
// on the 27th), so their cycle is 26th-of-prev-month → 25th-of-targetMonth —
// the same cycle generateAlaCarteInvoices() uses — which is always fully
// elapsed by the time the 26th cron runs. This is the SHARED cycle for
// EVERY Mai Dubai customer regardless of type (à la carte, hybrid, or fixed
// plan) — a Mai Dubai fixed customer who joins mid-cycle (e.g. the 15th)
// still bills on the next 25/26, just prorated for the partial first
// period, never on their own individual anniversary date. Every other area
// keeps the plain calendar-month cycle, unchanged.
const MAI_DUBAI_AREA = 'Mai Dubai'

/**
 * Generate draft fixed_monthly invoices for active POSTPAID subscribers with
 * a flat-price plan (customer_subscriptions row) who bill on a SHARED cycle
 * rather than their own individual anniversary date:
 *
 *   - Mai Dubai customers (area === 'Mai Dubai'), EVERY customer_type
 *     (fixed_menu, hybrid, and any a_la_carte-with-subscription row): billed
 *     2026-07-26..2026-08-25, due 2026-08-25 — complete and ready before the
 *     27th salary date. Fixed-plan customers here are prorated for a
 *     mid-cycle join/pause/end but otherwise billed the flat agreed price,
 *     same as everywhere else.
 *   - Everyone else (non-fixed_menu only — local fixed_menu customers bill
 *     on their own anniversary via generateFixedAnniversaryInvoices.ts
 *     instead): billed the calendar month 2026-08-01..2026-08-31, due
 *     2026-09-01, unchanged from before.
 *
 * A customer can hold more than one concurrent fixed plan (e.g. a separate
 * Breakfast plan and a separate Dinner plan, each its own
 * customer_subscriptions row) — idx_invoices_idempotent only allows one
 * invoice per (customer, invoice_type, billing_period_start), so cycles are
 * grouped per (customer, periodStart) and combined onto one multi-line
 * invoice via buildMultiPlanLineItems, same pattern as
 * generateFixedAnniversaryInvoices.ts.
 *
 * fixed_menu and hybrid customers pay their flat plan rate regardless of
 * usage — orders in a meal period their plan covers net to zero against the
 * flat price (shown as usage + matching discount); orders in a meal period
 * NOT covered are genuine extras, billed in full on top.
 *
 * Prepaid subscribers are billed on their own anniversary date instead — see
 * generatePrepaidInvoices.ts — since a shared cycle leaves the days between
 * a mid-cycle start and the next cycle boundary unbilled.
 *
 * @param targetMonth  'YYYY-MM' of the month being closed (defaults to current Dubai month)
 * @param createdBy    auth user ID to stamp on each invoice
 * @param options.onlyArea  restrict this run to customers in a single area
 *   (e.g. 'Mai Dubai') — for a manual backfill of one area without touching
 *   every other postpaid customer in the same pass. Omit for the normal
 *   full-system run (what the cron job and the "Generate" button use).
 */
export async function generateMonthlyInvoices(
  targetMonth: string,
  createdBy: string,
  options?: { onlyArea?: string },
): Promise<GenerateResult> {
  const admin = createAdminClient()

  // Fetch VAT rate from settings
  const { data: settingsRow } = await admin
    .from('app_settings').select('vat_percent, invoice_prefix').eq('id', 1).single()
  const vatRate = parseFloat(String(settingsRow?.vat_percent ?? '5'))

  // All active subscriptions with plan + customer details
  const { data: subs, error: subsErr } = await admin
    .from('customer_subscriptions')
    .select(`
      id,
      customer_id,
      agreed_monthly_price,
      meal_prices,
      start_date,
      end_date,
      status,
      fixed_plan_id,
      fixed_plans(plan_name, meal_periods),
      customers(full_name, customer_code, payment_terms, customer_type, area)
    `)
    .eq('status', 'active')

  if (subsErr) return { generated: 0, skipped: 0, referralRewardsGenerated: 0, errors: [subsErr.message], month: targetMonth }

  // Postpaid only — prepaid is billed on each customer's own anniversary
  // date. Mai Dubai's fixed_menu customers belong here (the shared 25/26
  // cycle, per MAI_DUBAI_AREA above); every other area's fixed_menu
  // customers are handled by generateFixedAnniversaryInvoices instead (each
  // billed on their own subscription-start anniversary). Every other
  // customer_type with a flat-price subscription row ("hybrid") lands here
  // regardless of area, unchanged.
  const postpaidSubs = (subs ?? []).filter(s => {
    const c = s.customers as unknown as { payment_terms?: string; customer_type?: string; area?: string | null } | null
    if (c?.payment_terms !== 'postpaid') return false
    if (options?.onlyArea && c?.area !== options.onlyArea) return false
    if (c?.customer_type === 'fixed_menu') return c?.area === MAI_DUBAI_AREA
    return true
  })

  // Two candidate cycles — see MAI_DUBAI_AREA comment above. Every
  // per-customer amount below is computed against whichever one applies.
  const [ty, tm] = targetMonth.split('-').map(Number)
  const prevYear   = tm === 1 ? ty - 1 : ty
  const prevMon    = tm === 1 ? 12 : tm - 1
  const prevMonStr = prevMon < 10 ? `0${prevMon}` : `${prevMon}`
  const maiDubaiPeriodStart = `${prevYear}-${prevMonStr}-26`
  const maiDubaiPeriodEnd   = `${targetMonth}-25`
  const maiDubaiDueDate     = maiDubaiPeriodEnd
  const maiDubaiMonthLabel  = monthLabelFor(targetMonth)

  const calendar = monthBounds(targetMonth)
  const otherPeriodStart = calendar.start
  const otherPeriodEnd   = calendar.end
  const otherDueDate     = monthBounds(nextMonth(targetMonth)).start
  const otherMonthLabel  = monthLabelFor(targetMonth)

  function cycleFor(area: string | null | undefined) {
    return area === MAI_DUBAI_AREA
      ? { periodStart: maiDubaiPeriodStart, periodEnd: maiDubaiPeriodEnd, dueDate: maiDubaiDueDate, monthLabel: maiDubaiMonthLabel }
      : { periodStart: otherPeriodStart, periodEnd: otherPeriodEnd, dueDate: otherDueDate, monthLabel: otherMonthLabel }
  }

  // Widest span across both cycles — used to fetch orders/pauses once; each
  // customer is then filtered down to their own cycle's bounds below.
  const spanStart = maiDubaiPeriodStart < otherPeriodStart ? maiDubaiPeriodStart : otherPeriodStart
  const spanEnd    = maiDubaiPeriodEnd > otherPeriodEnd ? maiDubaiPeriodEnd : otherPeriodEnd

  // fixed_menu AND hybrid customers pay a flat plan rate regardless of what
  // they order (from a meal period their plan covers), so their invoice
  // shows the order usage + a matching "fixed-plan discount" line and always
  // nets out to the agreed flat price for that portion. A plain
  // a_la_carte-type customer who merely holds a legacy subscription row gets
  // no netting — just the single plan line, same as before. Fetch credit
  // orders for the billing period once so each netted invoice can display
  // its usage.
  const nettingCustomerIds = [...new Set(
    postpaidSubs
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
        .gte('order_date', spanStart)
        .lte('order_date', spanEnd)
        .range(offset, offset + PAGE - 1)
      const batch = (data ?? []) as unknown as FixedOrderRow[]
      fixedOrders.push(...batch)
      if (batch.length < PAGE) break
      offset += PAGE
    }
  }

  // Meal pauses overlapping this billing period, per subscription — used to
  // prorate the flat plan rate for any meal a customer stopped mid-cycle.
  const pausesBySub = new Map<string, MealPause[]>()
  const postpaidSubIds = postpaidSubs.map(s => s.id)
  if (postpaidSubIds.length) {
    const { data: pauseRows } = await admin
      .from('subscription_meal_pauses')
      .select('subscription_id, meal_period, pause_start, pause_end')
      .in('subscription_id', postpaidSubIds)
      .lte('pause_start', spanEnd)
      .or(`pause_end.is.null,pause_end.gte.${spanStart}`)
    for (const p of pauseRows ?? []) {
      const list = pausesBySub.get(p.subscription_id) ?? []
      list.push({ meal_period: p.meal_period, pause_start: p.pause_start, pause_end: p.pause_end })
      pausesBySub.set(p.subscription_id, list)
    }
  }

  // Fetch existing invoices for either cycle's period start to skip
  // duplicates — keyed by customer+period since the two areas use different
  // period starts for the same targetMonth.
  const { data: existingInvoices } = await admin
    .from('invoices')
    .select('customer_id, billing_period_start')
    .eq('invoice_type', 'fixed_monthly')
    .in('billing_period_start', [maiDubaiPeriodStart, otherPeriodStart])

  const alreadyInvoiced = new Set(
    (existingInvoices ?? []).map((i) => `${i.customer_id}|${i.billing_period_start}`)
  )

  let generated = 0
  let skipped = 0
  let referralRewardsGenerated = 0
  const errors: string[] = []

  const { data: rewardsCount, error: rewardsErr } = await admin.rpc(
    'generate_referral_rewards_for_month',
    { p_month: monthBounds(targetMonth).start },
  )
  if (rewardsErr) {
    errors.push(`Referral rewards: ${rewardsErr.message}`)
  } else {
    referralRewardsGenerated = rewardsCount ?? 0
  }

  // A customer can hold more than one concurrent fixed plan (separate
  // customer_subscriptions rows — e.g. a Breakfast plan and a Dinner plan).
  // Group by (customer, periodStart) so every plan whose cycle shares that
  // start date lands on ONE invoice, matching idx_invoices_idempotent's
  // one-invoice-per-customer-per-period rule instead of colliding with it.
  type Group = {
    customerId: string
    periodStart: string
    periodEnd: string
    dueDate: string
    monthLabel: string
    members: typeof postpaidSubs
  }
  const groupsByKey = new Map<string, Group>()
  for (const sub of postpaidSubs) {
    const customer = sub.customers as unknown as { area?: string | null } | null
    const { periodStart, periodEnd, dueDate, monthLabel } = cycleFor(customer?.area)
    const key = `${sub.customer_id}|${periodStart}`
    const g = groupsByKey.get(key)
    if (g) {
      g.members.push(sub)
    } else {
      groupsByKey.set(key, { customerId: sub.customer_id, periodStart, periodEnd, dueDate, monthLabel, members: [sub] })
    }
  }
  const groups = [...groupsByKey.values()]

  for (const group of groups) {
    const customer = group.members[0].customers as unknown as { full_name: string; customer_code: string; customer_type: string; area: string | null } | null

    if (alreadyInvoiced.has(`${group.customerId}|${group.periodStart}`)) {
      skipped++
      continue
    }

    const cycleDays = daySpan(group.periodStart, group.periodEnd)

    // Compute each member plan's own charge independently — preserves
    // per-plan pricing, proration and pause handling exactly as if each were
    // billed alone — then combine. A member with no positive charge (bad
    // data) is dropped rather than sinking the whole group's invoice.
    const planCharges: { plan: { plan_name: string; meal_periods: string[] | null } | null; amount: number; prorationNote?: string; subPauses: MealPause[] }[] = []
    for (const sub of group.members) {
      const plan = sub.fixed_plans as unknown as { plan_name: string; meal_periods: string[] | null } | null
      const rawAmount = parseFloat(String(sub.agreed_monthly_price))
      if (!rawAmount || rawAmount <= 0) continue

      // Prorate the flat plan rate for any meal the customer stopped
      // mid-cycle (subscription_meal_pauses), or for a mid-cycle
      // join/end — see lib/fixed-menu/proration.ts. cycleDays is this
      // cycle's own real length (periodStart → periodEnd), so an
      // uninterrupted cycle always bills the flat agreedMonthlyPrice
      // regardless of which/how many calendar months it crosses.
      const subPauses = pausesBySub.get(sub.id) ?? []
      const amount = calcSubscriptionCharge({
        mealPeriods:        plan?.meal_periods ?? [],
        agreedMonthlyPrice: rawAmount,
        mealPrices:         sub.meal_prices,
        subStart:           sub.start_date,
        subEnd:             sub.end_date,
        subStatus:          sub.status,
        pauses:             subPauses,
        rangeFrom:          group.periodStart,
        rangeTo:            group.periodEnd,
        cycleDays,
      })
      planCharges.push({ plan, amount, prorationNote: prorationNoteFor(subPauses), subPauses })
    }

    const totalAmount = planCharges.reduce((s, p) => s + p.amount, 0)

    // Extra credit orders this customer placed in their billing period. For
    // a fixed_menu or hybrid customer, orders from a meal period ANY of
    // their plans covers are "usage" absorbed by a matching discount; orders
    // from a meal period no plan covers are genuine extras and are billed in
    // full.
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

    // Generate invoice number
    const { data: invoiceNumber, error: numErr } = await admin.rpc('next_invoice_number')
    if (numErr || !invoiceNumber) {
      errors.push(`${customer?.full_name ?? group.customerId}: could not generate invoice number`)
      continue
    }

    const today = formatInTimeZone(new Date(), 'Asia/Dubai', 'yyyy-MM-dd')
    const amounts = computeFixedInvoiceAmounts(totalAmount, inPlanUsage, outOfPlanTotal, vatRate)

    const { data: invoice, error: insertErr } = await admin
      .from('invoices')
      .insert({
        invoice_number:        invoiceNumber as string,
        customer_id:           group.customerId,
        invoice_date:          today,
        due_date:              group.dueDate,
        invoice_type:          'fixed_monthly',
        billing_period_start:  group.periodStart,
        billing_period_end:    group.periodEnd,
        ...amounts,
        // Fixed-menu bills are a flat, agreed rate (with automatic usage
        // netting) for a cycle that has already fully ended — nothing to
        // review before charging. Issue immediately so the customer sees a
        // real bill (and a ledger debit) on generation, instead of an
        // invisible draft that only ever gets issued if a manager remembers to
        // click "Issue" by hand — the step that let bills pile up as drafts.
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
      monthLabel: group.monthLabel,
      plans:      planCharges.map(p => ({ planName: p.plan?.plan_name ?? 'Fixed Plan', amount: p.amount, prorationNote: p.prorationNote })),
      inPlanUsage,
      outOfPlanExtras,
    })

    const { error: itemErr } = await admin.from('invoice_items').insert(lineItems)

    if (itemErr) {
      // Roll back the invoice
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

  return { generated, skipped, referralRewardsGenerated, errors, month: targetMonth }
}
