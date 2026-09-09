// Bulk backfill for CLEAN prepaid billing gaps (owner approved 2026-09-02).
// Scope: the 28 customers from audit-prepaid-billing.js whose unlinked
// payments divide evenly by their current rate (no price-change mystery).
// Odd cases are intentionally excluded — reviewed with the owner one by one.
//
// Per customer:
//   1. Enumerate anniversary cycles from current sub start through today.
//   2. Existing non-cancelled invoices matched by billing_period_start;
//      any mismatch in periods -> SKIP customer, report (no double billing).
//   3. Issue stuck drafts (status -> issued + ledger debit, like
//      bulkIssueDraftInvoices). Create missing cycle invoices (issued, plan
//      line item, ledger debit dated at cycle start, backfill note).
//   4. FIFO-link unlinked payments oldest->oldest cycle; statuses from the
//      allocation (paid / partial). Straddling payments are logged.
//   5. Verify ledger balance == invoiced - paid.
const fs = require('fs')
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/)
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '')
}
const { createClient } = require('@supabase/supabase-js')
const a = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
const OWNER = 'a277b0b4-7869-4c7f-bab3-99b522d249f3'
const TODAY = '2026-09-02'
const NOTE = 'Backfilled 2026-09-02: prepaid anniversary invoice created retroactively (customer skipped by earlier Mai Dubai-only billing runs; bulk clean-case backfill approved by owner)'

const CODES = [
  // never invoiced
  'AC-CUST-00194', 'AC-CUST-00168', 'AC-CUST-00185', 'AC-CUST-00214', 'AC-CUST-00164',
  'AC-CUST-00180', 'AC-CUST-00213', 'AC-CUST-00227', 'AC-CUST-00176', 'AC-CUST-00192',
  'AC-CUST-00163', 'AC-CUST-00183', 'AC-CUST-00226', 'AC-CUST-00218', 'AC-CUST-00165',
  'AC-CUST-00196',
  // draft stuck
  'AC-CUST-00197', 'AC-CUST-00162', 'AC-CUST-00211', 'AC-CUST-00203', 'AC-CUST-00208',
  'AC-CUST-00209', 'AC-CUST-00172', 'AC-CUST-00170', 'AC-CUST-00210', 'AC-CUST-00215',
  'AC-CUST-00212', 'AC-CUST-00182',
]

function daysInMonth(y, m) { return new Date(y, m, 0).getDate() }
function pad(n, w = 2) { return String(n).padStart(w, '0') }
function anniv(startDate, n) { // nth cycle start (n=0 -> start date), day clamped per month
  const day = Number(startDate.slice(8, 10))
  let y = Number(startDate.slice(0, 4))
  let m = Number(startDate.slice(5, 7)) + n
  y += Math.floor((m - 1) / 12); m = ((m - 1) % 12) + 1
  return `${pad(y, 4)}-${pad(m)}-${pad(Math.min(day, daysInMonth(y, m)))}`
}
function addDays(d, n) { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
function monthLabel(d) { const [y, m] = d.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) }

