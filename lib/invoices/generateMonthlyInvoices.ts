import { createAdminClient } from '@/lib/supabase/admin'
import { formatInTimeZone } from 'date-fns-tz'
import { computeFixedInvoiceAmounts, buildFixedPlanLineItems } from './fixedPlanInvoiceLines'
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

/**
 * Generate draft fixed_monthly invoices for active POSTPAID subscribers only.
 * Designed to run on the 26th, when `targetMonth` is the upcoming calendar
 * month — postpaid customers are billed for the month that's about to
 * complete (the month before `targetMonth`), due on the 1st of `targetMonth`,
 * i.e. right after that billing month finishes.
 *
 * Prepaid subscribers are billed on their own anniversary date instead — see
 * generatePrepaidInvoices.ts — since a shared calendar-month cycle leaves the
 * days between a mid-month start and the next 1st unbilled.
 *
 * @param targetMonth  'YYYY-MM' of the upcoming month (defaults to next Dubai month)
 * @param createdBy    auth user ID to stamp on each invoice
 */
export async function generateMonthlyInvoices(
  targetMonth: string,
  createdBy: string,
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
      customers(full_name, customer_code, payment_terms, customer_type)
    `)
    .eq('status', 'active')

  if (subsErr) return { generated: 0, skipped: 0, referralRewardsGenerated: 0, errors: [subsErr.message], month: targetMonth }

  // Postpaid only — prepaid is billed on each customer's own anniversary date.
  const postpaidSubs = (subs ?? []).filter(s =>
    (s.customers as unknown as { payment_terms?: string } | null)?.payment_terms === 'postpaid'
  )

  const billingMonth = prevMonth(targetMonth)
  const { start: periodStart, end: periodEnd } = monthBounds(billingMonth)
  const dueDate   = monthBounds(targetMonth).start // 1st of targetMonth
  const monthLabel = monthLabelFor(billingMonth)

  // Fixed-menu customers pay a flat plan rate regardless of what they order, so
  // their invoice shows the order usage + a matching "fixed-plan discount" line
  // and always nets out to the agreed monthly price. Fetch their credit orders
  // for the billing period once so each invoice can display its usage.
  const fixedCustomerIds = postpaidSubs
    .map(s => (s.customers as unknown as { customer_type?: string } | null)?.customer_type === 'fixed_menu' ? s.customer_id : null)
    .filter((x): x is string => !!x)
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
        .gte('order_date', periodStart)
        .lte('order_date', periodEnd)
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
      .lte('pause_start', periodEnd)
      .or(`pause_end.is.null,pause_end.gte.${periodStart}`)
    for (const p of pauseRows ?? []) {
      const list = pausesBySub.get(p.subscription_id) ?? []
      list.push({ meal_period: p.meal_period, pause_start: p.pause_start, pause_end: p.pause_end })
      pausesBySub.set(p.subscription_id, list)
    }
  }

  // Fetch existing invoices for this billing period to skip duplicates
  const { data: existingInvoices } = await admin
    .from('invoices')
    .select('customer_id')
    .eq('invoice_type', 'fixed_monthly')
    .eq('billing_period_start', periodStart)

  const alreadyInvoiced = new Set((existingInvoices ?? []).map((i) => i.customer_id))

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

  for (const sub of postpaidSubs) {
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

    // Prorate the flat plan rate for any meal the customer stopped mid-cycle
    // (subscription_meal_pauses) — see lib/fixed-menu/proration.ts.
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
    })
    const prorationNote = prorationNoteFor(subPauses)

    // Extra credit orders this customer placed in their billing period. For a
    // fixed-menu customer, orders from a meal period the plan covers are
    // "usage" absorbed by a matching discount; orders from a meal period the
    // plan does NOT cover are genuine extras and are billed in full.
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

    // Generate invoice number
    const { data: invoiceNumber, error: numErr } = await admin.rpc('next_invoice_number')
    if (numErr || !invoiceNumber) {
      errors.push(`${customer?.full_name ?? sub.customer_id}: could not generate invoice number`)
      continue
    }

    const today = formatInTimeZone(new Date(), 'Asia/Dubai', 'yyyy-MM-dd')

    const { data: invoice, error: insertErr } = await admin
      .from('invoices')
      .insert({
        invoice_number:        invoiceNumber as string,
        customer_id:           sub.customer_id,
        invoice_date:          today,
        due_date:              dueDate,
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
      // Roll back the invoice
      await admin.from('invoices').delete().eq('id', invoice.id)
      errors.push(`${customer?.full_name ?? sub.customer_id}: ${itemErr.message}`)
      continue
    }

    generated++
  }

  return { generated, skipped, referralRewardsGenerated, errors, month: targetMonth }
}
