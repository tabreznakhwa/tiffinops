// READ-ONLY. For the 36 Mai Dubai customers flagged as missing a
// 2026-08-26..2026-09-25 invoice: pull subscription status/type/dates and
// order count in the period, to separate "legitimately nothing to bill"
// (a_la_carte with 0 orders, or subscription paused/ended before the cycle)
// from real gaps in fixed/hybrid customers who should have been billed.
const fs = require('fs')
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/)
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '')
}
const { createClient } = require('@supabase/supabase-js')
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

const PERIOD_START = '2026-08-26'
const PERIOD_END = '2026-09-25'
const CODES = ['AC-CUST-00080','AC-CUST-00201','AC-CUST-00221','AC-CUST-00206','AC-CUST-00017','AC-CUST-00222','AC-CUST-00132','AC-CUST-00008','AC-CUST-00029','AC-CUST-00049','AC-CUST-00051','AC-CUST-00007','AC-CUST-00053','AC-CUST-00025','AC-CUST-00045','AC-CUST-00041','AC-CUST-00042','AC-CUST-00011','AC-CUST-00050','AC-CUST-00012','AC-CUST-00219','AC-CUST-00079','AC-CUST-00115','AC-CUST-00058','AC-CUST-00085','AC-CUST-00116','AC-CUST-00059','AC-CUST-00072','AC-CUST-00124','AC-CUST-00148','AC-CUST-00118','AC-CUST-00121','AC-CUST-00141','AC-CUST-00112','AC-CUST-00057','AC-CUST-00122']

const PAGE = 1000
async function fetchAll(build) {
  const out = []; let o = 0
  while (true) { const { data, error } = await build(o, o + PAGE - 1); if (error) throw error; out.push(...(data ?? [])); if ((data ?? []).length < PAGE) break; o += PAGE }
  return out
}

async function main() {
  const custs = await fetchAll((f, t) => admin.from('customers')
    .select('id, full_name, customer_code, customer_type, status')
    .in('customer_code', CODES).range(f, t))
  const custById = new Map(custs.map(c => [c.id, c]))

  const subs = await fetchAll((f, t) => admin.from('customer_subscriptions')
    .select('customer_id, status, fixed_plan_id, start_date, end_date')
    .in('customer_id', custs.map(c => c.id)).range(f, t))
  const subsByCust = new Map()
  for (const s of subs) { if (!subsByCust.has(s.customer_id)) subsByCust.set(s.customer_id, []); subsByCust.get(s.customer_id).push(s) }

  const orders = await fetchAll((f, t) => admin.from('orders')
    .select('customer_id, order_date')
    .in('customer_id', custs.map(c => c.id))
    .gte('order_date', PERIOD_START).lte('order_date', PERIOD_END)
    .range(f, t))
  const orderCountByCust = new Map()
  for (const o of orders) orderCountByCust.set(o.customer_id, (orderCountByCust.get(o.customer_id) ?? 0) + 1)

  const rows = custs.map(c => {
    const s = subsByCust.get(c.id) ?? []
    return {
      name: c.full_name,
      code: c.customer_code,
      type: c.customer_type,
      subs: s.map(x => `${x.status} [${x.start_date}..${x.end_date ?? 'open'}]`).join(' | ') || 'NONE',
      ordersInPeriod: orderCountByCust.get(c.id) ?? 0,
    }
  }).sort((a, b) => a.name.localeCompare(b.name))

  console.table(rows)

  const aLaCarteZeroOrders = rows.filter(r => r.type === 'a_la_carte' && r.ordersInPeriod === 0)
  const fixedOrHybridGaps = rows.filter(r => r.type !== 'a_la_carte' || r.ordersInPeriod > 0)
  console.log(`\nLikely OK (a_la_carte, zero orders in period — nothing to bill): ${aLaCarteZeroOrders.length}`)
  console.log(`NEEDS ATTENTION (fixed/hybrid, or a_la_carte WITH orders but no invoice): ${fixedOrHybridGaps.length}`)
}

main().catch(e => { console.error('FAILED:', e.message); process.exit(1) })
