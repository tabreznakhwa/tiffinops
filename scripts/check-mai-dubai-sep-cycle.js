// READ-ONLY. Mai Dubai shared cycle 2026-08-26..2026-09-25 (invoiced 26 Sep,
// salary lands 27th — see generateMonthlyInvoices.ts).
// 1. Verify every active-with-subscription Mai Dubai customer got an invoice
//    for this exact period.
// 2. List outstanding (issued/partial/overdue) invoices for this period —
//    customer + bill amount + remaining due.
const fs = require('fs')
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/)
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '')
}
const { createClient } = require('@supabase/supabase-js')
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

const PERIOD_START = '2026-08-26'
const PERIOD_END = '2026-09-25'

const PAGE = 1000
async function fetchAll(build) {
  const out = []; let o = 0
  while (true) { const { data, error } = await build(o, o + PAGE - 1); if (error) throw error; out.push(...(data ?? [])); if ((data ?? []).length < PAGE) break; o += PAGE }
  return out
}

async function main() {
  const custs = await fetchAll((f, t) =>
    admin.from('customers').select('id, full_name, customer_code, status').eq('area', 'Mai Dubai').range(f, t))
  const custById = new Map(custs.map(c => [c.id, c]))
  console.log(`Mai Dubai customers: ${custs.length} total, ${custs.filter(c => c.status === 'active').length} active`)

  // Active subscriptions that overlap this cycle at all (join/pause/end edge cases included)
  const subs = await fetchAll((f, t) => admin.from('customer_subscriptions')
    .select('customer_id, status, start_date, end_date')
    .in('customer_id', custs.map(c => c.id))
    .lte('start_date', PERIOD_END)
    .or(`end_date.is.null,end_date.gte.${PERIOD_START}`)
    .range(f, t))
  const custIdsWithSub = new Set(subs.map(s => s.customer_id))

  const invs = await fetchAll((f, t) => admin.from('invoices')
    .select('id, customer_id, invoice_number, status, total_amount, billing_period_start, billing_period_end, invoice_type')
    .in('customer_id', custs.map(c => c.id))
    .eq('billing_period_start', PERIOD_START)
    .eq('billing_period_end', PERIOD_END)
    .range(f, t))

  console.log(`\nInvoices found for ${PERIOD_START}..${PERIOD_END}: ${invs.length}`)
  console.table(invs.map(i => ({ inv: i.invoice_number, customer: custById.get(i.customer_id)?.full_name, type: i.invoice_type, status: i.status, total: i.total_amount })))

  const invoicedCustIds = new Set(invs.map(i => i.customer_id))
  const missing = custs.filter(c => custIdsWithSub.has(c.id) && c.status === 'active' && !invoicedCustIds.has(c.id))
  console.log(`\nActive Mai Dubai customers with a subscription covering this cycle but NO invoice for it: ${missing.length}`)
  if (missing.length) console.table(missing.map(c => ({ name: c.full_name, code: c.customer_code })))

  // Outstanding = issued/partial/overdue, remaining > 0
  const outstanding = invs.filter(i => ['issued', 'partial', 'overdue'].includes(i.status))
  const pays = await fetchAll((f, t) => admin.from('payments')
    .select('invoice_id, amount').in('invoice_id', outstanding.map(i => i.id)).is('voided_at', null).range(f, t))
  const paidByInv = new Map()
  for (const p of pays) paidByInv.set(p.invoice_id, (paidByInv.get(p.invoice_id) ?? 0) + parseFloat(p.amount))

  const rows = outstanding.map(i => {
    const c = custById.get(i.customer_id)
    const billed = parseFloat(i.total_amount)
    const paid = Math.min(paidByInv.get(i.id) ?? 0, billed)
    return { name: (c?.full_name || '').trim(), code: c?.customer_code, inv: i.invoice_number, status: i.status, billed, paid, remaining: billed - paid }
  }).filter(r => r.remaining > 0.005).sort((a, b) => a.name.localeCompare(b.name))

  console.log(`\nOutstanding invoices for this cycle: ${rows.length}`)
  console.table(rows.map(r => ({ ...r, billed: r.billed.toFixed(2), paid: r.paid.toFixed(2), remaining: r.remaining.toFixed(2) })))
  console.log(`\nTotal billed: AED ${rows.reduce((s, r) => s + r.billed, 0).toFixed(2)}`)
  console.log(`Total outstanding: AED ${rows.reduce((s, r) => s + r.remaining, 0).toFixed(2)}`)
}

main().catch(e => { console.error('FAILED:', e.message); process.exit(1) })
