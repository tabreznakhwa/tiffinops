// READ-ONLY diagnostic — no writes. Checks whether migrations 032/033/034's
// DB objects already exist on the live database.
const fs = require('fs')
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/)
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '')
}
const { createClient } = require('@supabase/supabase-js')
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

async function tableExists(name) {
  const { error } = await admin.from(name).select('*').limit(1)
  // PGRST205 / "does not exist" style errors mean the table is missing
  if (error && /does not exist|schema cache|Could not find/i.test(error.message)) return false
  return true
}

async function rpcExists(name) {
  const { error } = await admin.rpc(name)
  if (error && /does not exist|schema cache|Could not find|function.*does not exist/i.test(error.message)) return false
  return true // exists (even if it errors for other reasons like missing args)
}

async function main() {
  console.log('--- Migration 032 (inventory module) ---')
  for (const t of ['suppliers', 'inventory_items', 'inventory_transactions']) {
    console.log(`  table "${t}":`, await tableExists(t) ? 'EXISTS' : 'MISSING')
  }

  console.log('\n--- Migration 033 (customer_last_payments) ---')
  console.log('  function "customer_last_payments":', await rpcExists('customer_last_payments') ? 'EXISTS' : 'MISSING')

  console.log('\n--- Migration 034 (outstanding_since) ---')
  console.log('  function "customer_outstanding_since":', await rpcExists('customer_outstanding_since') ? 'EXISTS' : 'MISSING')
  console.log('  function "customer_oldest_unpaid_invoice":', await rpcExists('customer_oldest_unpaid_invoice') ? 'EXISTS' : 'MISSING')
}
main()
