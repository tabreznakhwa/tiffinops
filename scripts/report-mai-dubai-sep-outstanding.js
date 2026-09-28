// READ-ONLY. Final deliverable data pull: Mai Dubai 26 Aug - 25 Sep 2026
// outstanding invoices (customer + bill amount), after the stray-invoice
// cleanup + idempotency fix + backfill. Writes JSON to
// scripts/.out-mai-dubai-sep-outstanding.json for the report writeup.
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
  const custs = await fetchAll((f, t) => admin.from('customers').select('id, full_name, customer_code, status').eq('area', 'Mai Dubai').range(f, t))
  const custById = new Map(custs.map(c => [c.id, c]))

  const invs = await fetchAll((f, t) => admin.from('invoices')
    .select('id, customer_id, invoice_number, status, total_amount, billing_period_start, billing_period_end, invoice_type')
    .in('customer_id', custs.map(c => c.id))
    .eq('billing_period_start', PERIOD_START)
    .eq('billing_period_end', PERIOD_END)
    .range(f, t))

  const outstanding = invs.filter(i => ['issued', 'partial', 'overdue'].includes(i.status))
  const pays = await fetchAll((f, t) => admin.from('payments')
    .select('invoice_id, amount').in('invoice_id', outstanding.map(i => i.id)).is('voided_at', null).range(f, t))
  const paidByInv = new Map()
  for (const p of pays) paidByInv.set(p.invoice_id, (paidByInv.get(p.invoice_id) ?? 0) + parseFloat(p.amount))

  const rows = outstanding.map(i => {
    const c = custById.get(i.customer_id)
    const billed = parseFloat(i.total_amount)
    const paid = Math.min(paidByInv.get(i.id) ?? 0, billed)
    return {
      name: (c?.full_name || '').trim(),
      code: c?.customer_code,
      inv: i.invoice_number,
      type: i.invoice_type,
      status: i.status,
      billed: Math.round(billed * 100) / 100,
      paid: Math.round(paid * 100) / 100,
      remaining: Math.round((billed - paid) * 100) / 100,
    }
  }).filter(r => r.remaining > 0.005).sort((a, b) => a.name.localeCompare(b.name))

  const totalBilled = rows.reduce((s, r) => s + r.billed, 0)
  const totalRemaining = rows.reduce((s, r) => s + r.remaining, 0)

  fs.writeFileSync('scripts/.out-mai-dubai-sep-outstanding.json', JSON.stringify({
    periodStart: PERIOD_START, periodEnd: PERIOD_END,
    rows, totalBilled: Math.round(totalBilled * 100) / 100, totalRemaining: Math.round(totalRemaining * 100) / 100,
    count: rows.length,
  }, null, 2))
  console.log(`Wrote ${rows.length} rows, total billed AED ${totalBilled.toFixed(2)}, total outstanding AED ${totalRemaining.toFixed(2)}`)
}
main().catch(e => { console.error('FAILED:', e.message); process.exit(1) })