async function processCustomer(code, report) {
  const { data: c } = await a.from('customers').select('id, full_name').eq('customer_code', code).single()
  const { data: subs } = await a.from('customer_subscriptions')
    .select('start_date, end_date, agreed_monthly_price, status, fixed_plans(plan_name)')
    .eq('customer_id', c.id).in('status', ['active', 'paused']).order('start_date', { ascending: false })
  const sub = subs[0]
  if (!sub) { report.push(`SKIP ${code} ${c.full_name}: no active sub`); return }
  const rate = parseFloat(String(sub.agreed_monthly_price))
  const plan = sub.fixed_plans?.plan_name ?? 'Fixed Plan'

  // cycles started through today
  const cycles = []
  for (let n = 0; ; n++) {
    const s = anniv(sub.start_date, n)
    if (s > TODAY) break
    cycles.push({ start: s, end: addDays(anniv(sub.start_date, n + 1), -1) })
  }
  if (!cycles.length) { report.push(`SKIP ${code}: no cycles started`); return }

  const { data: invs } = await a.from('invoices')
    .select('id, invoice_number, billing_period_start, total_amount, status')
    .eq('customer_id', c.id).not('status', 'in', '(cancelled,written_off)')
  const byStart = new Map((invs ?? []).map(i => [i.billing_period_start, i]))
  for (const i of invs ?? []) {
    if (!cycles.some(cy => cy.start === i.billing_period_start)) {
      report.push(`SKIP ${code} ${c.full_name}: invoice ${i.invoice_number} period ${i.billing_period_start} matches no cycle — review manually`)
      return
    }
  }

  const log = []
  const cycleInvs = []
  for (const cy of cycles) {
    let inv = byStart.get(cy.start)
    if (inv && inv.status === 'draft') {
      const { data: up, error: ue } = await a.from('invoices').update({ status: 'issued' }).eq('id', inv.id).eq('status', 'draft').select('id')
      if (ue || !up.length) throw ue || new Error(code + ' draft issue 0 rows')
      const { error: le } = await a.from('ledger_entries').insert({
        customer_id: c.id, entry_date: TODAY, entry_type: 'invoice',
        debit_amount: parseFloat(inv.total_amount).toFixed(2), credit_amount: '0.00',
        description: `Invoice ${inv.invoice_number}`, reference_table: 'invoices', reference_id: inv.id, created_by: OWNER,
      })
      if (le) throw le
      inv.status = 'issued'
      log.push(`issued draft ${inv.invoice_number} (${cy.start})`)
    }
    if (!inv) {
      const { data: num, error: ne } = await a.rpc('next_invoice_number')
      if (ne || !num) throw ne || new Error('no invoice number')
      const { data: created, error: ie } = await a.from('invoices').insert({
        invoice_number: num, customer_id: c.id, invoice_date: cy.start, due_date: cy.start,
        invoice_type: 'fixed_monthly', billing_period_start: cy.start, billing_period_end: cy.end,
        subtotal: rate.toFixed(2), discount_amount: '0.00',
        tax_amount: (rate * 5 / 105).toFixed(2), total_amount: rate.toFixed(2),
        status: 'issued', notes: NOTE, created_by: OWNER,
      }).select('id, invoice_number, billing_period_start, total_amount, status').single()
      if (ie || !created) { report.push(`FAIL ${code}: insert ${cy.start}: ${ie?.message}`); return }
      const { error: ite } = await a.from('invoice_items').insert({
        invoice_id: created.id, order_id: null,
        description: `Monthly Fixed Plan — ${plan} — ${monthLabel(cy.start)} (cycle ${cy.start} to ${cy.end})`,
        quantity: '1', unit_price: rate.toFixed(2), total_price: rate.toFixed(2),
      })
      if (ite) throw ite
      const { error: le } = await a.from('ledger_entries').insert({
        customer_id: c.id, entry_date: cy.start, entry_type: 'invoice',
        debit_amount: rate.toFixed(2), credit_amount: '0.00',
        description: `Invoice ${created.invoice_number}`, reference_table: 'invoices', reference_id: created.id, created_by: OWNER,
      })
      if (le) throw le
      inv = created
      log.push(`created ${created.invoice_number} (${cy.start})`)
    }
    cycleInvs.push(inv)
  }

  // FIFO payment allocation
  const { data: pays } = await a.from('payments')
    .select('id, payment_number, amount, payment_date, invoice_id')
    .eq('customer_id', c.id).is('voided_at', null).order('payment_date')
  const allocated = new Map() // invoice id -> amount
  for (const p of pays ?? []) if (p.invoice_id) allocated.set(p.invoice_id, (allocated.get(p.invoice_id) ?? 0) + parseFloat(p.amount))
  let idx = 0
  for (const p of (pays ?? []).filter(p => !p.invoice_id)) {
    let amt = parseFloat(p.amount)
    // advance to first not-fully-covered invoice
    while (idx < cycleInvs.length && (allocated.get(cycleInvs[idx].id) ?? 0) >= parseFloat(cycleInvs[idx].total_amount) - 0.01) idx++
    if (idx >= cycleInvs.length) { log.push(`payment ${p.payment_number} (${p.amount}) left unlinked — all cycles covered`); continue }
    const target = cycleInvs[idx]
    const { error: pe } = await a.from('payments').update({ invoice_id: target.id }).eq('id', p.id).is('invoice_id', null)
    if (pe) throw pe
    allocated.set(target.id, (allocated.get(target.id) ?? 0) + amt)
    const room = parseFloat(target.total_amount) - (allocated.get(target.id) - amt)
    if (amt > room + 0.01) {
      // overflow spills to next cycle mathematically; link stays on this invoice
      const spill = amt - room
      allocated.set(target.id, parseFloat(target.total_amount))
      if (idx + 1 < cycleInvs.length) {
        const nxt = cycleInvs[idx + 1]
        allocated.set(nxt.id, (allocated.get(nxt.id) ?? 0) + spill)
        log.push(`payment ${p.payment_number} (${p.amount}) straddles ${target.invoice_number} + ${nxt.invoice_number} (linked to first)`)
      } else log.push(`payment ${p.payment_number} overpays final cycle by ${spill.toFixed(2)}`)
    } else log.push(`linked ${p.payment_number} (${p.amount}) -> ${target.invoice_number}`)
  }

  // statuses from allocation
  for (const inv of cycleInvs) {
    const tot = parseFloat(inv.total_amount)
    const got = allocated.get(inv.id) ?? 0
    const next = got >= tot - 0.01 ? 'paid' : got > 0.005 ? 'partial' : 'issued'
    if (next !== inv.status) {
      const { error } = await a.from('invoices').update({ status: next }).eq('id', inv.id)
      if (error) throw error
    }
  }

  // verify
  const { data: le } = await a.from('ledger_entries').select('debit_amount, credit_amount').eq('customer_id', c.id)
  const bal = le.reduce((s, e) => s + parseFloat(e.debit_amount || 0) - parseFloat(e.credit_amount || 0), 0)
  const { data: fInvs } = await a.from('invoices').select('total_amount, status').eq('customer_id', c.id).not('status', 'in', '(cancelled,written_off,draft)')
  const invSum = fInvs.reduce((s, i) => s + parseFloat(i.total_amount), 0)
  const paySum = (pays ?? []).reduce((s, p) => s + parseFloat(p.amount), 0)
  const ok = Math.abs(bal - (invSum - paySum)) < 0.01
  const due = fInvs.filter(i => i.status !== 'paid').length
  report.push(`${ok ? 'OK  ' : 'MISMATCH'} ${code} ${c.full_name.trim()} | ${log.join('; ')} | invoiced ${invSum.toFixed(2)} paid ${paySum.toFixed(2)} balance ${bal.toFixed(2)} | ${due} cycle(s) open`)
}

async function main() {
  const report = []
  for (const code of CODES) {
    try { await processCustomer(code, report) }
    catch (e) { report.push(`ERROR ${code}: ${e.message}`) }
  }
  console.log(report.join('\n'))
  const bad = report.filter(r => !r.startsWith('OK')).length
  console.log(`\n${CODES.length} customers processed, ${bad} need attention`)
}

main().catch(e => { console.error(e); process.exit(1) })
