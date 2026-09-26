import { createAdminClient } from '@/lib/supabase/admin'
import { formatInTimeZone } from 'date-fns-tz'

// An order counts as "covered by a fixed plan" on its date when the customer
// had ANY subscription in force then (start_date <= date, end_date null or
// >= date, agreed_monthly_price > 0) — regardless of which meal periods that
// plan covers. Every such order is already billed by whichever flat-plan
// generator applies to that customer (generateMonthlyInvoices for Mai Dubai
// or postpaid hybrid, generateFixedAnniversaryInvoices for local postpaid
// fixed_menu, generatePrepaidInvoices for prepaid): a meal the plan covers is
// netted to zero there, and a meal it does NOT cover is billed there too, in
// full, as an "outside plan" extra. Billing it again here would double-charge
// the customer. Same in-force resolution rule as mealPeriodsCoveredOn in
// lib/billing/subscription-charge.ts (a row past its end_date, or zeroed out
// to retire a superseded row, never counts, however recent its start_date).
type CoveringSub = { customer_id: string; start_date: string; end_date: string | null; agreed_monthly_price: string | number }
function hasActivePlanOn(subs: CoveringSub[], date: string): boolean {
  for (const s of subs) {
    if (s.start_date > date) continue
    if (s.end_date != null && s.end_date < date) continue
    if (!(parseFloat(String(s.agreed_monthly_price)) > 0)) continue
    return true
  }
  return false
}

export type AlaCarteGenerateResult = {
  generated:      number
  skipped:        number
  errors:         string[]
  invoice_ids:    string[]
  total_amount:   number
  discount_total: number
  month:          string
}

/**
 * Generate draft a_la_carte_cycle invoices for all active A La Carte / Hybrid
 * customers who have uninvoiced credit orders in the given period — EXCEPT
 * any order placed on a date the customer had a fixed plan in force (see
 * hasActivePlanOn above). Those orders are already billed by whichever
 * flat-plan generator applies to that customer: netted to zero if the plan
 * covers that meal, or billed in full as an "outside plan" extra if it
 * doesn't. Billing them again here would double-charge the customer — this
 * is what makes a hybrid customer's invoicing correct: the flat-plan
 * invoice covers their plan + all its extras, and this a_la_carte_cycle
 * invoice covers only genuinely plan-free periods (e.g. before they joined a
 * plan, or after they left one).
 *
 * Safe to call multiple times — uses billing_period_start/end as idempotency key.
 *
 * @param forMonth   'YYYY-MM' of the month being closed (used to compute default period)
 * @param createdBy  user ID to stamp on each invoice (or 'system-cron')
 * @param options    optional period override; when absent the standard cycle is used
 * @param options.onlyArea  restrict this run to customers in a single area
 *   (e.g. 'Mai Dubai') — for a manual backfill of one area without touching
 *   every other active a_la_carte/hybrid customer in the same pass.
 */
