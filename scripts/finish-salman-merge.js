// Resume/finish the SALMAN AC-CUST-00020 -> SALMAN 2797 AC-CUST-00148 merge
// after scripts/merge-salman-2797.js crashed partway through on 2026-09-09.
//
// State when this picks up:
// - Duplicate order voided, 85 orders moved, May invoice repointed, July
//   invoice absorbed into keeper's AC-INV-01124 — all already done.
// - Still stuck on dupe (AC-CUST-00020): 1 invoice (AC-INV-01308, issued,
//   unpaid, AED 300, August fixed plan), its 1 invoice_item, its 1 ledger
//   entry, and 1 subscription.
//
// AC-INV-01308 cannot be repointed+cancelled onto the keeper the way the
// original script intended: keeper already has its own invoice for the same
// (customer, invoice_type, billing_period_start) — AC-INV-01329, cancelled
// 2026-08-29 as "superseded by cycle invoice AC-INV-01431" — and the DB's
// one-row-per-period idempotency index blocks a second row for that key
// regardless of status. AC-INV-01308's AED 300 in August charges is already
// fully covered by keeper's real August invoice (AC-INV-01431, AED 150,
// issued), and keeper's own cancelled record already documents "don't
// double-bill August" — so there is nothing worth preserving by keeping
// AC-INV-01308 as a separate repointed row. This deletes it outright
// (item + ledger row + invoice) instead, then finishes the subscription
// move and the duplicate customer deletion exactly as the original script
// would have.
//
// DRY RUN BY DEFAULT — writes nothing.
//   node scripts/finish-salman-merge.js
//   node scripts/finish-salman-merge.js --confirm
const fs = require('fs')
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/)
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '')
}
const { createClient } = require('@supabase/supabase-js')
const a = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

const CONFIRM = process.argv.includes('--confirm')
const DUPE_CODE = 'AC-CUST-00020'
const KEEPER_CODE = 'AC-CUST-00148'
const OWNER = 'a277b0b4-7869-4c7f-bab3-99b522d249f3'
const TODAY = new Date().toISOString().slice(0, 10)

const money = n => Math.round((parseFloat(n || 0) + Number.EPSILON) * 100) / 100
const fmt = n => money(n).toFixed(2)

async function mustOne(q, label) {
  const { data, error } = await q.single()
  if (error || !data) throw new Error(`${label}: ${error?.message || 'not found'}`)
  return data
}
async function maybeOne(q) {
  const { data, error } = await q.maybeSingle()
  if (error) throw error
  return data
}

