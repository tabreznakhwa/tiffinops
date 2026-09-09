// READ-ONLY diagnostic — no writes. Run with: node scripts/audit-invoice-types.js
const fs = require('fs')
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/)
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '')
}
const { createClient } = require('@supabase/supabase-js')
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

async function main() {
  const { data: all, error } = await admin.from('invoices').select('invoice_type, status')
  if (error) { console.error(error); process.exit(1) }

  const grid = {}
  for (const inv of all) {
    grid[inv.invoice_type] = grid[inv.invoice_type] || {}
    grid[inv.invoice_type][inv.status] = (grid[inv.invoice_type][inv.status] || 0) + 1
  }
  console.log('Invoice count by type x status:')
  console.table(grid)

  const { data: custs } = await admin.from('customers').select('customer_type')
  const custTypes = {}
  for (const c of custs) custTypes[c.customer_type] = (custTypes[c.customer_type] || 0) + 1
  console.log('\nCustomer count by customer_type:')
  console.table(custTypes)
}
main()
