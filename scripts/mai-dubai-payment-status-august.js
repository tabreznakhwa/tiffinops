// READ-ONLY diagnostic. Mai Dubai area customers — August 2026 billing cycle only.
// For each customer with an August invoice (billing_period_end in Aug 2026,
// status not draft/cancelled): billed, paid, pending, and paid/pending flag.
const fs = require('fs')
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/)
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '')
}
const { createClient } = require('@supabase/supabase-js')
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

const PAGE = 1000
async function fetchAll(build) {
  const out = []; let o = 0
  while (true) { const { data, error } = await build(o, o + PAGE - 1); if (error) throw error; out.push(...(data ?? [])); if ((data ?? []).length < PAGE) break; o += PAGE }
  return out
}

async function main() {
  const custs = await fetchAll((f, t) =>
    admin.from('customers').select('id, full_name, customer_code').eq('area', 'Mai Dubai').range(f, t))
  const custById = new Map(custs.map(c => [c.id, c]))
  const ids = custs.map(c => c.id)

  const invs = await fetchAll((f, t) => admin.from('invoices')
    .select('id, customer_id, invoice_number, status, total_amount, billing_period_start, billing_period_end')
    .in('customer_id', ids)
    .not('status', 'in', '(draft,cancelled)')
    .gte('billing_period_end', '2026-08-01').lte('billing_period_end', '2026-08-31')
    .range(f, t))

  const pays = await fetchAll((f, t) => admin.from('payments')
    .select('invoice_id, amount').in('invoice_id', invs.map(i => i.id)).is('voided_at', null).range(f, t))
  const paidByInv = new Map()
  for (const p of pays) paidByInv.set(p.invoice_id, (paidByInv.get(p.invoice_id) ?? 0) + parseFloat(p.amount))

  // Aggregate per customer (a customer may have >1 August invoice)
  const perCust = new Map()
  for (const i of invs) {
    const billed = parseFloat(i.total_amount)
    const paid = Math.min(paidByInv.get(i.id) ?? 0, billed)
    const agg = perCust.get(i.customer_id) ?? { billed: 0, paid: 0, invoices: 0 }
    agg.billed += billed; agg.paid += paid; agg.invoices += 1
    perCust.set(i.customer_id, agg)
  }

  const rows = [...perCust.entries()].map(([custId, agg]) => {
    const c = custById.get(custId)
    const remaining = agg.billed - agg.paid
    return { name: (c.full_name || '').trim(), code: c.customer_code, invoices: agg.invoices, billed: agg.billed, paid: agg.paid, remaining, status: remaining <= 0.005 ? 'PAID' : 'PENDING' }
  }).sort((a, b) => a.name.localeCompare(b.name))

  const paidRows = rows.filter(r => r.status === 'PAID')
  const pendingRows = rows.filter(r => r.status === 'PENDING')
  const tBilled = rows.reduce((s, r) => s + r.billed, 0)
  const tPaid = rows.reduce((s, r) => s + r.paid, 0)
  const tRem = rows.reduce((s, r) => s + r.remaining, 0)

  console.log(`Mai Dubai — August 2026 cycle: ${rows.length} customers billed`)
  console.log(`Paid: ${paidRows.length}   Pending: ${pendingRows.length}`)
  console.log(`Total billed: AED ${tBilled.toFixed(2)}   Paid: AED ${tPaid.toFixed(2)}   Pending: AED ${tRem.toFixed(2)}`)

  console.log(`\n=== PAID (${paidRows.length}) ===`)
  console.table(paidRows.map(r => ({ name: r.name, code: r.code, billed: r.billed.toFixed(2), paid: r.paid.toFixed(2) })))

  console.log(`\n=== PENDING (${pendingRows.length}) ===`)
  console.table(pendingRows.map(r => ({ name: r.name, code: r.code, billed: r.billed.toFixed(2), paid: r.paid.toFixed(2), pending: r.remaining.toFixed(2) })))
}

main().catch(e => { console.error(e); process.exit(1) })
