// Merge duplicate Shoaib 27 AC-CUST-00009 -> AC-CUST-00013 (owner confirmed
// same person on 2026-09-01, despite different meals on overlapping days).
// Same procedure as the Moiz merge: repoint orders, absorb same-period
// invoices into the keeper's (items + totals + ledger), repoint linked
// payments, reconcile statuses, delete the emptied duplicate.
const fs = require('fs')
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/)
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '')
}
const { createClient } = require('@supabase/supabase-js')
const a = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
const OWNER = 'a277b0b4-7869-4c7f-bab3-99b522d249f3'

async function main() {
  const { data: dupe } = await a.from('customers').select('id').eq('customer_code', 'AC-CUST-00009').single()
  const { data: keeper } = await a.from('customers').select('id').eq('customer_code', 'AC-CUST-00013').single()
  const DUPE = dupe.id, KEEPER = keeper.id

  // 1. orders
  const { data: mo, error: moErr } = await a.from('orders').update({ customer_id: KEEPER }).eq('customer_id', DUPE).select('id')
  if (moErr) throw moErr
  console.log('moved orders:', mo.length)

  // 2. absorb invoices period-by-period
  const { data: dupeInvs } = await a.from('invoices').select('*').eq('customer_id', DUPE).order('billing_period_start')
  for (const di of dupeInvs) {
    const { data: ki } = await a.from('invoices').select('*').eq('customer_id', KEEPER)
      .eq('invoice_type', di.invoice_type).eq('billing_period_start', di.billing_period_start).single()
    if (!ki) throw new Error('no keeper invoice for ' + di.billing_period_start)
    const { data: rp, error: rpErr } = await a.from('payments').update({ invoice_id: ki.id }).eq('invoice_id', di.id).select('payment_number')
    if (rpErr) throw rpErr
    const { data: mi, error: miErr } = await a.from('invoice_items').update({ invoice_id: ki.id }).eq('invoice_id', di.id).select('id')
    if (miErr) throw miErr
    const newSub = (parseFloat(ki.subtotal) + parseFloat(di.subtotal)).toFixed(2)
    const newTotal = (parseFloat(ki.total_amount) + parseFloat(di.total_amount)).toFixed(2)
    const newTax = (parseFloat(newTotal) * 5 / 105).toFixed(2)
    const note = 'Merged ' + di.invoice_number + ' (duplicate Shoaib account AC-CUST-00009) — ' + di.total_amount + ' absorbed'
    const { data: up, error: upErr } = await a.from('invoices').update({
      subtotal: newSub, total_amount: newTotal, tax_amount: newTax,
      notes: ki.notes ? ki.notes + '\n' + note : note,
    }).eq('id', ki.id).eq('total_amount', ki.total_amount).select('id')
    if (upErr || !up.length) throw upErr || new Error('keeper invoice update 0 rows')
    const { error: lErr } = await a.from('ledger_entries').update({ debit_amount: newTotal })
      .eq('reference_table', 'invoices').eq('reference_id', ki.id).eq('entry_type', 'invoice')
    if (lErr) throw lErr
    const { data: dl, error: dlErr } = await a.from('ledger_entries').delete()
      .eq('reference_table', 'invoices').eq('reference_id', di.id).eq('entry_type', 'invoice').select('id')
    if (dlErr) throw dlErr
    await a.from('audit_logs').insert({
      table_name: 'invoices', record_id: ki.id, action: 'update',
      old_value: JSON.stringify({ invoice: ki.invoice_number, total: ki.total_amount }),
      new_value: JSON.stringify({
        total: newTotal, absorbed: di.invoice_number,
        absorbed_header: { number: di.invoice_number, total: di.total_amount, period: di.billing_period_start + '..' + di.billing_period_end, status: di.status },
        payments_repointed: rp.map(p => p.payment_number),
      }),
      changed_by: OWNER,
    })
    const { data: del, error: delErr } = await a.from('invoices').delete().eq('id', di.id).eq('invoice_number', di.invoice_number).select('id')
    if (delErr || !del.length) throw delErr || new Error('dupe invoice delete failed')
    console.log(di.invoice_number, '(' + di.total_amount + ') absorbed into', ki.invoice_number, '-> new total', newTotal,
      '| items:', mi.length, '| payments repointed:', rp.map(p => p.payment_number).join(',') || 'none',
      '| dupe ledger rows removed:', dl.length)
  }

  // 3. remaining children
  for (const t of ['payments', 'ledger_entries', 'customer_subscriptions', 'balance_adjustments']) {
    const { data, error } = await a.from(t).update({ customer_id: KEEPER }).eq('customer_id', DUPE).select('id')
    if (error) throw new Error(t + ': ' + error.message)
    if (data.length) console.log('moved', t + ':', data.length)
  }
  await a.from('customers').update({ referred_by_customer_id: KEEPER }).eq('referred_by_customer_id', DUPE)

  // 4. reconcile keeper invoice statuses from linked payments
  const { data: kInvs } = await a.from('invoices').select('id, invoice_number, total_amount, status').eq('customer_id', KEEPER)
  for (const inv of kInvs) {
    const { data: pays } = await a.from('payments').select('amount').eq('invoice_id', inv.id).is('voided_at', null)
    const paid = pays.reduce((s, p) => s + parseFloat(p.amount), 0), tot = parseFloat(inv.total_amount)
    const next = paid >= tot - 0.01 ? 'paid' : paid > 0 ? 'partial' : 'issued'
    if (next !== inv.status && !['draft', 'cancelled', 'written_off'].includes(inv.status)) {
      await a.from('invoices').update({ status: next }).eq('id', inv.id)
      console.log(inv.invoice_number, 'status', inv.status, '->', next, '(paid', paid.toFixed(2), 'of', tot.toFixed(2) + ')')
    }
  }

  // 5. delete emptied dupe customer
  let total = 0
  for (const t of ['orders', 'invoices', 'payments', 'ledger_entries', 'customer_subscriptions', 'balance_adjustments']) {
    const { count } = await a.from(t).select('id', { count: 'exact', head: true }).eq('customer_id', DUPE)
    total += count ?? 0
  }
  if (total > 0) throw new Error('dupe still has ' + total + ' rows')
  await a.from('audit_logs').insert({
    table_name: 'customers', record_id: KEEPER, action: 'update',
    old_value: JSON.stringify({ merged_from: 'AC-CUST-00009', merged_from_id: DUPE }),
    new_value: JSON.stringify({ note: 'Merged duplicate Shoaib 27 AC-CUST-00009 into AC-CUST-00013 (owner confirmed same person): 125 orders + payments repointed, invoices AC-INV-00112/01110/01470 absorbed into AC-INV-00137/01160/01408' }),
    changed_by: OWNER,
  })
  const { data: del, error: delErr } = await a.from('customers').delete().eq('id', DUPE).eq('customer_code', 'AC-CUST-00009').select('customer_code')
  if (delErr || !del.length) throw delErr || new Error('customer delete failed')
  console.log('deleted customer AC-CUST-00009')

  // 6. verify: ledger balance must equal invoiced - paid
  const { data: le } = await a.from('ledger_entries').select('debit_amount, credit_amount').eq('customer_id', KEEPER)
  const bal = le.reduce((s, e) => s + parseFloat(e.debit_amount || 0) - parseFloat(e.credit_amount || 0), 0)
  const { data: fi } = await a.from('invoices').select('invoice_number, total_amount, status').eq('customer_id', KEEPER).order('billing_period_start')
  const { data: fp } = await a.from('payments').select('amount').eq('customer_id', KEEPER).is('voided_at', null)
  const invSum = fi.reduce((s, i) => s + parseFloat(i.total_amount), 0)
  const paySum = fp.reduce((s, p) => s + parseFloat(p.amount), 0)
  console.log('keeper invoices:', fi.map(i => i.invoice_number + ' ' + i.total_amount + ' ' + i.status).join(' | '))
  console.log('invoiced', invSum.toFixed(2), '- paid', paySum.toFixed(2), '=', (invSum - paySum).toFixed(2), '| ledger balance:', bal.toFixed(2))
}

main().catch(e => { console.error(e); process.exit(1) })
