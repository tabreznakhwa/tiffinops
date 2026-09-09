// READ-ONLY. Re-check current status of the 27 fixed_menu invoices identified
// in the earlier audit, and whether any already have a ledger_entries row
// (meaning they were manually issued since the audit ran).
const fs = require('fs')
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/)
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '')
}
const { createClient } = require('@supabase/supabase-js')
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

const INVOICE_NUMBERS = [
  'AC-INV-01064','AC-INV-01148','AC-INV-01076','AC-INV-01099','AC-INV-01101',
  'AC-INV-01075','AC-INV-01083','AC-INV-01124','AC-INV-01122','AC-INV-01118',
  'AC-INV-01142','AC-INV-01127','AC-INV-01072','AC-INV-01128','AC-INV-01115',
  'AC-INV-01121','AC-INV-01066','AC-INV-01102','AC-INV-01107','AC-INV-01134',
  'AC-INV-01094','AC-INV-01126','AC-INV-01059','AC-INV-01093','AC-INV-01085',
  'AC-INV-01130','AC-INV-01133',
]

async function main() {
  const { data: invoices } = await admin
    .from('invoices')
    .select('id, invoice_number, status, discount_amount, total_amount')
    .in('invoice_number', INVOICE_NUMBERS)

  const byStatus = {}
  for (const inv of invoices) byStatus[inv.status] = (byStatus[inv.status] || 0) + 1
  console.log('Current status breakdown of the 27:', byStatus)

  const drifted = invoices.filter(inv => inv.status !== 'draft')
  console.log(`\n${drifted.length} of 27 are no longer 'draft':`)
  console.table(drifted.map(d => ({ invoice_number: d.invoice_number, status: d.status, discount_amount: d.discount_amount, total_amount: d.total_amount })))

  if (drifted.length > 0) {
    const { data: ledger } = await admin
      .from('ledger_entries')
      .select('reference_id, debit_amount, entry_date')
      .eq('reference_table', 'invoices')
      .in('reference_id', drifted.map(d => d.id))
    console.log('\nExisting ledger_entries for the drifted ones:')
    console.table(ledger)
  }
}
main()
