// Fix Ayaan Abu Hail AC-CUST-00166 (owner clarified 2026-09-01):
// prepaid dinner customer, 220/mo before, 250/mo from Aug; Apr-Jun tracked
// outside the system. DB had 3 overlapping subs (250 from 01 Apr open,
// 250 14-18 Jul, 220 19-26 Jul cancelled) and ZERO invoices ever.
//
// 1. Rebuild subs: 220 Jul (01-31 Jul, completed) + 250 from 01 Aug (active);
//    delete the junk cancelled 19-26 Jul row (audit snapshot kept).
// 2. Backfill fixed_monthly invoices Jul 220 / Aug 250 / Sep 250 following
//    generatePrepaidInvoices + bulkIssueDraftInvoices conventions (line item,
//    tax = total*5/105, ledger debit on issue).
// 3. Link PAY-00091 -> Jul, PAY-00209 -> Aug; mark both paid. Sep stays issued.
// 4. Verify ledger balance = invoiced - paid = 250 (September due).
const fs = require('fs')
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/)
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '')
}
const { createClient } = require('@supabase/supabase-js')
const a = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
const OWNER = 'a277b0b4-7869-4c7f-bab3-99b522d249f3'
const CID = '446b90ce-cf10-4a5c-b591-baffe3040f8b'

const SUB_MAIN = '609e445a-9819-492d-b749-919e46fe3cee' // 250 active, start 01 Apr -> becomes 01 Aug
const SUB_JUL  = '70739bc0-291a-46bd-a378-bfd37c1f9dbc' // 14-18 Jul 250 -> becomes 01-31 Jul 220
const SUB_JUNK = '4476f590-7bc7-494d-9b7d-44b0d13fe328' // 19-26 Jul 220 cancelled -> delete
const PLAN_220 = '79cc6d75-4f7a-4d43-9b9d-6859ba248667' // "Dinner 220"

const NOTE = 'Backfilled 2026-09-01: prepaid anniversary invoice created retroactively (plan history corrected — 220/mo Jul, 250/mo from Aug; Apr–Jun settled outside system per owner)'

async function audit(table, id, oldV, newV) {
  const { error } = await a.from('audit_logs').insert({
    table_name: table, record_id: id, action: 'update',
    old_value: oldV, new_value: newV, user_id: OWNER,
  })
  if (error) throw error
}

async function makeInvoice({ date, periodEnd, amount, planName, monthLabel }) {
  const { data: num, error: numErr } = await a.rpc('next_invoice_number')
  if (numErr || !num) throw numErr || new Error('no invoice number')
  const tax = (amount * 5 / 105).toFixed(2)
  const { data: inv, error: insErr } = await a.from('invoices').insert({
    invoice_number: num, customer_id: CID,
    invoice_date: date, due_date: date,
    invoice_type: 'fixed_monthly',
    billing_period_start: date, billing_period_end: periodEnd,
    subtotal: amount.toFixed(2), discount_amount: '0.00',
    tax_amount: tax, total_amount: amount.toFixed(2),
    status: 'issued', notes: NOTE, created_by: OWNER,
  }).select('id, invoice_number').single()
  if (insErr || !inv) throw insErr || new Error('invoice insert failed')
  const { error: itemErr } = await a.from('invoice_items').insert({
    invoice_id: inv.id, order_id: null,
    description: `Monthly Fixed Plan — ${planName} — ${monthLabel}`,
    quantity: '1', unit_price: amount.toFixed(2), total_price: amount.toFixed(2),
  })
  if (itemErr) throw itemErr
  const { error: ledErr } = await a.from('ledger_entries').insert({
    customer_id: CID, entry_date: date, entry_type: 'invoice',
    debit_amount: amount.toFixed(2), credit_amount: '0.00',
    description: `Invoice ${inv.invoice_number}`,
    reference_table: 'invoices', reference_id: inv.id, created_by: OWNER,
  })
  if (ledErr) throw ledErr
  console.log('created', inv.invoice_number, monthLabel, amount.toFixed(2))
  return inv
}

