// READ-ONLY diagnostic — no writes. Run with: node scripts/audit-draft-customer-types.js
const fs = require('fs')
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/)
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '')
}
const { createClient } = require('@supabase/supabase-js')
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

async function main() {
  const { data: drafts, error } = await admin
    .from('invoices')
    .select('id, invoice_number, invoice_type, total_amount, discount_amount, subtotal, customer_id, customers(full_name, customer_code, customer_type)')
    .eq('status', 'draft')

  if (error) { console.error(error); process.exit(1) }

  const byCustType = {}
  for (const inv of drafts) {
    const ct = inv.customers?.customer_type ?? 'unknown'
    byCustType[ct] = (byCustType[ct] || 0) + 1
  }
  console.log(`Total draft invoices: ${drafts.length}`)
  console.log('Draft invoices grouped by their CUSTOMER\'s customer_type:')
  console.table(byCustType)

  // Discount stats on the draft invoices themselves, grouped by customer_type
  const discStats = {}
  for (const inv of drafts) {
    const ct = inv.customers?.customer_type ?? 'unknown'
    if (!discStats[ct]) discStats[ct] = { count: 0, totalSubtotal: 0, totalDiscount: 0 }
    discStats[ct].count += 1
    discStats[ct].totalSubtotal += parseFloat(inv.subtotal ?? inv.total_amount)
    discStats[ct].totalDiscount += parseFloat(inv.discount_amount ?? 0)
  }
  console.log('\nDiscount already applied on draft invoices, by customer_type:')
  for (const [ct, s] of Object.entries(discStats)) {
    const pct = s.totalSubtotal > 0 ? (s.totalDiscount / s.totalSubtotal) * 100 : 0
    console.log(`  ${ct}: ${s.count} invoices, subtotal AED ${s.totalSubtotal.toFixed(2)}, discount AED ${s.totalDiscount.toFixed(2)} (${pct.toFixed(1)}%)`)
  }
}
main()
