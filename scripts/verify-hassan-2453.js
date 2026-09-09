// READ-ONLY diagnostic — no writes. Verify whether HASSAN 2453's AED 600
// payment (5 Aug 2026) matches his 27 Jun - 26 Jul order cycle / draft invoice.
const fs = require('fs')
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/)
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '')
}
const { createClient } = require('@supabase/supabase-js')
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

async function main() {
  const { data: customer } = await admin
    .from('customers')
    .select('id, full_name, customer_code, customer_type')
    .eq('customer_code', 'AC-CUST-00119')
    .single()
  console.log('Customer:', customer)

  const { data: sub } = await admin
    .from('customer_subscriptions')
    .select('*')
    .eq('customer_id', customer.id)
  console.log('\nSubscriptions:')
  console.table(sub)

  const { data: draftInv } = await admin
    .from('invoices')
    .select('id, invoice_number, invoice_type, status, invoice_date, due_date, billing_period_start, billing_period_end, subtotal, discount_amount, total_amount, notes')
    .eq('customer_id', customer.id)
  console.log('\nAll invoices for this customer:')
  console.table(draftInv)

  const { data: items } = await admin
    .from('invoice_items')
    .select('description, quantity, unit_price, total_price, order_id')
    .in('invoice_id', draftInv.map(i => i.id))
  console.log('\nInvoice line items:')
  console.table(items)

  const { data: orders } = await admin
    .from('orders')
    .select('id, order_number, order_date, total_amount, is_credit, order_status')
    .eq('customer_id', customer.id)
    .gte('order_date', '2026-06-27')
    .lte('order_date', '2026-07-26')
    .order('order_date')
  console.log('\nOrders 27 Jun - 26 Jul 2026:')
  console.table(orders)
  const ordersSum = (orders ?? []).reduce((s, o) => s + parseFloat(o.total_amount), 0)
  console.log('Sum of those orders:', ordersSum.toFixed(2))

  const { data: payments } = await admin
    .from('payments')
    .select('payment_number, amount, mode, payment_date, invoice_id, is_advance, voided_at, notes')
    .eq('customer_id', customer.id)
    .order('payment_date')
  console.log('\nAll payments for this customer:')
  console.table(payments)

  const { data: allOrders } = await admin
    .from('orders')
    .select('order_date, total_amount, is_credit, order_status')
    .eq('customer_id', customer.id)
    .order('order_date')
  console.log('\nALL orders (full history) for this customer:')
  console.table(allOrders)
}
main()