async function main() {
  // ── 1. subscriptions ──
  const { data: s1, error: e1 } = await a.from('customer_subscriptions')
    .update({ start_date: '2026-08-01' })
    .eq('id', SUB_MAIN).eq('start_date', '2026-04-01').select('id')
  if (e1) throw e1
  if (!s1.length) { // resumable: prior run may have applied this before failing
    const { data: cur } = await a.from('customer_subscriptions').select('start_date').eq('id', SUB_MAIN).single()
    if (cur.start_date !== '2026-08-01') throw new Error('sub main unexpected state: ' + cur.start_date)
    console.log('sub main already at 2026-08-01 (resume)')
  }
  await audit('customer_subscriptions', SUB_MAIN,
    { start_date: '2026-04-01', agreed_monthly_price: 250, status: 'active' },
    { start_date: '2026-08-01', note: 'Owner: 250 plan began Aug 2026, not Apr; Apr–Jun untracked' })

  const { data: s2, error: e2 } = await a.from('customer_subscriptions')
    .update({ start_date: '2026-07-01', end_date: '2026-07-31', agreed_monthly_price: 220, fixed_plan_id: PLAN_220 })
    .eq('id', SUB_JUL).eq('start_date', '2026-07-14').select('id')
  if (e2 || !s2.length) throw e2 || new Error('sub jul update 0 rows')
  await audit('customer_subscriptions', SUB_JUL,
    { start_date: '2026-07-14', end_date: '2026-07-18', agreed_monthly_price: 250, status: 'completed' },
    { start_date: '2026-07-01', end_date: '2026-07-31', agreed_monthly_price: 220, note: 'Owner: July was the 220/mo Dinner plan, full month, paid' })

  await audit('customer_subscriptions', SUB_JUNK,
    { start_date: '2026-07-19', end_date: '2026-07-26', agreed_monthly_price: 220, status: 'cancelled' },
    { note: 'Deleted junk overlapping row during Ayaan plan-history correction' })
  const { data: s3, error: e3 } = await a.from('customer_subscriptions')
    .delete().eq('id', SUB_JUNK).eq('status', 'cancelled').select('id')
  if (e3 || !s3.length) throw e3 || new Error('junk sub delete 0 rows')
  console.log('subs rebuilt: Jul=220 (completed), Aug+ =250 (active), junk row deleted')

  // ── 2. invoices ──
  const jul = await makeInvoice({ date: '2026-07-01', periodEnd: '2026-07-31', amount: 220, planName: 'Dinner 220', monthLabel: 'July 2026' })
  const aug = await makeInvoice({ date: '2026-08-01', periodEnd: '2026-08-31', amount: 250, planName: 'DINNER', monthLabel: 'August 2026' })
  await makeInvoice({ date: '2026-09-01', periodEnd: '2026-09-30', amount: 250, planName: 'DINNER', monthLabel: 'September 2026' })

  // ── 3. link payments + mark paid ──
  for (const [payNum, inv] of [['PAY-00091', jul], ['PAY-00209', aug]]) {
    const { data: p, error: pe } = await a.from('payments')
      .update({ invoice_id: inv.id })
      .eq('payment_number', payNum).eq('customer_id', CID).is('invoice_id', null).select('amount')
    if (pe || !p.length) throw pe || new Error(payNum + ' link 0 rows')
    const { error: se } = await a.from('invoices').update({ status: 'paid' }).eq('id', inv.id).eq('status', 'issued')
    if (se) throw se
    console.log(payNum, '(' + p[0].amount + ') ->', inv.invoice_number, '=> paid')
  }

  // ── 4. verify ──
  const { data: le } = await a.from('ledger_entries').select('debit_amount, credit_amount').eq('customer_id', CID)
  const bal = le.reduce((s, e) => s + parseFloat(e.debit_amount || 0) - parseFloat(e.credit_amount || 0), 0)
  const { data: fi } = await a.from('invoices').select('invoice_number, billing_period_start, total_amount, status').eq('customer_id', CID).order('billing_period_start')
  console.log('invoices:', fi.map(i => `${i.invoice_number} ${i.billing_period_start.slice(0, 7)} ${i.total_amount} ${i.status}`).join(' | '))
  console.log('ledger balance:', bal.toFixed(2), '(expect 250.00 — September due)')
}

main().catch(e => { console.error(e); process.exit(1) })
