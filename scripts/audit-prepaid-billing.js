// Audit: prepaid customers with billing gaps. READ-ONLY — reports, changes nothing.
// For every active/paused customer with payment_terms='prepaid':
//   - cycles started since their current sub's start (anniversary billing)
//   - invoices they actually have (by status), drafts sitting unissued
//   - payments not linked to any invoice
// Categories:
//   NO_INVOICES     zero invoices ever
//   MISSING_CYCLES  fewer invoices than cycles started
//   DRAFT_STUCK     has draft invoice(s) never issued
//   OK              invoice per cycle, no drafts
const fs = require('fs')
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/)
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '')
}
const { createClient } = require('@supabase/supabase-js')
const a = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
const TODAY = '2026-09-02'

const PAGE = 1000
async function fetchAll(build) {
  const out = []; let o = 0
  while (true) { const { data, error } = await build(o, o + PAGE - 1); if (error) throw error; out.push(...(data ?? [])); if ((data ?? []).length < PAGE) break; o += PAGE }
  return out
}

// Number of billing cycles started from startDate through today (>=1 once started).
function cyclesStarted(startDate, today) {
  if (startDate > today) return 0
  const sy = +startDate.slice(0, 4), sm = +startDate.slice(5, 7), sd = +startDate.slice(8, 10)
  const ty = +today.slice(0, 4), tm = +today.slice(5, 7)
  let n = (ty - sy) * 12 + (tm - sm)
  const dim = new Date(ty, tm, 0).getDate()
  const annivDay = Math.min(sd, dim)
  if (+today.slice(8, 10) >= annivDay) n += 1
  return Math.max(1, n)
}

async function main() {
  const custs = await fetchAll((f, t) => a.from('customers')
    .select('id, full_name, customer_code, area, status, payment_terms, customer_type')
    .eq('payment_terms', 'prepaid').in('status', ['active', 'paused']).range(f, t))
  const ids = custs.map(c => c.id)
  const subs = await fetchAll((f, t) => a.from('customer_subscriptions')
    .select('customer_id, start_date, end_date, agreed_monthly_price, status').in('customer_id', ids).range(f, t))
  const invs = await fetchAll((f, t) => a.from('invoices')
    .select('customer_id, invoice_number, billing_period_start, total_amount, status').in('customer_id', ids).range(f, t))
  const pays = await fetchAll((f, t) => a.from('payments')
    .select('customer_id, amount, invoice_id, voided_at').in('customer_id', ids).is('voided_at', null).range(f, t))

  const subsBy = {}, invsBy = {}, paysBy = {}
  for (const s of subs) (subsBy[s.customer_id] = subsBy[s.customer_id] || []).push(s)
  for (const i of invs) (invsBy[i.customer_id] = invsBy[i.customer_id] || []).push(i)
  for (const p of pays) (paysBy[p.customer_id] = paysBy[p.customer_id] || []).push(p)

  const cats = { NO_INVOICES: [], MISSING_CYCLES: [], DRAFT_STUCK: [], OK: 0, NO_ACTIVE_SUB: [] }
  for (const c of custs) {
    const cs = (subsBy[c.id] || []).filter(s => s.status === 'active' || s.status === 'paused')
      .sort((x, y) => y.start_date.localeCompare(x.start_date))
    const cur = cs[0]
    const cInvs = invsBy[c.id] || []
    const real = cInvs.filter(i => !['cancelled', 'written_off'].includes(i.status))
    const drafts = real.filter(i => i.status === 'draft')
    const nonDraft = real.filter(i => i.status !== 'draft')
    const cPays = paysBy[c.id] || []
    const paid = cPays.reduce((s, p) => s + parseFloat(p.amount), 0)
    const unlinked = cPays.filter(p => !p.invoice_id).reduce((s, p) => s + parseFloat(p.amount), 0)
    if (!cur) { if (real.length || paid) cats.NO_ACTIVE_SUB.push({ c, inv: real.length, paid }); continue }
    const rate = parseFloat(cur.agreed_monthly_price)
    const nCycles = cyclesStarted(cur.start_date, TODAY)
    const row = {
      code: c.customer_code, name: c.full_name.trim(), area: c.area || '?', rate,
      start: cur.start_date, cycles: nCycles, invoices: nonDraft.length, drafts: drafts.length,
      draftNums: drafts.map(d => d.invoice_number).join(','),
      paid: paid.toFixed(2), unlinked: unlinked.toFixed(2),
      estDue: Math.max(0, nCycles * rate - paid).toFixed(2),
    }
    if (real.length === 0) cats.NO_INVOICES.push(row)
    else if (drafts.length > 0) cats.DRAFT_STUCK.push(row)
    else if (nonDraft.length < nCycles) cats.MISSING_CYCLES.push(row)
    else cats.OK++
  }

  const p = r => `${r.name} (${r.code}) [${r.area}] ${r.rate}/mo from ${r.start} | cycles ${r.cycles}, invoices ${r.invoices}, drafts ${r.drafts}${r.draftNums ? ' (' + r.draftNums + ')' : ''} | paid ${r.paid} (unlinked ${r.unlinked}) | est due ${r.estDue}`
  for (const key of ['NO_INVOICES', 'DRAFT_STUCK', 'MISSING_CYCLES']) {
    const list = cats[key].sort((a2, b2) => parseFloat(b2.estDue) - parseFloat(a2.estDue))
    console.log(`\n== ${key} (${list.length}) ==`)
    for (const r of list) console.log(p(r))
    const due = list.reduce((s, r) => s + parseFloat(r.estDue), 0)
    console.log(`   subtotal est due: ${due.toFixed(2)}`)
  }
  console.log(`\n== NO_ACTIVE_SUB but has invoices/payments (${cats.NO_ACTIVE_SUB.length}) ==`)
  for (const r of cats.NO_ACTIVE_SUB) console.log(`${r.c.full_name.trim()} (${r.c.customer_code}) [${r.c.area || '?'}] invoices ${r.inv}, paid ${r.paid}`)
  console.log(`\nOK: ${cats.OK} | total prepaid audited: ${custs.length}`)
}

main().catch(e => { console.error(e); process.exit(1) })
