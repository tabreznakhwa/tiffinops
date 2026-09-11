// READ-ONLY diagnostic — no writes. Investigate two reported billing
// anomalies:
//  1. Abul Hassan (AC-CUST-00218) — why does an October 2026 invoice
//     (AC-INV-01553) already exist when today is only 11 Sept 2026?
//  2. Hassan Miya (AC-CUST-00181) — why was the Sep 2026 invoice
//     (AC-INV-01479) billed AED 460 instead of the agreed AED 660?
const fs = require('fs')
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/)
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '')
}
const { createClient } = require('@supabase/supabase-js')
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

async function dumpCustomer(code) {
  console.log(`\n================ ${code} ================`)
  const { data: customer, error: custErr } = await admin
    .from('customers')
    .select('id, full_name, customer_code, customer_type, payment_terms, area, status')
    .eq('customer_code', code)
    .single()
  if (custErr || !customer) { console.log('Customer lookup error:', custErr); return }
  console.log('Customer:', customer)

  const { data: subs } = await admin
    .from('customer_subscriptions')
    .select('id, fixed_plan_id, agreed_monthly_price, meal_prices, start_date, end_date, status, created_at')
    .eq('customer_id', customer.id)
    .order('start_date')
  console.log('\nSubscriptions:')
  console.table(subs)

  const planIds = [...new Set((subs ?? []).map(s => s.fixed_plan_id).filter(Boolean))]
  if (planIds.length) {
    const { data: plans } = await admin
      .from('fixed_plans')
      .select('id, plan_name, meal_periods')
      .in('id', planIds)
    console.log('\nFixed plans referenced:')
    console.table(plans)
  }

  const { data: pauses } = await admin
    .from('subscription_meal_pauses')
    .select('subscription_id, meal_period, pause_start, pause_end')
    .in('subscription_id', (subs ?? []).map(s => s.id))
  console.log('\nMeal pauses:')
  console.table(pauses)

  const { data: invoices } = await admin
    .from('invoices')
    .select('id, invoice_number, invoice_type, status, invoice_date, due_date, billing_period_start, billing_period_end, subtotal, discount_amount, tax_amount, total_amount, notes, created_at')
    .eq('customer_id', customer.id)
    .order('billing_period_start')
  console.log('\nAll invoices:')
  console.table(invoices)

  const { data: items } = await admin
    .from('invoice_items')
    .select('invoice_id, description, quantity, unit_price, total_price, order_id')
    .in('invoice_id', (invoices ?? []).map(i => i.id))
  console.log('\nInvoice line items:')
  console.table(items)

  const { data: orders } = await admin
    .from('orders')
    .select('id, order_number, order_date, meal_period, total_amount, is_credit, order_status')
    .eq('customer_id', customer.id)
    .order('order_date')
  console.log('\nAll orders (full history):')
  console.table(orders)

  const { data: payments } = await admin
    .from('payments')
    .select('payment_number, amount, mode, payment_date, invoice_id, is_advance, voided_at, notes')
    .eq('customer_id', customer.id)
    .order('payment_date')
  console.log('\nAll payments:')
  console.table(payments)
}

async function main() {
  await dumpCustomer('AC-CUST-00218') // Abul Hassan
  await dumpCustomer('AC-CUST-00181') // Hassan Miya
}
main()
