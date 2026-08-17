import { createAdminClient } from '@/lib/supabase/admin'
import { computeFixedInvoiceAmounts, buildFixedPlanLineItems } from './fixedPlanInvoiceLines'
import type { GenerateResult } from './generateMonthlyInvoices'

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

function addDays(date: string, n: number): string {
  const d = new Date(date + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function monthLabelFor(date: string): string {
  const [y, m] = date.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
}

/**
 * Generate draft fixed_monthly invoices for PREPAID subscribers whose
 * billing anniversary (the day-of-month they started on) falls on `today`.
 * Meant to run daily — most days this processes an empty or near-empty batch,
 * since each customer is only due once a month, on their own start-date
 * anniversary.
 *
 * Each invoice is due the same day it's generated (prepaid = pay in advance,
 * no lead-time notice) and covers the period from today through the day
 * before the customer's next anniversary.
 *
 * Existing prepaid customers already invoiced under the old shared
 * calendar-month cycle are not backfilled — this only starts billing them
 * from their next unbilled anniversary onward.
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
      agreed_monthly_price,
      fixed_plan_id,
      fixed_plans(plan_name),
      customers(full_name, customer_code, payment_terms, customer_type)
    `)
    .eq('status', 'active')

  if (subsErr) return { generated: 0, skipped: 0, referralRewardsGenerated: 0, errors: [subsErr.message], month: today }

  const todayYear  = Number(today.slice(0, 4))
  const todayMonth = Number(today.slice(5, 7))

  // Only subscribers whose billing day is today
  const dueToday = (subs ?? []).filter(s => {
    const customer = s.customers as unknown as { payment_terms?: string } | null
    if (customer?.payment_terms !== 'prepaid') return false
    if (today < s.start_date) return false
    return anniversaryDateForMonth(s.start_date, todayYear, todayMonth) === today
  })

  if (dueToday.length === 0) {
    return { generated: 0, skipped: 0, referralRewardsGenerated: 0, errors: [], month: today }
  }

  // Fixed-menu customers pay a flat plan rate regardless of what they order —
  // fetch their credit orders across today's batch (each customer's own
  // period, but they all start today) so each invoice can show usage.
  const fixedCustomerIds = dueToday
    .map(s => (s.customers as unknown as { customer_type?: string } | null)?.customer_type === 'fixed_menu' ? s.customer_id : null)
    .filter((x): x is string => !!x)

  // periodEnd differs per customer (depends on their own start day), so fetch
  // orders from today through the furthest possible periodEnd in this batch.
  const periodEndByCustomer = new Map<string, string>()
  for (const s of dueToday) {
    periodEndByCustomer.set(s.customer_id, addDays(nextAnniversaryAfter(s.start_date, today), -1))
  }
  const furthestPeriodEnd = [...periodEndByCustomer.values()].reduce((a, b) => (a > b ? a : b), today)

  type FixedOrderRow = { customer_id: string; order_date: string; total_amount: string }
  const fixedOrders: FixedOrderRow[] = []
  if (fixedCustomerIds.length) {
    const PAGE = 1000
    let offset = 0
    while (true) {
      const { data } = await admin
        .from('orders')
        .select('customer_id, order_date, total_amount')
        .in('customer_id', fixedCustomerIds)
        .eq('is_credit', true)
        .not('order_status', 'in', '(cancelled,voided,draft)')
        .gte('order_date', today)
        .lte('order_date', furthestPeriodEnd)
        .range(offset, offset + PAGE - 1)
      const batch = (data ?? []) as unknown as FixedOrderRow[]
      fixedOrders.push(...batch)
      if (batch.length < PAGE) break
      offset += PAGE
    }
  }

  // Idempotency — skip anyone who already has a fixed_monthly invoice for
  // this exact period start (handles a cron re-run on the same day).
  const { data: existingInvoices } = await admin
    .from('invoices')
    .select('customer_id')
    .eq('invoice_type', 'fixed_monthly')
    .eq('billing_period_start', today)
    .in('customer_id', dueToday.map(s => s.customer_id))

  const alreadyInvoiced = new Set((existingInvoices ?? []).map(i => i.customer_id))

  let generated = 0
  let skipped = 0
  const errors: string[] = []
  const monthLabel = monthLabelFor(today)

  for (const sub of dueToday) {
    const customer = sub.customers as unknown as { full_name: string; customer_code: string; customer_type: string } | null

    if (alreadyInvoiced.has(sub.customer_id)) {
      skipped++
      continue
    }

    const plan = sub.fixed_plans as unknown as { plan_name: string } | null

    const amount = parseFloat(String(sub.agreed_monthly_price))
    if (!amount || amount <= 0) {
      skipped++
      continue
    }

    const periodEnd = periodEndByCustomer.get(sub.customer_id)!

    const usage = customer?.customer_type === 'fixed_menu'
      ? fixedOrders
          .filter(o => o.customer_id === sub.customer_id && o.order_date >= today && o.order_date <= periodEnd)
          .reduce((s, o) => s + parseFloat(o.total_amount), 0)
      : 0

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
        due_date:              today, // prepaid — due same day, no lead time
        invoice_type:          'fixed_monthly',
        billing_period_start:  today,
        billing_period_end:    periodEnd,
        ...computeFixedInvoiceAmounts(amount, usage, vatRate),
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
      usage,
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
