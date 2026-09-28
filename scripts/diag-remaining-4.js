// READ-ONLY. Why 4 Mai Dubai customers (Medeva, Benard 3252, ADNAN 2075,
// Naeem 3111) still have no Aug26-Sep25 invoice after the backfill re-run.
const fs = require('fs')
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/)
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '')
}
const { createClient } = require('@supabase/supabase-js')
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

async function main() {
  const CODES = ['AC-CUST-00051', 'AC-CUST-00219', 'AC-CUST-00221', 'AC-CUST-00222']
  const { data: custs } = await admin.from('customers').select('id, full_name, customer_code, customer_type, area, payment_terms, status').in('customer_code', CODES)
  console.table(custs)
  const { data: subs } = await admin.from('customer_subscriptions').select('id, customer_id, status, start_date, end_date, agreed_monthly_price, fixed_plan_id').in('customer_id', custs.map(c => c.id))
  console.table(subs)
  const { data: invs } = await admin.from('invoices')
    .select('id, invoice_number, customer_id, invoice_type, status, billing_period_start, billing_period_end, total_amount')
    .in('customer_id', custs.map(c => c.id)).order('billing_period_start', { ascending: false })
  console.table(invs)
}
main().catch(e => { console.error('FAILED:', e.message); process.exit(1) })
