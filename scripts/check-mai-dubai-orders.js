// READ-ONLY diagnostic — no writes. "Mai Dubai" is an AREA (the water factory);
// find the last bill generation for its customers and from which date orders stop.
const fs = require('fs')
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/)
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '')
}
const { createClient } = require('@supabase/supabase-js')
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

const PAGE = 1000
async function fetchAll(build) {
  const out = []
  let offset = 0
  while (true) {
    const { data, error } = await build(offset, offset + PAGE - 1)
    if (error) throw error
    out.push(...(data ?? []))
    if ((data ?? []).length < PAGE) break
    offset += PAGE
  }
  return out
}

async function main() {
  const custs = await fetchAll((f, t) =>
    admin.from('customers').select('id, full_name, customer_code, status').ilike('area', '%mai%dubai%').range(f, t))
  console.log(`Mai Dubai area customers: ${custs.length} (active: ${custs.filter(c => c.status === 'active').length})`)
  const ids = custs.map(c => c.id)
  const nameById = Object.fromEntries(custs.map(c => [c.id, c.full_name]))

  // Latest invoices for these customers
  const invoices = await fetchAll((f, t) =>
    admin.from('invoices')
      .select('customer_id, invoice_number, invoice_type, status, invoice_date, billing_period_start, billing_period_end, total_amount, created_at')
      .in('customer_id', ids)
      .order('created_at', { ascending: false })
      .range(f, t))
  console.log(`\nTotal invoices for Mai Dubai customers: ${invoices.length}`)
  console.log('\nMost recent 10 invoices (by created_at):')
  console.table(invoices.slice(0, 10).map(i => ({
    customer: nameById[i.customer_id], no: i.invoice_number, type: i.invoice_type, status: i.status,
    inv_date: i.invoice_date, period: `${i.billing_period_start} → ${i.billing_period_end}`,
    amount: i.total_amount, created: (i.created_at || '').slice(0, 16),
  })))

  // Distribution of billing_period_end (the "last bills generation")
  const byPeriodEnd = {}
  for (const i of invoices) {
    const k = i.billing_period_end || '(none)'
    byPeriodEnd[k] = (byPeriodEnd[k] || 0) + 1
  }
  const ends = Object.entries(byPeriodEnd).sort((a, b) => a[0].localeCompare(b[0]))
  console.log('\nInvoice count by billing_period_end (last 12):')
  console.table(ends.slice(-12).map(([end, n]) => ({ period_end: end, invoices: n })))

  const lastEnd = ends.filter(([k]) => k !== '(none)').pop()?.[0]
  console.log(`\nLatest billing_period_end: ${lastEnd}`)

  // Orders per day since 10 days before last period end
  const fromDate = new Date(new Date(lastEnd).getTime() - 10 * 86400000).toISOString().split('T')[0]
  const orders = await fetchAll((f, t) =>
    admin.from('orders')
      .select('order_date, customer_id, order_status')
      .in('customer_id', ids)
      .gte('order_date', fromDate)
      .order('order_date')
      .range(f, t))

  const perDay = {}
  for (const o of orders) perDay[o.order_date] = (perDay[o.order_date] || 0) + 1
  console.log(`\nOrders per day for Mai Dubai customers since ${fromDate}:`)
  const today = new Date().toISOString().split('T')[0]
  const rows = []
  for (let d = new Date(fromDate); d.toISOString().split('T')[0] <= today; d.setUTCDate(d.getUTCDate() + 1)) {
    const ds = d.toISOString().split('T')[0]
    rows.push({ date: ds, orders: perDay[ds] || 0 })
  }
  console.table(rows)

  const lastOrderDate = Object.keys(perDay).sort().pop()
  console.log(`\nLast date WITH orders: ${lastOrderDate}`)
  const firstMissing = rows.find(r => r.date > (lastOrderDate || '') && r.orders === 0)
  console.log(`Orders missing from: ${firstMissing ? firstMissing.date : '(none — up to date)'} through ${today}`)
}

main().catch(e => { console.error(e); process.exit(1) })
