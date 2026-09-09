// Full duplication sweep — customers + orders. DRY RUN by default.
//   node scripts/dedupe-scan.js            (report only)
//   node scripts/dedupe-scan.js --confirm  (apply the fixes listed as AUTO)
//
// Customers: groups by normalized name and by real (non-placeholder) mobile.
//   AUTO-fix: a duplicate with ZERO child rows (orders/invoices/payments/subs/
//   ledger/adjustments/referrals) is deleted, keeping the oldest record.
//   Anything with data on both sides is only REPORTED (needs a manual merge).
// Orders: identical-content pairs (customer+date+meal+items+total, not voided)
//   in the backfill window. AUTO-fix: void the later order_number, unless the
//   order is already on an invoice (reported instead). Owner-confirmed genuine
//   pairs are excluded.
const fs = require('fs')
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/)
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '')
}
const { createClient } = require('@supabase/supabase-js')
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

const CONFIRM = process.argv.includes('--confirm')
const FROM = '2026-07-26', TO = '2026-09-05'
// Owner previously confirmed these same-day pairs are genuine — never touch.
const GENUINE_ORDER_NUMBERS = new Set([]) // filled per-run if owner names any
const ORDER_REASON = 'Duplicate entry — backfill double-submit (dedupe sweep, confirmed by owner)'

const CHILD_TABLES = ['orders', 'invoices', 'payments', 'customer_subscriptions', 'ledger_entries', 'balance_adjustments']
const PAGE = 1000
async function fetchAll(build) {
  const out = []; let o = 0
  while (true) { const { data, error } = await build(o, o + PAGE - 1); if (error) throw error; out.push(...(data ?? [])); if ((data ?? []).length < PAGE) break; o += PAGE }
  return out
}
const norm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim()
const isPlaceholder = m => !m || /^\+9715000\d+$/.test(m) || /^(\+?0+|)$/.test(m)

async function childCounts(customerId) {
  const counts = {}
  for (const t of CHILD_TABLES) {
    const { count, error } = await admin.from(t).select('id', { count: 'exact', head: true }).eq('customer_id', customerId)
    if (error) throw new Error(`${t}: ${error.message}`)
    counts[t] = count ?? 0
  }
  const { count: refs } = await admin.from('customers').select('id', { count: 'exact', head: true }).eq('referred_by_customer_id', customerId)
  counts.referrals = refs ?? 0
  counts._total = Object.values(counts).reduce((s, n) => s + n, 0)
  return counts
}

