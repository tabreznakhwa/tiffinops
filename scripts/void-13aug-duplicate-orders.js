// Void one copy of each duplicate dinner order from the 13 Aug 12:46 double-submit.
// Scope: order_date = 2026-08-13 ONLY, identical content (customer + meal_period +
// items + amount), BOTH copies created 2026-08-13 12:46 — exactly the batch the
// owner confirmed. Voids the copy with the higher order_number, same fields the
// app's voidOrder() sets. AKASH E2955 (12 Aug) and BACHAN 2702 (27 Jul) pairs are
// out of scope by the date filter — owner confirmed those are genuine.
//
// DRY RUN BY DEFAULT — prints the proposed table, writes nothing.
//   node scripts/void-13aug-duplicate-orders.js            (dry run)
//   node scripts/void-13aug-duplicate-orders.js --confirm  (writes for real)
const fs = require('fs')
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/)
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '')
}
const { createClient } = require('@supabase/supabase-js')
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

const CONFIRM = process.argv.includes('--confirm')
const DATE = '2026-08-13'
const BATCH_MINUTE = '2026-08-13T12:46' // both copies must be created in this minute
const REASON = 'Duplicate entry — 13 Aug backfill double-submit (confirmed by owner)'

const PAGE = 1000
async function fetchAll(build) {
  const out = []; let o = 0
  while (true) { const { data, error } = await build(o, o + PAGE - 1); if (error) throw error; out.push(...(data ?? [])); if ((data ?? []).length < PAGE) break; o += PAGE }
  return out
}

async function main() {
  const { data: owner, error: ownerErr } = await admin.from('users').select('id, full_name').eq('role', 'owner').limit(1).single()
  if (ownerErr || !owner) throw new Error('Could not find owner user: ' + (ownerErr?.message ?? 'none'))

  const orders = await fetchAll((f, t) => admin.from('orders')
    .select('id, order_number, customer_id, order_date, total_amount, meal_period, created_at, customers(full_name, customer_code)')
    .eq('order_date', DATE).is('voided_at', null).range(f, t))

  const items = await fetchAll((f, t) => admin.from('order_items')
    .select('order_id, item_name_snapshot, quantity, unit_price')
    .in('order_id', orders.map(o => o.id)).range(f, t))
  const itemsByOrder = {}
  for (const it of items) (itemsByOrder[it.order_id] = itemsByOrder[it.order_id] || []).push(`${it.quantity}x ${it.item_name_snapshot}@${it.unit_price}`)

  const groups = {}
  for (const o of orders) {
    const sig = `${o.customer_id}|${o.meal_period || ''}|${(itemsByOrder[o.id] || []).sort().join(' + ')}|${o.total_amount}`
    ;(groups[sig] = groups[sig] || []).push(o)
  }

  const toVoid = []
  for (const g of Object.values(groups)) {
    if (g.length !== 2) continue
    if (!g.every(o => String(o.created_at).startsWith(BATCH_MINUTE))) continue
    g.sort((a, b) => a.order_number.localeCompare(b.order_number))
    toVoid.push({ keep: g[0], drop: g[1] })
  }

  console.log(`${CONFIRM ? 'CONFIRM MODE' : 'DRY RUN'} — pairs found: ${toVoid.length}`)
  console.table(toVoid.map(p => ({
    customer: `${p.keep.customers.full_name} (${p.keep.customers.customer_code})`,
    meal: p.keep.meal_period,
    amount: p.keep.total_amount,
    KEEP: p.keep.order_number,
    VOID: p.drop.order_number,
  })))
  const total = toVoid.reduce((s, p) => s + parseFloat(p.drop.total_amount), 0)
  console.log('Total value to void: AED', total.toFixed(2))

  if (!CONFIRM) { console.log('\nDry run only — re-run with --confirm to apply.'); return }

  let ok = 0
  for (const p of toVoid) {
    const { error } = await admin.from('orders')
      .update({
        order_status: 'voided',
        voided_at: new Date().toISOString(),
        voided_by: owner.id,
        void_reason: REASON,
      })
      .eq('id', p.drop.id)
      .is('voided_at', null)
    if (error) console.error('FAILED', p.drop.order_number, error.message)
    else ok++
  }
  console.log(`\nVoided ${ok}/${toVoid.length} orders (voided_by: ${owner.full_name}).`)
}

main().catch(e => { console.error(e); process.exit(1) })
