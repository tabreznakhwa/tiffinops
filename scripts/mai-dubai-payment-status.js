// READ-ONLY diagnostic. Mai Dubai area customers: how many have fully paid
// vs how much is currently pending, across all their invoices (not scoped
// to a single month). "Paid" = no outstanding balance on any non-draft,
// non-void invoice. "Pending" = sum of (billed - paid) over unpaid invoices.
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
    admin.from('customers').select('id, full_name, customer_code, status').eq('area', 'Mai Dubai').range(f, t))
  console.log(`Mai Dubai customers: ${custs.length} (active: ${custs.filter(c => c.status === 'active').length})`)
  const ids = custs.map(c => c.id)
  const custById = new Map(custs.map(c => [c.id, c]))

  // Only invoices that actually carry a balance obligation (exclude draft/void/cancelled)
  const invs = await fetchAll((f, t) => admin.from('invoices')
    .select('id, customer_id, invoice_number, status, total_amount, billing_period_start, billing_period_end')
    .in('customer_id', ids)
    .not('status', 'in', '(draft,cancelled)')
    .range(f, t))

  const pays = await fetchAll((f, t) => admin.from('payments')
    .select('invoice_id, amount').in('invoice_id', invs.map(i => i.id)).is('voided_at', null).range(f, t))
  const paidByInv = new Map()
  for (const p of pays) paidByInv.set(p.invoice_id, (paidByInv.get(p.invoice_id) ?? 0) + parseFloat(p.amount))

  // Aggregate per customer
  const perCust = new Map()
  for (const c of custs) perCust.set(c.id, { billed: 0, paid: 0, remaining: 0, invoices: 0 })
  for (const i of invs) {
    const billed = parseFloat(i.total_amount)
    const paid = Math.min(paidByInv.get(i.id) ?? 0, billed)
    const agg = perCust.get(i.customer_id)
    agg.billed += billed
    agg.paid += paid
    agg.remaining += billed - paid
    agg.invoices += 1
  }

  const rows = custs.map(c => ({ name: (c.full_name || '').trim(), code: c.customer_code, status: c.status, ...perCust.get(c.id) }))
    .sort((a, b) => b.remaining - a.remaining)

  const fullyPaid = rows.filter(r => r.invoices > 0 && r.remaining <= 0.005)
  const pending = rows.filter(r => r.remaining > 0.005)
  const noInvoices = rows.filter(r => r.invoices === 0)

  const totalPending = pending.reduce((s, r) => s + r.remaining, 0)
  const totalBilled = rows.reduce((s, r) => s + r.billed, 0)
  const totalPaid = rows.reduce((s, r) => s + r.paid, 0)

  console.log(`\nFully paid (no outstanding balance): ${fullyPaid.length}`)
  console.log(`Pending (owe money): ${pending.length}`)
  console.log(`No invoices at all: ${noInvoices.length}`)
  console.log(`\nTotal billed:   AED ${totalBilled.toFixed(2)}`)
  console.log(`Total paid:     AED ${totalPaid.toFixed(2)}`)
  console.log(`Total pending:  AED ${totalPending.toFixed(2)}`)

  console.log(`\nCustomers with pending balance (sorted by amount owed):`)
  console.table(pending.map(r => ({ name: r.name, code: r.code, status: r.status, invoices: r.invoices, billed: r.billed.toFixed(2), paid: r.paid.toFixed(2), pending: r.remaining.toFixed(2) })))
}

main().catch(e => { console.error(e); process.exit(1) })