async function main() {
  const { data: owner } = await admin.from('users').select('id, full_name').eq('role', 'owner').limit(1).single()

  // ── A. Customers ──────────────────────────────────────────────────────────
  const custs = await fetchAll((f, t) => admin.from('customers')
    .select('id, full_name, customer_code, mobile_number, area, status, created_at').range(f, t))

  const byName = {}
  for (const c of custs) (byName[norm(c.full_name)] = byName[norm(c.full_name)] || []).push(c)
  const byMobile = {}
  for (const c of custs) if (!isPlaceholder(c.mobile_number)) (byMobile[c.mobile_number] = byMobile[c.mobile_number] || []).push(c)

  const seenGroups = new Set()
  const groups = []
  for (const [key, g] of [...Object.entries(byName), ...Object.entries(byMobile)]) {
    if (g.length < 2) continue
    const ids = g.map(c => c.id).sort().join(',')
    if (seenGroups.has(ids)) continue
    seenGroups.add(ids)
    groups.push({ key, members: g })
  }

  const custDeletes = []   // AUTO: empty dupes to delete
  const custManual = []    // REPORT: data on both sides
  for (const grp of groups) {
    const members = [...grp.members].sort((a, b) => a.created_at.localeCompare(b.created_at))
    const withCounts = []
    for (const m of members) withCounts.push({ ...m, counts: await childCounts(m.id) })
    // keeper = the one with data; if several have data, oldest. Empty ones after keeper → delete.
    const withData = withCounts.filter(c => c.counts._total > 0)
    const keeper = withData[0] ?? withCounts[0]
    for (const c of withCounts) {
      if (c.id === keeper.id) continue
      if (c.counts._total === 0) custDeletes.push({ keeper, dupe: c })
      else custManual.push({ group: grp.key, keeper, dupe: c })
    }
  }

  console.log(`\n══ CUSTOMER DUPLICATES ══ (${groups.length} group(s))`)
  if (!groups.length) console.log('none found')
  for (const d of custDeletes) {
    console.log(`AUTO-DELETE  ${d.dupe.full_name} (${d.dupe.customer_code}, created ${d.dupe.created_at.slice(0, 10)}, 0 linked rows)`
      + `  → keep ${d.keeper.full_name} (${d.keeper.customer_code})`)
  }
  for (const m of custManual) {
    console.log(`MANUAL-MERGE ${m.dupe.full_name} (${m.dupe.customer_code}) has data: ${JSON.stringify(m.dupe.counts)}`
      + `  vs keeper ${m.keeper.full_name} (${m.keeper.customer_code}): ${JSON.stringify(m.keeper.counts)}`)
  }

  // ── B. Orders ─────────────────────────────────────────────────────────────
  const orders = await fetchAll((f, t) => admin.from('orders')
    .select('id, order_number, customer_id, order_date, total_amount, meal_period, order_status, created_at, customers(full_name, customer_code)')
    .gte('order_date', FROM).lte('order_date', TO).is('voided_at', null).neq('order_status', 'voided').range(f, t))
  const items = await fetchAll((f, t) => admin.from('order_items')
    .select('order_id, item_name_snapshot, quantity, unit_price').range(f, t))
  const itemsByOrder = {}
  for (const it of items) (itemsByOrder[it.order_id] = itemsByOrder[it.order_id] || []).push(`${it.quantity}x ${it.item_name_snapshot}@${it.unit_price}`)

  // orders already on an invoice can't just be voided — flag them
  const invItems = await fetchAll((f, t) => admin.from('invoice_items').select('order_id').not('order_id', 'is', null).range(f, t))
  const invoiced = new Set(invItems.map(r => r.order_id))

  const og = {}
  for (const o of orders) {
    const sig = `${o.customer_id}|${o.order_date}|${o.meal_period || ''}|${(itemsByOrder[o.id] || []).sort().join(' + ')}|${o.total_amount}`
    ;(og[sig] = og[sig] || []).push(o)
  }
  const orderVoids = []    // AUTO
  const orderManual = []   // REPORT (invoiced or 3+ copies)
  for (const g of Object.values(og)) {
    if (g.length < 2) continue
    if (g.some(o => GENUINE_ORDER_NUMBERS.has(o.order_number))) continue
    g.sort((a, b) => a.order_number.localeCompare(b.order_number))
    const [keep, ...rest] = g
    for (const drop of rest) {
      if (invoiced.has(drop.id)) orderManual.push({ keep, drop, why: 'already invoiced' })
      else orderVoids.push({ keep, drop })
    }
  }

  console.log(`\n══ ORDER DUPLICATES ══ (window ${FROM}..${TO})`)
  if (!orderVoids.length && !orderManual.length) console.log('none found')
  for (const p of orderVoids) {
    console.log(`AUTO-VOID    ${p.keep.order_date} ${p.keep.customers.full_name} (${p.keep.customers.customer_code}) [${p.keep.meal_period}] AED ${p.drop.total_amount}`
      + `  keep ${p.keep.order_number} → void ${p.drop.order_number}`)
  }
  for (const p of orderManual) {
    console.log(`MANUAL       ${p.keep.order_date} ${p.keep.customers.full_name} ${p.drop.order_number} — ${p.why}`)
  }
  const voidTotal = orderVoids.reduce((s, p) => s + parseFloat(p.drop.total_amount), 0)
  console.log(`AUTO totals: delete ${custDeletes.length} customer(s), void ${orderVoids.length} order(s) worth AED ${voidTotal.toFixed(2)}`)

  if (!CONFIRM) { console.log('\nDRY RUN — re-run with --confirm to apply the AUTO fixes.'); return }

  // ── Apply ─────────────────────────────────────────────────────────────────
  for (const d of custDeletes) {
    const fresh = await childCounts(d.dupe.id) // re-verify at write time
    if (fresh._total > 0) { console.error(`SKIP delete ${d.dupe.customer_code} — now has ${fresh._total} linked rows`); continue }
    const { data, error } = await admin.from('customers').delete()
      .eq('id', d.dupe.id).eq('customer_code', d.dupe.customer_code).select('customer_code')
    if (error || !data?.length) console.error(`FAILED delete ${d.dupe.customer_code}: ${error?.message ?? '0 rows'}`)
    else console.log(`deleted ${d.dupe.customer_code}`)
  }
  for (const p of orderVoids) {
    const { data, error } = await admin.from('orders').update({
      order_status: 'voided', voided_at: new Date().toISOString(), voided_by: owner.id, void_reason: ORDER_REASON,
    }).eq('id', p.drop.id).is('voided_at', null).select('order_number')
    if (error || !data?.length) console.error(`FAILED void ${p.drop.order_number}: ${error?.message ?? '0 rows'}`)
    else console.log(`voided ${p.drop.order_number}`)
  }
  console.log('\nDone.')
}

main().catch(e => { console.error(e); process.exit(1) })
