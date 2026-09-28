// READ-ONLY. Check payment_terms + customer_type for the 36 customers that
// showed no Aug26-Sep25 invoice, to see why generateMonthlyInvoices skipped
// them (0 generated) even though no invoice for that period exists yet.
const fs = require('fs')
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/)
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '')
}
const { createClient } = require('@supabase/supabase-js')
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

const CODES = ['AC-CUST-00080','AC-CUST-00201','AC-CUST-00221','AC-CUST-00206','AC-CUST-00017','AC-CUST-00222','AC-CUST-00132','AC-CUST-00008','AC-CUST-00029','AC-CUST-00049','AC-CUST-00051','AC-CUST-00007','AC-CUST-00053','AC-CUST-00025','AC-CUST-00045','AC-CUST-00041','AC-CUST-00042','AC-CUST-00011','AC-CUST-00050','AC-CUST-00012','AC-CUST-00219','AC-CUST-00079','AC-CUST-00115','AC-CUST-00058','AC-CUST-00085','AC-CUST-00116','AC-CUST-00059','AC-CUST-00072','AC-CUST-00124','AC-CUST-00148','AC-CUST-00118','AC-CUST-00121','AC-CUST-00141','AC-CUST-00112','AC-CUST-00057','AC-CUST-00122']

async function main() {
  const { data: custs } = await admin.from('customers')
    .select('id, full_name, customer_code, customer_type, area, payment_terms, status')
    .in('customer_code', CODES)
  console.table(custs.map(c => ({ name: c.full_name, code: c.customer_code, type: c.customer_type, area: c.area, terms: c.payment_terms, status: c.status })))

  const { data: subs } = await admin.from('customer_subscriptions')
    .select('customer_id, status, agreed_monthly_price, fixed_plan_id, start_date, end_date')
    .in('customer_id', custs.map(c => c.id)).eq('status', 'active')
  console.log('\nActive subs:')
  console.table(subs.map(s => ({ cust: custs.find(c => c.id === s.customer_id)?.full_name, price: s.agreed_monthly_price, plan: s.fixed_plan_id, start: s.start_date, end: s.end_date })))
}
main().catch(e => { console.error('FAILED:', e.message); process.exit(1) })