async function main() {
  const dupe = await mustOne(a.from('customers').select('*').eq('customer_code', DUPE_CODE), 'dupe customer')
  const keeper = await mustOne(a.from('customers').select('*').eq('customer_code', KEEPER_CODE), 'keeper customer')
  console.log(`${CONFIRM ? 'CONFIRM' : 'DRY RUN'} — finishing merge ${DUPE_CODE} ${dupe.full_name} -> ${KEEPER_CODE} ${keeper.full_name}`)

  // ── AC-INV-01308: delete instead of repoint (see header comment) ──────────
  const oldAug = await maybeOne(a.from('invoices').select('*').eq('customer_id', dupe.id).eq('invoice_number', 'AC-INV-01308'))
  if (oldAug) {
    const { data: augOrders, error: augErr } = await a.from('orders')
      .select('id').eq('customer_id', dupe.id)
      .gte('order_date', '2026-08-01').lte('order_date', '2026-08-31')
      .is('voided_at', null).not('order_status', 'in', '(cancelled,voided)')
    if (augErr) throw augErr
    console.log(`\nDelete stale ${oldAug.invoice_number} (${fmt(oldAug.total_amount)}): old account August active orders = ${augOrders.length}`)
    if (augOrders.length) throw new Error('Refusing to delete old August invoice because old account has August orders')

    const { data: items } = await a.from('invoice_items').select('id, description, total_price').eq('invoice_id', oldAug.id)
    console.log(`  invoice_items to delete: ${items.length}`, items.map(i => `${i.description} (${fmt(i.total_price)})`))
    const { data: ledger } = await a.from('ledger_entries').select('id, debit_amount').eq('reference_table', 'invoices').eq('reference_id', oldAug.id)
    console.log(`  ledger_entries to delete: ${ledger.length}`, ledger.map(l => fmt(l.debit_amount)))

    if (CONFIRM) {
      const { error: itemErr } = await a.from('invoice_items').delete().eq('invoice_id', oldAug.id)
      if (itemErr) throw itemErr
      const { error: ledErr } = await a.from('ledger_entries').delete().eq('reference_table', 'invoices').eq('reference_id', oldAug.id)
      if (ledErr) throw ledErr
      const { data: del, error: delErr } = await a.from('invoices').delete().eq('id', oldAug.id).eq('invoice_number', oldAug.invoice_number).select('id')
      if (delErr || !del.length) throw delErr || new Error('AC-INV-01308 delete failed')
      console.log(`  deleted ${oldAug.invoice_number}`)
    }
  } else {
    console.log('\nAC-INV-01308 already gone from dupe — nothing to do')
  }

  // ── Subscription: same as original script ──────────────────────────────
  const { data: dupeSubs, error: subErr } = await a.from('customer_subscriptions').select('*').eq('customer_id', dupe.id)
  if (subErr) throw subErr
  console.log('\nOld subscriptions to move/cancel:', dupeSubs.length)
  console.table(dupeSubs.map(s => ({ id: s.id, status: s.status, start: s.start_date, end: s.end_date })))
  if (CONFIRM) {
    for (const sub of dupeSubs) {
      const { error } = await a.from('customer_subscriptions').update({
        customer_id: keeper.id,
        status: sub.status === 'active' ? 'cancelled' : sub.status,
        end_date: sub.end_date || '2026-07-10',
        notes: sub.notes ? `${sub.notes}\n[${TODAY}] Historical subscription moved from duplicate ${DUPE_CODE}; cancelled to prevent duplicate future billing after merge into ${KEEPER_CODE}.` : `[${TODAY}] Historical subscription moved from duplicate ${DUPE_CODE}; cancelled to prevent duplicate future billing after merge into ${KEEPER_CODE}.`,
      }).eq('id', sub.id).eq('customer_id', dupe.id)
      if (error) throw error
    }
  }

  // ── Sweep any remaining rows (mirrors original script) ─────────────────
  for (const t of ['orders', 'invoices', 'payments', 'ledger_entries', 'balance_adjustments']) {
    const { data: existing, error: countErr } = await a.from(t).select('id').eq('customer_id', dupe.id)
    if (countErr) throw new Error(`${t}: ${countErr.message}`)
    console.log(`remaining ${t} to move:`, existing.length)
    if (CONFIRM && existing.length) {
      const { data, error } = await a.from(t).update({ customer_id: keeper.id }).eq('customer_id', dupe.id).select('id')
      if (error) throw new Error(`${t}: ${error.message}`)
      console.log('moved', t, data.length)
    }
  }
  if (CONFIRM) {
    const { error: refErr } = await a.from('customers').update({ referred_by_customer_id: keeper.id }).eq('referred_by_customer_id', dupe.id)
    if (refErr) throw refErr
  }

  // ── Final integrity check + delete dupe customer ────────────────────────
  if (CONFIRM) {
    const { error: auditErr } = await a.from('audit_logs').insert({
      table_name: 'customers', record_id: keeper.id, action: 'update',
      old_value: JSON.stringify({ merged_from: DUPE_CODE, merged_from_id: dupe.id }),
      new_value: JSON.stringify({ note: `Merged duplicate SALMAN ${DUPE_CODE} into SALMAN 2797 ${KEEPER_CODE}: (finish-salman-merge.js) deleted stale unpaid August invoice AC-INV-01308 (already covered by keeper's AC-INV-01431), moved subscription, completed merge.` }),
      user_id: OWNER,
    })
    if (auditErr) throw auditErr

    const childTables = ['orders', 'invoices', 'payments', 'ledger_entries', 'customer_subscriptions', 'balance_adjustments']
    let remaining = 0
    for (const t of childTables) {
      const { count, error } = await a.from(t).select('id', { count: 'exact', head: true }).eq('customer_id', dupe.id)
      if (error) throw new Error(`${t} remaining check: ${error.message}`)
      remaining += count ?? 0
      if (count) console.log('still on dupe', t, count)
    }
    if (remaining) throw new Error(`dupe still has ${remaining} child rows; not deleting customer`)
    const { data: del, error: delErr } = await a.from('customers').delete().eq('id', dupe.id).eq('customer_code', DUPE_CODE).select('customer_code')
    if (delErr || !del.length) throw delErr || new Error('dupe customer delete failed')
    console.log(`\ndeleted duplicate customer ${DUPE_CODE}`)
  } else {
    const childTables = ['orders', 'invoices', 'payments', 'ledger_entries', 'customer_subscriptions', 'balance_adjustments']
    console.log('\n(dry run — customer not deleted; re-check remaining rows after --confirm)')
  }

  const { data: finalInvs, error: fiErr } = await a.from('invoices').select('invoice_number, billing_period_start, billing_period_end, total_amount, status').eq('customer_id', keeper.id).order('billing_period_start')
  if (fiErr) throw fiErr
  const { data: finalPays, error: fpErr } = await a.from('payments').select('amount').eq('customer_id', keeper.id).is('voided_at', null)
  if (fpErr) throw fpErr
  const { data: finalLedger, error: flErr } = await a.from('ledger_entries').select('debit_amount, credit_amount').eq('customer_id', keeper.id)
  if (flErr) throw flErr
  const invSum = money(finalInvs.filter(i => i.status !== 'cancelled').reduce((s, i) => s + parseFloat(i.total_amount || 0), 0))
  const paySum = money(finalPays.reduce((s, p) => s + parseFloat(p.amount || 0), 0))
  const ledBal = money(finalLedger.reduce((s, e) => s + parseFloat(e.debit_amount || 0) - parseFloat(e.credit_amount || 0), 0))
  console.log('\nFinal keeper invoices:')
  console.table(finalInvs.map(i => ({ invoice: i.invoice_number, period: `${i.billing_period_start}..${i.billing_period_end}`, total: fmt(i.total_amount), status: i.status })))
  console.log(`Final active invoice total ${fmt(invSum)} - payments ${fmt(paySum)} = ${fmt(invSum - paySum)} | ledger balance ${fmt(ledBal)}`)
  if (!CONFIRM) console.log('\nDry run only — re-run with --confirm to apply.')
}

main().catch(e => { console.error(e); process.exit(1) })
