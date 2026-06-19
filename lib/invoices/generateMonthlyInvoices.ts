import { createAdminClient } from '@/lib/supabase/admin'
import { formatInTimeZone } from 'date-fns-tz'

export type GenerateResult = {
  generated: number
  skipped: number
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

// Advance one month: '2026-06' → '2026-07'
export function nextMonth(yyyyMM: string): string {
  const [y, m] = yyyyMM.split('-').map(Number)
  const d = new Date(y, m, 1) // 1st of next month
  return formatInTimeZone(d, 'Asia/Dubai', 'yyyy-MM')
}

/**
 * Generate draft fixed_monthly invoices for all active subscribers.
 * Designed to run on the 26th — creates invoices for the NEXT calendar month.
 *
 * @param targetMonth  'YYYY-MM' of the month being invoiced (defaults to next Dubai month)
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
      fixed_plan_id,
      fixed_plans(plan_name),
      customers(full_name, customer_code)
    `)
    .eq('status', 'active')

  if (subsErr) return { generated: 0, skipped: 0, errors: [subsErr.message], month: targetMonth }

  const { start: periodStart, end: periodEnd } = monthBounds(targetMonth)
  // Due date = 1st of the target month (pay before month begins)
  const dueDate = periodStart

  // Fetch existing invoices for this month to skip duplicates
  const { data: existingInvoices } = await admin
    .from('invoices')
    .select('customer_id')
    .eq('invoice_type', 'fixed_monthly')
    .gte('billing_period_start', periodStart)
    .lte('billing_period_start', periodEnd)

  const alreadyInvoiced = new Set((existingInvoices ?? []).map((i) => i.customer_id))

  // Format month label: '2026-07' → 'July 2026'
  const [ty, tm] = targetMonth.split('-').map(Number)
  const monthLabel = new Date(ty, tm - 1, 1).toLocaleDateString('en-GB', {
    month: 'long', year: 'numeric',
  })

  let generated = 0
  let skipped = 0
  const errors: string[] = []

  for (const sub of subs ?? []) {
    if (alreadyInvoiced.has(sub.customer_id)) {
      skipped++
      continue
    }

    const plan = sub.fixed_plans as unknown as { plan_name: string } | null
    const customer = sub.customers as unknown as { full_name: string; customer_code: string } | null

    const amount = parseFloat(String(sub.agreed_monthly_price))
    if (!amount || amount <= 0) {
      skipped++
      continue
    }

    const taxAmount = (amount * vatRate) / (100 + vatRate)
    const description = `Monthly Fixed Plan — ${plan?.plan_name ?? 'Fixed Plan'} — ${monthLabel}`

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
        subtotal:              amount.toFixed(2),
        discount_amount:       '0.00',
        tax_amount:            taxAmount.toFixed(2),
        total_amount:          amount.toFixed(2),
        status:                'draft',
        notes:                 null,
        created_by:            createdBy,
      })
      .select('id')
      .single()

    if (insertErr || !invoice) {
      errors.push(`${customer?.full_name ?? sub.customer_id}: ${insertErr?.message ?? 'insert failed'}`)
      continue
    }

    // Insert line item
    const { error: itemErr } = await admin.from('invoice_items').insert({
      invoice_id:  invoice.id,
      order_id:    null,
      description,
      quantity:    '1',
      unit_price:  amount.toFixed(2),
      total_price: amount.toFixed(2),
    })

    if (itemErr) {
      // Roll back the invoice
      await admin.from('invoices').delete().eq('id', invoice.id)
      errors.push(`${customer?.full_name ?? sub.customer_id}: ${itemErr.message}`)
      continue
    }

    generated++
  }

  return { generated, skipped, errors, month: targetMonth }
}
