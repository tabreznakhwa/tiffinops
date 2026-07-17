import { createAdminClient } from '@/lib/supabase/admin'
import { formatInTimeZone } from 'date-fns-tz'

export type AlaCarteGenerateResult = {
  generated:    number
  skipped:      number
  errors:       string[]
  invoice_ids:  string[]
  total_amount: number
  month:        string
}

/**
 * Generate draft a_la_carte_cycle invoices for all active A La Carte / Hybrid
 * customers who have uninvoiced credit orders in the current month (1st–25th).
 *
 * Safe to call multiple times — uses billing_period_start/end as idempotency key.
 *
 * @param forMonth   'YYYY-MM' of the month being closed
 * @param createdBy  user ID to stamp on each invoice (or 'system-cron')
 */
export async function generateAlaCarteInvoices(
  forMonth: string,
  createdBy: string,
): Promise<AlaCarteGenerateResult> {
  const admin = createAdminClient()

  const [y, m] = forMonth.split('-').map(Number)
  const prevYear  = m === 1 ? y - 1 : y
  const prevMonth = m === 1 ? 12 : m - 1
  const prevMonthStr = prevMonth < 10 ? `0${prevMonth}` : `${prevMonth}`
  const periodStart = `${prevYear}-${prevMonthStr}-26`
  const periodEnd   = `${forMonth}-25`

  const monthLabel = new Date(y, m - 1, 1).toLocaleDateString('en-GB', {
    month: 'long', year: 'numeric',
  })

  // Fetch VAT rate
  const { data: settings } = await admin
    .from('app_settings').select('vat_percent').eq('id', 1).single()
  const vatRate = parseFloat(String(settings?.vat_percent ?? '5'))

  // Active A La Carte / Hybrid customers
  const { data: customers, error: custErr } = await admin
    .from('customers')
    .select('id, full_name, customer_code')
    .in('customer_type', ['a_la_carte', 'hybrid'])
    .eq('status', 'active')

  if (custErr || !customers?.length) {
    return { generated: 0, skipped: 0, errors: custErr ? [custErr.message] : [], invoice_ids: [], total_amount: 0, month: forMonth }
  }

  const customerIds = customers.map(c => c.id)
  const customerMap = new Map(customers.map(c => [c.id, c]))

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

  // Fetch all credit non-cancelled orders in the period (paginated)
  type OrderRow = { id: string; customer_id: string; total_amount: string; order_date: string; order_number: string; meal_period: string }
  const allOrders: OrderRow[] = []
  {
    const PAGE = 1000; let off = 0
    while (true) {
      const { data } = await admin
        .from('orders')
        .select('id, customer_id, total_amount, order_date, order_number, meal_period')
        .in('customer_id', customerIds)
        .gte('order_date', periodStart)
        .lte('order_date', periodEnd)
        .eq('is_credit', true)
        .not('order_status', 'in', '(cancelled,voided,draft)')
        .range(off, off + PAGE - 1)
      if (!data || data.length === 0) break
      allOrders.push(...(data as OrderRow[]))
      if (data.length < PAGE) break
      off += PAGE
    }
  }

  // Group uninvoiced orders by customer
  const byCustomer = new Map<string, OrderRow[]>()
  for (const order of allOrders) {
    if (alreadyInvoicedOrderIds.has(order.id)) continue
    if (!byCustomer.has(order.customer_id)) byCustomer.set(order.customer_id, [])
    byCustomer.get(order.customer_id)!.push(order)
  }

  const today    = formatInTimeZone(new Date(), 'Asia/Dubai', 'yyyy-MM-dd')
  const dueDate  = periodEnd

  let generated    = 0
  let skipped      = 0
  let total_amount = 0
  const errors:      string[] = []
  const invoice_ids: string[] = []

  for (const [customerId, orders] of byCustomer) {
    if (alreadyHasCycleInvoice.has(customerId)) { skipped++; continue }

    const customer = customerMap.get(customerId)
    if (!customer) { skipped++; continue }

    const subtotal = orders.reduce((s, o) => s + parseFloat(o.total_amount), 0)
    if (subtotal < 0.01) { skipped++; continue }

    const taxAmount = (subtotal * vatRate) / (100 + vatRate)

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
        discount_amount:      '0.00',
        tax_amount:           taxAmount.toFixed(2),
        total_amount:         subtotal.toFixed(2),
        status:               'draft',
        notes:                `A La Carte cycle — ${monthLabel}`,
        created_by:           createdBy === 'system-cron' ? null : createdBy,
      })
      .select('id')
      .single()

    if (insertErr || !invoice) {
      errors.push(`${customer.full_name}: ${insertErr?.message ?? 'insert failed'}`)
      continue
    }

    // Line items — one per order
    const lineItems = orders.map(o => ({
      invoice_id:  invoice.id,
      order_id:    o.id,
      description: `${o.order_date} · ${o.meal_period} · ${o.order_number}`,
      quantity:    '1',
      unit_price:  parseFloat(o.total_amount).toFixed(2),
      total_price: parseFloat(o.total_amount).toFixed(2),
    }))

    const { error: itemsErr } = await admin.from('invoice_items').insert(lineItems)
    if (itemsErr) {
      await admin.from('invoices').delete().eq('id', invoice.id)
      errors.push(`${customer.full_name}: ${itemsErr.message}`)
      continue
    }

    invoice_ids.push(invoice.id)
    total_amount += subtotal
    generated++
  }

  return { generated, skipped, errors, invoice_ids, total_amount, month: forMonth }
}
