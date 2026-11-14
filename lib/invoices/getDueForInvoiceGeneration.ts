import { createAdminClient } from '@/lib/supabase/admin'
import { pendingCyclesFor } from '@/lib/invoices/generateFixedAnniversaryInvoices'
import {
  mostRecentAnniversaryOnOrBefore,
  nextAnniversaryAfter,
} from '@/lib/invoices/generatePrepaidInvoices'
import {
  hasActivePlanOn,
  type CoveringSub,
} from '@/lib/invoices/generateAlaCarteInvoices'

export type InvoiceDueKind =
  | 'fixed_anniversary'
  | 'prepaid_anniversary'
  | 'postpaid_monthly'
  | 'a_la_carte_cycle'

export type InvoiceGenerationDue = {
  customerId: string
  fullName: string
  customerCode: string
  area: string | null
  kind: InvoiceDueKind
  periodStart: string
  periodEnd: string
}

type CustomerRow = {
  id: string
  full_name: string
  customer_code: string
  area: string | null
  customer_type: string
  payment_terms: string
  status: string
}

type SubscriptionRow = {
  id: string
  customer_id: string
  start_date: string
  end_date: string | null
  status: string
  agreed_monthly_price: string
}

type InvoiceRow = {
  customer_id: string
  invoice_type: string
  billing_period_start: string | null
  billing_period_end: string | null
  status: string
}

type OrderRow = {
  id: string
  customer_id: string
  order_date: string
}

const PAGE = 500
const ID_BATCH = 100

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

function previousMonth(year: number, month: number): { year: number; month: number } {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 }
}

