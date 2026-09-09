// Backfill Umair Malik AC-CUST-00186 (owner confirmed 2026-09-01):
// prepaid 420/mo since 20 Apr, anniversary the 20th, ZERO invoices ever
// (Hor Al-Anz — skipped by the Mai Dubai-only billing runs).
// Owner: only the current cycle (20 Aug – 19 Sep) is unpaid; Jun+Jul cycles
// were settled in CASH that was never recorded.
//
// 1. Create the 5 cycle invoices (Apr..Aug starts, 420 each) — issued.
// 2. Link recorded payments FIFO: PAY-00116 (420) -> Apr cycle,
//    PAY-00105+PAY-00125 (220+200) -> May cycle.
// 3. Record 2 retroactive cash payments (420 each, dated at cycle start,
//    note says date approximate) -> Jun & Jul cycles. Payment ledger credits
//    post automatically via trigger.
// 4. Mark those 4 invoices paid; Aug cycle stays issued (420 due).
// 5. Verify ledger balance = 420.
const fs = require('fs')
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/)
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '')
}
const { createClient } = require('@supabase/supabase-js')
const a = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
const OWNER = 'a277b0b4-7869-4c7f-bab3-99b522d249f3'
const CID = '2942941c-9797-4239-bd49-ad5a58374e99'
const PLAN = '420 Plan'
const NOTE = 'Backfilled 2026-09-01: prepaid anniversary invoice created retroactively (customer skipped by earlier Mai Dubai-only billing runs)'

const CYCLES = [
  { start: '2026-04-20', end: '2026-05-19', label: 'April 2026' },
  { start: '2026-05-20', end: '2026-06-19', label: 'May 2026' },
  { start: '2026-06-20', end: '2026-07-19', label: 'June 2026' },
  { start: '2026-07-20', end: '2026-08-19', label: 'July 2026' },
  { start: '2026-08-20', end: '2026-09-19', label: 'August 2026' },
]
const AMT = 420

async function main() {
  const { data: existing } = await a.from('invoices').select('id').eq('customer_id', CID).limit(1)
  if (existing.length) throw new Error('Umair already has invoices — aborting (no double backfill)')

  const invs = []
  for (const c of CYCLES) {
    const { data: num, error: numErr } = await a.rpc('next_invoice_number')
    if (numErr || !num) throw numErr || new Error('no invoice number')
    const { data: inv, error: insErr } = await a.from('invoices').insert({
      invoice_number: num, customer_id: CID,
      invoice_date: c.start, due_date: c.start,
      invoice_type: 'fixed_monthly',
      billing_period_start: c.start, billing_period_end: c.end,
      subtotal: AMT.toFixed(2), discount_amount: '0.00',
      tax_amount: (AMT * 5 / 105).toFixed(2), total_amount: AMT.toFixed(2),
      status: 'issued', notes: NOTE, created_by: OWNER,
    }).select('id, invoice_number').single()
    if (insErr || !inv) throw insErr || new Error('invoice insert failed ' + c.start)
    const { error: itemErr } = await a.from('invoice_items').insert({
      invoice_id: inv.id, order_id: null,
      description: `Monthly Fixed Plan — ${PLAN} — ${c.label} (cycle ${c.start} to ${c.end})`,
      quantity: '1', unit_price: AMT.toFixed(2), total_price: AMT.toFixed(2),
    })
    if (itemErr) throw itemErr
    const { error: ledErr } = await a.from('ledger_entries').insert({
      customer_id: CID, entry_date: c.start, entry_type: 'invoice',
      debit_amount: AMT.toFixed(2), credit_amount: '0.00',
      description: `Invoice ${inv.invoice_number}`,
      reference_table: 'invoices', reference_id: inv.id, created_by: OWNER,
    })
    if (ledErr) throw ledErr
    console.log('created', inv.invoice_number, c.start, '..', c.end)
    invs.push(inv)
  }

  // link recorded payments
  for (const [payNum, inv] of [['PAY-00116', invs[0]], ['PAY-00105', invs[1]], ['PAY-00125', invs[1]]]) {
    const { data: p, error: pe } = await a.from('payments')
      .update({ invoice_id: inv.id })
      .eq('payment_number', payNum).eq('customer_id', CID).is('invoice_id', null).select('amount')
    if (pe || !p.length) throw pe || new Error(payNum + ' link 0 rows')
    console.log(payNum, '(' + p[0].amount + ') ->', inv.invoice_number)
  }

  // retroactive cash payments for Jun + Jul cycles
  for (const [inv, cyc] of [[invs[2], CYCLES[2]], [invs[3], CYCLES[3]]]) {
    const { data: num, error: numErr } = await a.rpc('next_payment_number')
    if (numErr || !num) throw numErr || new Error('no payment number')
    const { error: payErr } = await a.from('payments').insert({
      payment_number: num, customer_id: CID, amount: AMT.toFixed(2),
      mode: 'cash', reference_number: null, payment_date: cyc.start,
      notes: 'Cash payment recorded retroactively 2026-09-01 during invoice backfill — owner confirmed cycle settled in cash; date approximate (cycle start)',
      is_advance: false, invoice_id: inv.id, received_by: OWNER,
    })
    if (payErr) throw payErr
    console.log('cash payment', num, AMT.toFixed(2), '->', inv.invoice_number)
  }

  // mark first 4 cycles paid
  for (const inv of invs.slice(0, 4)) {
    const { error } = await a.from('invoices').update({ status: 'paid' }).eq('id', inv.id).eq('status', 'issued')
    if (error) throw error
  }
  console.log('cycles 1-4 marked paid; ' + invs[4].invoice_number + ' (20 Aug cycle) left issued = 420 due')

  // verify
  const { data: le } = await a.from('ledger_entries').select('debit_amount, credit_amount').eq('customer_id', CID)
  const bal = le.reduce((s, e) => s + parseFloat(e.debit_amount || 0) - parseFloat(e.credit_amount || 0), 0)
  const { data: fi } = await a.from('invoices').select('invoice_number, billing_period_start, total_amount, status').eq('customer_id', CID).order('billing_period_start')
  console.log('invoices:', fi.map(i => `${i.invoice_number} ${i.billing_period_start} ${i.total_amount} ${i.status}`).join(' | '))
  console.log('ledger balance:', bal.toFixed(2), '(expect 420.00)')
}

main().catch(e => { console.error(e); process.exit(1) })
