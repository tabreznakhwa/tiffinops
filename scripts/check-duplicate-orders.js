// READ-ONLY diagnostic — no writes. Detect duplicate orders (same customer +
// same order_date appearing more than once) in the backfill window.
// Usage: node scripts/check-duplicate-orders.js [fromDate] [toDate]
const fs = require('fs')
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/)
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '')
}
const { createClient } = require('@supabase/supabase-js')
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

const FROM = process.argv[2] || '2026-07-26'
const TO = process.argv[3] || '2026-08-26'

const PAGE = 1000
async function fetchAll(build) {
  const out = []; let o = 0
  while (true) { const { data, error } = await build(o, o + PAGE - 1); if (error) throw error; out.push(...(data ?? [])); if ((data ?? []).length < PAGE) break; o += PAGE }
  return out
}

async function main() {
  const custs = await fetchAll((f, t) => admin.from('customers').select('id, full_name, customer_code').range(f, t))
  const nameById = Object.fromEntries(custs.map(c => [c.id, `${c.full_name} (${c.customer_code})`]))

  const orders = await fetchAll((f, t) => admin.from('orders')
    .select('id, order_number, customer_id, order_date, total_amount, order_status, created_at')
    .gte('order_date', FROM).lte('order_date', TO)
    .order('order_date')
    .range(f, t))

  // Group by customer+date
  const groups = {}
  for (const o of orders) {
    const k = `${o.customer_id}|${o.order_date}`
    ;(groups[k] = groups[k] || []).push(o)
  }
  const dupes = Object.values(groups).filter(g => g.length > 1)

  if (!dupes.length) {
    console.log(`NO_DUPLICATES window=${FROM}..${TO} orders=${orders.length}`)
    return
  }
  console.log(`DUPLICATES_FOUND: ${dupes.length} customer-days with more than one order (${FROM}..${TO})`)
  for (const g of dupes.sort((a, b) => a[0].order_date.localeCompare(b[0].order_date))) {
    console.log(`\n${g[0].order_date} — ${nameById[g[0].customer_id]} — ${g.length} orders:`)
    for (const o of g) {
      console.log(`   ${o.order_number}  AED ${o.total_amount}  ${o.order_status}  entered ${String(o.created_at).slice(0, 16)}`)
    }
  }
}

main().catch(e => { console.error(e); process.exit(1) })
