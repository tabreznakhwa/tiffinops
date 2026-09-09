const fs = require('fs')
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/)
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '')
}
const { createClient } = require('@supabase/supabase-js')
const a = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

async function main() {
  const dupe = (await a.from('customers').select('*').eq('customer_code', 'AC-CUST-00020').single()).data
  const keeper = (await a.from('customers').select('*').eq('customer_code', 'AC-CUST-00148').single()).data
  console.log('dupe id', dupe.id, 'keeper id', keeper.id)

  for (const t of ['orders', 'invoices', 'payments', 'ledger_entries', 'customer_subscriptions', 'balance_adjustments']) {
    const { data, error } = await a.from(t).select('id').eq('customer_id', dupe.id)
    if (error) throw error
    console.log('remaining on dupe -', t, data.length)
  }

  console.log('\n-- oldAug (AC-INV-01308) --')
  const oldAug = (await a.from('invoices').select('*').eq('invoice_number', 'AC-INV-01308').maybeSingle()).data
  console.log(oldAug)
  if (oldAug) {
    const items = (await a.from('invoice_items').select('*').eq('invoice_id', oldAug.id)).data
    console.log('oldAug invoice_items:', items.length, items)
    const ledger = (await a.from('ledger_entries').select('*').eq('reference_table', 'invoices').eq('reference_id', oldAug.id)).data
    console.log('oldAug ledger_entries:', ledger)
    const pays = (await a.from('payments').select('*').eq('invoice_id', oldAug.id)).data
    console.log('oldAug payments:', pays)
  }

  console.log('\n-- keeper existing Aug invoice AC-INV-01329 --')
  const keepAug = (await a.from('invoices').select('*').eq('invoice_number', 'AC-INV-01329').maybeSingle()).data
  console.log(keepAug)
  if (keepAug) {
    const items = (await a.from('invoice_items').select('*').eq('invoice_id', keepAug.id)).data
    console.log('keepAug invoice_items:', items.length, items)
    const ledger = (await a.from('ledger_entries').select('*').eq('reference_table', 'invoices').eq('reference_id', keepAug.id)).data
    console.log('keepAug ledger_entries:', ledger)
  }

  console.log('\n-- keeper all invoices now --')
  const keepInvs = (await a.from('invoices').select('invoice_number, invoice_type, billing_period_start, billing_period_end, status, total_amount').eq('customer_id', keeper.id).order('billing_period_start')).data
  console.table(keepInvs)
}
main().catch(e => { console.error(e); process.exit(1) })
