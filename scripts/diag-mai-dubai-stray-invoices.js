// READ-ONLY. generateMonthlyInvoices' alreadyInvoiced check only matches on
// (customer_id, billing_period_start) for invoice_type='fixed_monthly' — NOT
// billing_period_end. If any of the 36 "missing" customers already have a
// fixed_monthly row with billing_period_start = 2026-08-26 but some other
// (wrong/stray) billing_period_end, the generator would silently treat them
// as already billed for this cycle even though no correctly-bounded invoice
// exists — explaining generated:0 on the backfill run.
const fs = require('fs')
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/)
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '')
}
const { createClient } = require('@supabase/supabase-js')
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

const CODES = ['AC-CUST-00080','AC-CUST-00201','AC-CUST-00221','AC-CUST-00206','AC-CUST-00017','AC-CUST-00222','AC-CUST-00132','AC-CUST-00008','AC-CUST-00029','AC-CUST-00049','AC-CUST-00051','AC-CUST-00007','AC-CUST-00053','AC-CUST-00025','AC-CUST-00045','AC-CUST-00041','AC-CUST-00042','AC-CUST-00011','AC-CUST-00050','AC-CUST-00012','AC-CUST-00219','AC-CUST-00079','AC-CUST-00115','AC-CUST-00058','AC-CUST-00085','AC-CUST-00116','AC-CUST-00059','AC-CUST-00072','AC-CUST-00124','AC-CUST-00148','AC-CUST-00118','AC-CUST-00121','AC-CUST-00141','AC-CUST-00112','AC-CUST-00057','AC-CUST-00122']

async function main() {
  const { data: custs } = await admin.from('customers').select('id, full_name, customer_code').in('customer_code', CODES)
  const custById = new Map(custs.map(c => [c.id, c]))

  const { data: invs } = await admin.from('invoices')
    .select('id, invoice_number, customer_id, invoice_type, status, billing_period_start, billing_period_end, total_amount, invoice_date')
    .in('customer_id', custs.map(c => c.id))
    .order('billing_period_start', { ascending: false })

  console.log(`All invoices (any type/period) for these 36 customers: ${invs.length}`)
  console.table(invs.map(i => ({ customer: custById.get(i.customer_id)?.full_name, inv: i.invoice_number, type: i.invoice_type, status: i.status, ps: i.billing_period_start, pe: i.billing_period_end, total: i.total_amount })))

  const strayFixedMonthly = invs.filter(i => i.invoice_type === 'fixed_monthly' && i.billing_period_start === '2026-08-26')
  console.log(`\nfixed_monthly invoices with billing_period_start = 2026-08-26 (regardless of end date): ${strayFixedMonthly.length}`)
}
main().catch(e => { console.error('FAILED:', e.message); process.exit(1) })
