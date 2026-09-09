// READ-ONLY watcher — no DB writes. Detects NEW identical-content duplicate
// orders (same customer + date + meal_period + items + amount, non-voided)
// in the backfill window and prints only ones not seen before. Owner rule
// (27 Aug): exact duplicates get voided, but ALWAYS alert the owner first —
// so this script only reports; the void happens separately after the alert.
// State kept in scripts/.dupe-watch-state.json (uncommitted, like all of scripts/).
const fs = require('fs')
const path = require('path')
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/)
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '')
}
const { createClient } = require('@supabase/supabase-js')
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

const FROM = '2026-07-26'
const TO = '2026-09-05'
const STATE_FILE = path.join(__dirname, '.dupe-watch-state.json')

const PAGE = 1000
async function fetchAll(build) {
  const out = []; let o = 0
  while (true) { const { data, error } = await build(o, o + PAGE - 1); if (error) throw error; out.push(...(data ?? [])); if ((data ?? []).length < PAGE) break; o += PAGE }
  return out
}

async function main() {
  const known = new Set(fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) : [])

  const orders = await fetchAll((f, t) => admin.from('orders')
    .select('id, order_number, customer_id, order_date, total_amount, meal_period, created_at, customers(full_name, customer_code)')
    .gte('order_date', FROM).lte('order_date', TO)
    .is('voided_at', null).range(f, t))

  const ids = orders.map(o => o.id)
  const items = []
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = await fetchAll((f, t) => admin.from('order_items')
      .select('order_id, item_name_snapshot, quantity, unit_price')
      .in('order_id', ids.slice(i, i + 200)).range(f, t))
    items.push(...chunk)
  }
  const itemsByOrder = {}
  for (const it of items) (itemsByOrder[it.order_id] = itemsByOrder[it.order_id] || []).push(`${it.quantity}x ${it.item_name_snapshot}@${it.unit_price}`)

  const groups = {}
  for (const o of orders) {
    const k = `${o.customer_id}|${o.order_date}|${o.meal_period || ''}`
    ;(groups[k] = groups[k] || []).push(o)
  }

  const allGroupKeys = []
  for (const g of Object.values(groups).filter(g => g.length > 1)) {
    const bySig = {}
    for (const o of g) {
      const sig = (itemsByOrder[o.id] || []).sort().join(' + ') + '|' + o.total_amount
      ;(bySig[sig] = bySig[sig] || []).push(o)
    }
    for (const [sig, arr] of Object.entries(bySig)) {
      if (arr.length < 2) continue
      const groupKey = arr.map(o => o.id).sort().join(',')
      allGroupKeys.push(groupKey)
      if (known.has(groupKey)) continue
      const c = arr[0].customers
      console.log(`DUPLICATE: ${arr[0].order_date} ${c.full_name} (${c.customer_code}) [${arr[0].meal_period || '?'}] x${arr.length} — ${sig.split('|')[0]} = AED ${arr[0].total_amount} — ${arr.map(o => o.order_number).join(' / ')}`)
    }
  }

  fs.writeFileSync(STATE_FILE, JSON.stringify(allGroupKeys))
}

main().catch(e => { console.error('watch error:', e.message) })