function monthBounds(year: number, month: number): { start: string; end: string } {
  const start = `${year}-${String(month).padStart(2, '0')}-01`
  const next = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`
  return { start, end: addDays(next, -1) }
}

function latestCompletedCalendarMonth(today: string): { start: string; end: string } {
  const year = Number(today.slice(0, 4))
  const month = Number(today.slice(5, 7))
  const previous = previousMonth(year, month)
  return monthBounds(previous.year, previous.month)
}

function cycleForOrderDate(date: string): { start: string; end: string } {
  const year = Number(date.slice(0, 4))
  const month = Number(date.slice(5, 7))
  const day = Number(date.slice(8, 10))

  if (day >= 26) {
    const endYear = month === 12 ? year + 1 : year
    const endMonth = month === 12 ? 1 : month + 1
    return {
      start: `${year}-${String(month).padStart(2, '0')}-26`,
      end: `${endYear}-${String(endMonth).padStart(2, '0')}-25`,
    }
  }

  const startMonth = previousMonth(year, month)
  return {
    start: `${startMonth.year}-${String(startMonth.month).padStart(2, '0')}-26`,
    end: `${year}-${String(month).padStart(2, '0')}-25`,
  }
}

async function fetchInBatches<T>(
  ids: string[],
  build: (batch: string[], from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const rows: T[] = []
  for (let i = 0; i < ids.length; i += ID_BATCH) {
    const batch = ids.slice(i, i + ID_BATCH)
    let offset = 0
    while (true) {
      const { data, error } = await build(batch, offset, offset + PAGE - 1)
      if (error) throw new Error(error.message)
      const page = data ?? []
      rows.push(...page)
      if (page.length < PAGE) break
      offset += PAGE
    }
  }
  return rows
}

/**
 * Read-only work queue for customers outside Mai Dubai. It mirrors the same
 * eligibility and non-cancelled-invoice rules used by the manual generators;
 * it never allocates an invoice number or writes billing data.
 */
export async function getCustomersDueForInvoiceGeneration(
  today: string,
): Promise<InvoiceGenerationDue[]> {
  const admin = createAdminClient()

  const customers: CustomerRow[] = []
  let customerOffset = 0
  while (true) {
    const { data, error } = await admin
      .from('customers')
      .select('id, full_name, customer_code, area, customer_type, payment_terms, status')
      .in('status', ['active', 'paused'])
      .order('id')
      .range(customerOffset, customerOffset + PAGE - 1)
    if (error) throw new Error(`Could not load customers due for invoices: ${error.message}`)
    const page = (data ?? []) as CustomerRow[]
    customers.push(...page.filter(customer => customer.area !== 'Mai Dubai'))
    if (page.length < PAGE) break
    customerOffset += PAGE
  }

  if (customers.length === 0) return []

  const customerById = new Map(customers.map(customer => [customer.id, customer]))
  const customerIds = customers.map(customer => customer.id)

  const [subscriptions, invoices] = await Promise.all([
    fetchInBatches<SubscriptionRow>(customerIds, (ids, from, to) => admin
      .from('customer_subscriptions')
      .select('id, customer_id, start_date, end_date, status, agreed_monthly_price')
      .in('customer_id', ids)
      .order('id')
      .range(from, to)),
    fetchInBatches<InvoiceRow>(customerIds, (ids, from, to) => admin
      .from('invoices')
      .select('customer_id, invoice_type, billing_period_start, billing_period_end, status')
      .in('customer_id', ids)
      .neq('status', 'cancelled')
      .order('id')
      .range(from, to)),
  ])

  const invoicesByCustomer = new Map<string, InvoiceRow[]>()
  for (const invoice of invoices) {
    const list = invoicesByCustomer.get(invoice.customer_id)
    if (list) list.push(invoice)
    else invoicesByCustomer.set(invoice.customer_id, [invoice])
  }

  const addDue = (
    out: Map<string, InvoiceGenerationDue>,
    customer: CustomerRow,
    kind: InvoiceDueKind,
    periodStart: string,
    periodEnd: string,
  ) => {
    const key = `${customer.id}|${kind}|${periodStart}|${periodEnd}`
    out.set(key, {
      customerId: customer.id,
      fullName: customer.full_name,
      customerCode: customer.customer_code,
      area: customer.area,
      kind,
      periodStart,
      periodEnd,
    })
  }

  const due = new Map<string, InvoiceGenerationDue>()
  const activeSubscriptions = subscriptions.filter(subscription => subscription.status === 'active')

  // Postpaid fixed-menu subscriptions: every fully elapsed anniversary cycle
  // after the customer's latest non-cancelled invoice is due for manual action.
  for (const subscription of activeSubscriptions) {
    const customer = customerById.get(subscription.customer_id)
    if (!customer || customer.payment_terms !== 'postpaid' || customer.customer_type !== 'fixed_menu') continue
    if (parseFloat(subscription.agreed_monthly_price) <= 0) continue

    const customerInvoices = invoicesByCustomer.get(customer.id) ?? []
    const lastBilledThrough = customerInvoices.reduce<string | null>((latest, invoice) => {
      if (!invoice.billing_period_end) return latest
      return !latest || invoice.billing_period_end > latest ? invoice.billing_period_end : latest
    }, null)

    const cycles = pendingCyclesFor(
      subscription.start_date,
      subscription.end_date,
      lastBilledThrough,
      today,
    )
    for (const cycle of cycles) {
      addDue(due, customer, 'fixed_anniversary', cycle.periodStart, cycle.periodEnd)
    }
  }

  // Prepaid subscriptions: the most recent anniversary cycle is due unless a
  // non-cancelled fixed invoice already starts there or covers that start date.
  for (const subscription of activeSubscriptions) {
    const customer = customerById.get(subscription.customer_id)
    if (!customer || customer.payment_terms !== 'prepaid' || subscription.start_date > today) continue
    if (parseFloat(subscription.agreed_monthly_price) <= 0) continue

    const periodStart = mostRecentAnniversaryOnOrBefore(subscription.start_date, today)
    const periodEnd = addDays(nextAnniversaryAfter(subscription.start_date, periodStart), -1)
    const fixedInvoices = (invoicesByCustomer.get(customer.id) ?? [])
      .filter(invoice => invoice.invoice_type === 'fixed_monthly')
    const alreadyStartsThere = fixedInvoices.some(invoice => invoice.billing_period_start === periodStart)
    const coveredThrough = fixedInvoices.reduce<string | null>((latest, invoice) => {
      if (!invoice.billing_period_end) return latest
      return !latest || invoice.billing_period_end > latest ? invoice.billing_period_end : latest
    }, null)
    if (!alreadyStartsThere && (!coveredThrough || coveredThrough < periodStart)) {
      addDue(due, customer, 'prepaid_anniversary', periodStart, periodEnd)
    }
  }

  // Non-fixed postpaid plans outside Mai Dubai use manual calendar-month
  // generation. Only flag the latest month that has fully ended.
  const completedMonth = latestCompletedCalendarMonth(today)
  for (const subscription of activeSubscriptions) {
    const customer = customerById.get(subscription.customer_id)
    if (!customer || customer.payment_terms !== 'postpaid' || customer.customer_type === 'fixed_menu') continue
    if (parseFloat(subscription.agreed_monthly_price) <= 0) continue
    if (subscription.start_date > completedMonth.end) continue
    if (subscription.end_date && subscription.end_date < completedMonth.start) continue

    const exists = (invoicesByCustomer.get(customer.id) ?? []).some(invoice =>
      invoice.invoice_type === 'fixed_monthly'
      && invoice.billing_period_start === completedMonth.start
      && invoice.billing_period_end === completedMonth.end
    )
    if (!exists) addDue(due, customer, 'postpaid_monthly', completedMonth.start, completedMonth.end)
  }

  // A La Carte: find every uninvoiced eligible credit order in a completed
  // 26th-to-25th cycle. Order IDs and their invoice items are fetched in
  // bounded pages to avoid PostgREST's embedded-row cap and oversized URLs.
  const activeOrderCustomerIds = customers
    .filter(customer => customer.status === 'active'
      && ['a_la_carte', 'hybrid', 'fixed_menu'].includes(customer.customer_type))
    .map(customer => customer.id)

  if (activeOrderCustomerIds.length > 0) {
    const orders = await fetchInBatches<OrderRow>(activeOrderCustomerIds, (ids, from, to) => admin
      .from('orders')
      .select('id, customer_id, order_date')
      .in('customer_id', ids)
      .lte('order_date', addDays(today, -1))
      .eq('is_credit', true)
      .not('order_status', 'in', '(cancelled,voided,draft)')
      .order('id')
      .range(from, to))

    const completedOrders = orders.filter(order => cycleForOrderDate(order.order_date).end < today)
    const invoicedOrderIds = new Set<string>()
    if (completedOrders.length > 0) {
      const invoiceItems = await fetchInBatches<{ order_id: string | null }>(
        completedOrders.map(order => order.id),
        (ids, from, to) => admin
          .from('invoice_items')
          .select('order_id, invoices!inner(status)')
          .in('order_id', ids)
          .not('invoices.status', 'eq', 'cancelled')
          .order('id')
          .range(from, to),
      )
      for (const item of invoiceItems) if (item.order_id) invoicedOrderIds.add(item.order_id)
    }

    const coveringSubsByCustomer = new Map<string, CoveringSub[]>()
    for (const subscription of subscriptions) {
      const list = coveringSubsByCustomer.get(subscription.customer_id)
      const covering: CoveringSub = subscription
      if (list) list.push(covering)
      else coveringSubsByCustomer.set(subscription.customer_id, [covering])
    }

    for (const order of completedOrders) {
      if (invoicedOrderIds.has(order.id)) continue
      if (hasActivePlanOn(coveringSubsByCustomer.get(order.customer_id) ?? [], order.order_date)) continue

      const customer = customerById.get(order.customer_id)
      if (!customer) continue
      const cycle = cycleForOrderDate(order.order_date)
      const hasCycleInvoice = (invoicesByCustomer.get(customer.id) ?? []).some(invoice =>
        invoice.invoice_type === 'a_la_carte_cycle'
        && invoice.billing_period_start === cycle.start
        && invoice.billing_period_end === cycle.end
      )
      if (!hasCycleInvoice) addDue(due, customer, 'a_la_carte_cycle', cycle.start, cycle.end)
    }
  }

  return [...due.values()].sort((a, b) =>
    a.periodEnd.localeCompare(b.periodEnd)
    || a.fullName.localeCompare(b.fullName)
    || a.kind.localeCompare(b.kind)
  )
}
