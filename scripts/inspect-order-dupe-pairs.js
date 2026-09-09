const fs = require('fs')
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/)
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '')
}
const { createClient } = require('@supabase/supabase-js')
const a = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

async function inspect(orderNumber) {
  const o = (await a.from('orders').select('*, customers(full_name, customer_code)').eq('order_number', orderNumber).single()).data
  const sameDay = (await a.from('orders').select('id, order_number, order_date, meal_period, total_amount, order_status, voided_at, created_at')
    .eq('customer_id', o.customer_id).eq('order_date', o.order_date).order('created_at')).data
  console.log(`\n--- ${o.customers.full_name} (${o.customers.customer_code}) ${o.order_date} ---`)
  console.table(sameDay)
  const items = (await a.from('invoice_items').select('invoice_id, order_id').eq('order_id', o.id)).data
  for (const it of items) {
    const inv = (await a.from('invoices').select('invoice_number, status').eq('id', it.invoice_id).single()).data
    console.log('  on invoice:', inv.invoice_number, inv.status)
  }
}
async function main() {
  await inspect('AC-A-260811-04244')
  await inspect('AC-A-260812-04399')
}
main().catch(e => { console.error(e); process.exit(1) })