export async function generateAlaCarteInvoices(
  forMonth: string,
  createdBy: string,
  options?: {
    periodStart?: string
    periodEnd?: string
    discountPercent?: number
    customerDiscounts?: Record<string, number>  // customer_id → % override
    onlyArea?: string
  },
): Promise<AlaCarteGenerateResult> {
  const admin = createAdminClient()

  const [y, m] = forMonth.split('-').map(Number)
  const prevYear  = m === 1 ? y - 1 : y
  const prevMonth = m === 1 ? 12 : m - 1
  const prevMonthStr = prevMonth < 10 ? `0${prevMonth}` : `${prevMonth}`
  const periodStart = options?.periodStart ?? `${prevYear}-${prevMonthStr}-26`
  const periodEnd   = options?.periodEnd   ?? `${forMonth}-25`

  // Derive a human label from the period end for invoice notes
  const endParts = periodEnd.split('-').map(Number)
  const monthLabel = new Date(endParts[0], endParts[1] - 1, 1).toLocaleDateString('en-GB', {
    month: 'long', year: 'numeric',
  })

  // Fetch VAT rate
  const { data: settings } = await admin
    .from('app_settings').select('vat_percent').eq('id', 1).single()
  const vatRate = parseFloat(String(settings?.vat_percent ?? '5'))

  // Active A La Carte / Hybrid customers
  let customerQuery = admin
    .from('customers')
    .select('id, full_name, customer_code')
    .in('customer_type', ['a_la_carte', 'hybrid'])
    .eq('status', 'active')
  if (options?.onlyArea) customerQuery = customerQuery.eq('area', options.onlyArea)
  const { data: customers, error: custErr } = await customerQuery

  if (custErr || !customers?.length) {
    return { generated: 0, skipped: 0, errors: custErr ? [custErr.message] : [], invoice_ids: [], total_amount: 0, discount_total: 0, month: forMonth }
  }

  const customerIds = customers.map(c => c.id)
  const customerMap = new Map(customers.map(c => [c.id, c]))

  // Every subscription row (any status) for these customers — used only to
  // tell whether a given order date already had a fixed plan in force, so
  // that order can be excluded here and left to the flat-plan generator that
  // actually bills it. See hasActivePlanOn above.
  const { data: coveringSubsRaw } = await admin
    .from('customer_subscriptions')
    .select('customer_id, start_date, end_date, agreed_monthly_price')
    .in('customer_id', customerIds)
  const coveringSubsByCustomer = new Map<string, CoveringSub[]>()
  for (const s of (coveringSubsRaw ?? []) as CoveringSub[]) {
    const list = coveringSubsByCustomer.get(s.customer_id)
    if (list) list.push(s)
    else coveringSubsByCustomer.set(s.customer_id, [s])
  }

  // Already-invoiced order IDs (in non-cancelled invoices)
  const alreadyInvoicedOrderIds = new Set<string>()
  {
    const { data: items } = await admin
      .from('invoice_items')
      .select('order_id, invoices!inner(status)')
      .not('order_id', 'is', null)
      .not('invoices.status', 'eq', 'cancelled')
    for (const item of items ?? []) {
      if (item.order_id) alreadyInvoicedOrderIds.add(item.order_id)
    }
  }

  // Customers already invoiced this cycle (idempotency)
  const { data: existingForCycle } = await admin
    .from('invoices')
    .select('customer_id')
    .eq('invoice_type', 'a_la_carte_cycle')
    .eq('billing_period_start', periodStart)
    .eq('billing_period_end', periodEnd)

  const alreadyHasCycleInvoice = new Set((existingForCycle ?? []).map(i => i.customer_id))

  // Fetch all credit non-cancelled orders in the period, including their items in one query
  type OrderRow = {
    id: string; customer_id: string; total_amount: string
    order_date: string; order_number: string; meal_period: string; notes: string | null
    order_items: { item_name_snapshot: string; quantity: string; unit_price: string | null }[]
  }
  const allOrders: OrderRow[] = []
  {
    const PAGE = 500; let off = 0
    while (true) {
      const { data } = await admin
        .from('orders')
        .select('id, customer_id, total_amount, order_date, order_number, meal_period, notes, order_items(item_name_snapshot, quantity, unit_price)')
        .in('customer_id', customerIds)
        .gte('order_date', periodStart)
        .lte('order_date', periodEnd)
        .eq('is_credit', true)
        .not('order_status', 'in', '(cancelled,voided,draft)')
        .range(off, off + PAGE - 1)
      if (!data || data.length === 0) break
      allOrders.push(...(data as unknown as OrderRow[]))
      if (data.length < PAGE) break
      off += PAGE
    }
  }

  // Group uninvoiced orders by customer — excluding any order already
  // covered by an active fixed plan on its date (see hasActivePlanOn above);
  // those are billed by the matching flat-plan generator instead, never here.
  const byCustomer = new Map<string, OrderRow[]>()
  for (const order of allOrders) {
    if (alreadyInvoicedOrderIds.has(order.id)) continue
    const covering = coveringSubsByCustomer.get(order.customer_id)
    if (covering && hasActivePlanOn(covering, order.order_date)) continue
    if (!byCustomer.has(order.customer_id)) byCustomer.set(order.customer_id, [])
    byCustomer.get(order.customer_id)!.push(order)
  }

  const globalDiscountPct   = Math.min(100, Math.max(0, options?.discountPercent ?? 0))
  const customerDiscountsMap = options?.customerDiscounts ?? {}

  const today    = formatInTimeZone(new Date(), 'Asia/Dubai', 'yyyy-MM-dd')
  const dueDate  = periodEnd

  let generated      = 0
  let skipped        = 0
  let total_amount   = 0
  let discount_total = 0
  const errors:      string[] = []
  const invoice_ids: string[] = []

  for (const [customerId, orders] of byCustomer) {
    if (alreadyHasCycleInvoice.has(customerId)) { skipped++; continue }

    const customer = customerMap.get(customerId)
    if (!customer) { skipped++; continue }

    const subtotal = orders.reduce((s, o) => s + parseFloat(o.total_amount), 0)
    if (subtotal < 0.01) { skipped++; continue }

    // Per-customer discount overrides the global default
    const discountPct     = customerId in customerDiscountsMap
      ? Math.min(100, Math.max(0, customerDiscountsMap[customerId]))
      : globalDiscountPct
    const discountAmount  = parseFloat((subtotal * discountPct / 100).toFixed(2))
    const discountedTotal = Math.max(0, subtotal - discountAmount)
    const taxAmount       = (discountedTotal * vatRate) / (100 + vatRate)

    // Generate invoice number
    const { data: invNum, error: numErr } = await admin.rpc('next_invoice_number')
    if (numErr || !invNum) {
      errors.push(`${customer.full_name}: could not generate invoice number`)
      continue
    }

    // Create draft invoice
    const { data: invoice, error: insertErr } = await admin
      .from('invoices')
      .insert({
        invoice_number:       invNum as string,
        customer_id:          customerId,
        invoice_date:         today,
        due_date:             dueDate,
        invoice_type:         'a_la_carte_cycle',
        billing_period_start: periodStart,
        billing_period_end:   periodEnd,
        subtotal:             subtotal.toFixed(2),
        discount_amount:      discountAmount.toFixed(2),
        tax_amount:           taxAmount.toFixed(2),
        total_amount:         discountedTotal.toFixed(2),
        status:               'draft',
        notes:                discountPct > 0
          ? `A La Carte cycle — ${monthLabel} · ${discountPct}% discount applied`
          : `A La Carte cycle — ${monthLabel}`,
        created_by:           createdBy === 'system-cron' ? null : createdBy,
      })
      .select('id')
      .single()

    if (insertErr || !invoice) {
      errors.push(`${customer.full_name}: ${insertErr?.message ?? 'insert failed'}`)
      continue
    }

    // Line items — one per food item for per-item pricing
    const lineItems = orders.flatMap(o => {
      const items = o.order_items ?? []
      if (items.length === 0) {
        // Fallback: one line per order when no item detail is available
        const description = o.notes?.trim()
          ? `${o.order_date} · ${o.meal_period} · ${o.notes.trim()}`
          : `${o.order_date} · ${o.meal_period} · ${o.order_number}`
        return [{
          invoice_id:  invoice.id,
          order_id:    o.id,
          description,
          quantity:    '1',
          unit_price:  parseFloat(o.total_amount).toFixed(2),
          total_price: parseFloat(o.total_amount).toFixed(2),
        }]
      }
      return items.map(it => {
        const qty      = parseFloat(it.quantity)
        const unitPrice = parseFloat(String(it.unit_price ?? '0'))
        return {
          invoice_id:  invoice.id,
          order_id:    o.id,
          description: `${o.order_date} · ${o.meal_period} · ${it.item_name_snapshot}`,
          quantity:    String(qty),
          unit_price:  unitPrice.toFixed(2),
          total_price: (qty * unitPrice).toFixed(2),
        }
      })
    })

    const { error: itemsErr } = await admin.from('invoice_items').insert(lineItems)
    if (itemsErr) {
      await admin.from('invoices').delete().eq('id', invoice.id)
      errors.push(`${customer.full_name}: ${itemsErr.message}`)
      continue
    }

    invoice_ids.push(invoice.id)
    total_amount   += discountedTotal
    discount_total += discountAmount
    generated++
  }

  return { generated, skipped, errors, invoice_ids, total_amount, discount_total, month: forMonth }
}
