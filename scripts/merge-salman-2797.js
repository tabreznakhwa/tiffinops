// Merge duplicate SALMAN AC-CUST-00020 -> SALMAN 2797 AC-CUST-00148.
// Owner confirmed same customer on 2026-09-08.
//
// Safety/billing rules:
// - Keeper is AC-CUST-00148 (current active order stream).
// - Move AC-CUST-00020 orders to keeper.
// - Void exact duplicate orders by date+meal+items+amount (do not duplicate meals).
// - Absorb same July cycle invoice into keeper invoice.
// - Repoint the older May/June invoice to keeper.
// - Cancel stale AC-CUST-00020 August fixed invoice: there are no August orders
//   on that account; August meals are already billed on keeper AC-INV-01431.
// - Cancel/repoint stale old subscription so future billing does not double bill.
//
// DRY RUN BY DEFAULT — writes nothing.
//   node scripts/merge-salman-2797.js
//   node scripts/merge-salman-2797.js --confirm
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
async function all(build) {
  const out = []; let o = 0; const PAGE = 1000
  while (true) {
    const { data, error } = await build(o, o + PAGE - 1)
    if (error) throw error
    out.push(...(data ?? []))
    if ((data ?? []).length < PAGE) break
    o += PAGE
  }
  return out
}
async function orderSignature(orderIds) {
  const items = await all((f, t) => a.from('order_items')
    .select('order_id, item_name_snapshot, quantity, unit_price, total_price')
    .in('order_id', orderIds).range(f, t))
  const byOrder = new Map()
  for (const it of items) {
    const sig = `${it.item_name_snapshot}|${it.quantity}|${it.unit_price}|${it.total_price}`
    if (!byOrder.has(it.order_id)) byOrder.set(it.order_id, [])
    byOrder.get(it.order_id).push(sig)
  }
  for (const arr of byOrder.values()) arr.sort()
  return byOrder
}
async function invoicePaid(invoiceId) {
  const pays = await all((f, t) => a.from('payments').select('amount').eq('invoice_id', invoiceId).is('voided_at', null).range(f, t))
  return money(pays.reduce((s, p) => s + parseFloat(p.amount || 0), 0))
}
async function reconcileInvoiceStatus(invId) {
  const inv = await mustOne(a.from('invoices').select('id, invoice_number, total_amount, status').eq('id', invId), `invoice ${invId}`)
  if (['draft', 'cancelled', 'written_off'].includes(inv.status)) return null
  const paid = await invoicePaid(inv.id)
  const total = money(inv.total_amount)
  const next = paid >= total - 0.01 ? 'paid' : paid > 0 ? 'partial' : 'issued'
  if (next !== inv.status) {
    if (CONFIRM) {
      const { error } = await a.from('invoices').update({ status: next }).eq('id', inv.id)
      if (error) throw error
    }
    return `${inv.invoice_number}: status ${inv.status} -> ${next}`
  }
  return null
}
async function adjustInvoiceForVoidedOrder(orderId, amount, note) {
  const items = await all((f, t) => a.from('invoice_items').select('id, invoice_id, total_price').eq('order_id', orderId).range(f, t))
  if (!items.length) return `no invoice_items linked to voided order ${orderId}`
  const invoiceIds = [...new Set(items.map(i => i.invoice_id))]
  if (invoiceIds.length !== 1) throw new Error(`voided order ${orderId} belongs to multiple invoices`)
  const inv = await mustOne(a.from('invoices').select('*').eq('id', invoiceIds[0]), `invoice for voided order ${orderId}`)
  const itemTotal = money(items.reduce((s, i) => s + parseFloat(i.total_price || 0), 0))
  if (Math.abs(itemTotal - amount) > 0.01) throw new Error(`void item total ${itemTotal} != order amount ${amount}`)
  const oldSubtotal = money(inv.subtotal)
  const oldDiscount = money(inv.discount_amount)
  const oldTotal = money(inv.total_amount)
  let newSubtotal = money(oldSubtotal - itemTotal)
  let newDiscount = oldDiscount
  let newTotal = oldTotal

  // If this invoice was fully discounted, reduce discount along with subtotal so
  // total stays unchanged. Otherwise reduce the actual payable total.
  if (oldDiscount >= itemTotal && oldTotal <= 0.01) {
    newDiscount = money(oldDiscount - itemTotal)
    newTotal = 0
  } else {
    newTotal = money(oldTotal - itemTotal)
  }
  const newTax = money(newTotal * 5 / 105)
  if (CONFIRM) {
    const { error: delErr } = await a.from('invoice_items').delete().eq('order_id', orderId)
    if (delErr) throw delErr
    const { error: upErr } = await a.from('invoices').update({
      subtotal: fmt(newSubtotal),
      discount_amount: fmt(newDiscount),
      total_amount: fmt(newTotal),
      tax_amount: fmt(newTax),
      notes: inv.notes ? `${inv.notes}\n${note}` : note,
    }).eq('id', inv.id).eq('subtotal', inv.subtotal).eq('discount_amount', inv.discount_amount).eq('total_amount', inv.total_amount)
    if (upErr) throw upErr
    const { error: ledErr } = await a.from('ledger_entries')
      .update({ debit_amount: fmt(newTotal) })
      .eq('reference_table', 'invoices').eq('reference_id', inv.id).eq('entry_type', 'invoice')
    if (ledErr) throw ledErr
  }
  return `${inv.invoice_number}: removed duplicate order AED ${fmt(itemTotal)}; subtotal ${fmt(oldSubtotal)} -> ${fmt(newSubtotal)}, discount ${fmt(oldDiscount)} -> ${fmt(newDiscount)}, total ${fmt(oldTotal)} -> ${fmt(newTotal)}`
}

async function main() {
  const dupe = await mustOne(a.from('customers').select('*').eq('customer_code', DUPE_CODE), 'dupe customer')
  const keeper = await mustOne(a.from('customers').select('*').eq('customer_code', KEEPER_CODE), 'keeper customer')
  console.log(`${CONFIRM ? 'CONFIRM' : 'DRY RUN'} — merging ${DUPE_CODE} ${dupe.full_name} -> ${KEEPER_CODE} ${keeper.full_name}`)

  const orders = await all((f, t) => a.from('orders')
    .select('id, order_number, customer_id, order_date, meal_period, total_amount, order_status, voided_at, created_at')
    .in('customer_id', [dupe.id, keeper.id]).range(f, t))
  const sigByOrder = await orderSignature(orders.map(o => o.id))
  const active = orders.filter(o => !o.voided_at && !['cancelled', 'voided'].includes(o.order_status))
  const groups = new Map()
  for (const o of active) {
    const sig = (sigByOrder.get(o.id) || []).join(' + ')
    const key = `${o.order_date}|${o.meal_period}|${fmt(o.total_amount)}|${sig}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(o)
  }
  const toVoid = []
  for (const arr of groups.values()) {
    if (arr.length < 2) continue
    arr.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || a.order_number.localeCompare(b.order_number))
    for (const o of arr.slice(1)) toVoid.push({ keep: arr[0], drop: o })
  }
  console.log('\nExact duplicate active orders to void:', toVoid.length)
  console.table(toVoid.map(p => ({ keep: p.keep.order_number, void: p.drop.order_number, date: p.drop.order_date, meal: p.drop.meal_period, amount: fmt(p.drop.total_amount), account: p.drop.customer_id === dupe.id ? DUPE_CODE : KEEPER_CODE })))

  if (CONFIRM) {
    for (const p of toVoid) {
      const note = `[${TODAY}] Removed exact duplicate order ${p.drop.order_number}; kept ${p.keep.order_number} during ${DUPE_CODE} -> ${KEEPER_CODE} merge.`
      console.log(await adjustInvoiceForVoidedOrder(p.drop.id, money(p.drop.total_amount), note))
      const { error } = await a.from('orders').update({
        order_status: 'voided',
        voided_at: new Date().toISOString(),
        voided_by: OWNER,
        void_reason: `Exact duplicate; kept ${p.keep.order_number} during ${DUPE_CODE} -> ${KEEPER_CODE} merge`,
      }).eq('id', p.drop.id).is('voided_at', null)
      if (error) throw error
    }
  }

  const dupeOrdersToMove = orders.filter(o => o.customer_id === dupe.id && !toVoid.some(v => v.drop.id === o.id))
  console.log('\nOrders to move from dupe to keeper:', dupeOrdersToMove.length)
  if (CONFIRM && dupeOrdersToMove.length) {
    const { data, error } = await a.from('orders').update({ customer_id: keeper.id }).eq('customer_id', dupe.id).select('id')
    if (error) throw error
    console.log('moved orders:', data.length)
  }

  // Invoice handling.
  const oldMay = await maybeOne(a.from('invoices').select('*').eq('customer_id', dupe.id).eq('invoice_number', 'AC-INV-00123'))
  const oldJul = await maybeOne(a.from('invoices').select('*').eq('customer_id', dupe.id).eq('invoice_number', 'AC-INV-01063'))
  const keepJul = await maybeOne(a.from('invoices').select('*').eq('customer_id', keeper.id).eq('invoice_number', 'AC-INV-01124'))
  const oldAug = await maybeOne(a.from('invoices').select('*').eq('customer_id', dupe.id).eq('invoice_number', 'AC-INV-01308'))

  if (oldMay) {
    console.log(`\nRepoint ${oldMay.invoice_number} (${fmt(oldMay.total_amount)}) to keeper`)
    if (CONFIRM) {
      const { error } = await a.from('invoices').update({ customer_id: keeper.id, notes: oldMay.notes ? `${oldMay.notes}\n[${TODAY}] Repointed from duplicate ${DUPE_CODE} during merge into ${KEEPER_CODE}.` : `[${TODAY}] Repointed from duplicate ${DUPE_CODE} during merge into ${KEEPER_CODE}.` }).eq('id', oldMay.id).eq('customer_id', dupe.id)
      if (error) throw error
      const { error: le } = await a.from('ledger_entries').update({ customer_id: keeper.id }).eq('reference_table', 'invoices').eq('reference_id', oldMay.id).eq('entry_type', 'invoice')
      if (le) throw le
    }
  }

  if (oldJul && keepJul) {
    console.log(`\nAbsorb ${oldJul.invoice_number} (${fmt(oldJul.total_amount)}) into ${keepJul.invoice_number} (${fmt(keepJul.total_amount)})`)
    const { data: movedItemsPreview, error: miPrevErr } = await a.from('invoice_items').select('id').eq('invoice_id', oldJul.id)
    if (miPrevErr) throw miPrevErr
    const newSubtotal = money(keepJul.subtotal + oldJul.subtotal)
    const newTotal = money(keepJul.total_amount + oldJul.total_amount)
    const newTax = money(newTotal * 5 / 105)
    const note = `[${TODAY}] Merged ${oldJul.invoice_number} from duplicate ${DUPE_CODE}; AED ${fmt(oldJul.total_amount)} absorbed. Duplicate orders checked before merge.`
    console.log(`keeper subtotal -> ${fmt(newSubtotal)}, total -> ${fmt(newTotal)}, items to move: ${movedItemsPreview.length}`)
    if (CONFIRM) {
      const { data: payMove, error: payErr } = await a.from('payments').update({ invoice_id: keepJul.id, customer_id: keeper.id }).eq('invoice_id', oldJul.id).select('id, payment_number')
      if (payErr) throw payErr
      const { data: itemMove, error: itemErr } = await a.from('invoice_items').update({ invoice_id: keepJul.id }).eq('invoice_id', oldJul.id).select('id')
      if (itemErr) throw itemErr
      const { error: invErr } = await a.from('invoices').update({
        subtotal: fmt(newSubtotal), total_amount: fmt(newTotal), tax_amount: fmt(newTax),
        notes: keepJul.notes ? `${keepJul.notes}\n${note}` : note,
      }).eq('id', keepJul.id).eq('subtotal', keepJul.subtotal).eq('total_amount', keepJul.total_amount)
      if (invErr) throw invErr

      // Reuse the old invoice ledger row for the keeper invoice. Keeper invoice had no ledger row while total was 0.
      const { data: oldLedgers, error: oldLedErr } = await a.from('ledger_entries')
        .update({ customer_id: keeper.id, reference_id: keepJul.id, debit_amount: fmt(newTotal), description: `Invoice ${keepJul.invoice_number}` })
        .eq('reference_table', 'invoices').eq('reference_id', oldJul.id).eq('entry_type', 'invoice').select('id')
      if (oldLedErr) throw oldLedErr
      if (!oldLedgers.length) {
        const { error: insLedErr } = await a.from('ledger_entries').insert({
          customer_id: keeper.id,
          entry_date: keepJul.invoice_date,
          entry_type: 'invoice',
          debit_amount: fmt(newTotal),
          credit_amount: 0,
          description: `Invoice ${keepJul.invoice_number}`,
          reference_table: 'invoices',
          reference_id: keepJul.id,
          created_by: OWNER,
        })
        if (insLedErr) throw insLedErr
      }
      const { data: del, error: delErr } = await a.from('invoices').delete().eq('id', oldJul.id).eq('invoice_number', oldJul.invoice_number).select('id')
      if (delErr || !del.length) throw delErr || new Error('old July invoice delete failed')
      console.log(`moved invoice_items ${itemMove.length}; payments ${payMove.length}; deleted ${oldJul.invoice_number}`)
    }
  } else if (oldJul || keepJul) {
    throw new Error('Expected both old July and keeper July invoices for absorption')
  }

  if (oldAug) {
    const augOrdersOnDupe = orders.filter(o => o.customer_id === dupe.id && o.order_date >= '2026-08-01' && o.order_date <= '2026-08-31' && !o.voided_at && !['cancelled', 'voided'].includes(o.order_status))
    console.log(`\nCancel stale ${oldAug.invoice_number} (${fmt(oldAug.total_amount)}): old account August active orders = ${augOrdersOnDupe.length}`)
    if (augOrdersOnDupe.length) throw new Error('Refusing to cancel old August invoice because old account has August orders')
    if (CONFIRM) {
      const { error } = await a.from('invoices').update({
        customer_id: keeper.id,
        status: 'cancelled',
        notes: oldAug.notes ? `${oldAug.notes}\n[${TODAY}] Cancelled and moved from duplicate ${DUPE_CODE} during merge into ${KEEPER_CODE}; old account had no August orders and keeper invoice AC-INV-01431 already bills the live August order stream.` : `[${TODAY}] Cancelled and moved from duplicate ${DUPE_CODE} during merge into ${KEEPER_CODE}; old account had no August orders and keeper invoice AC-INV-01431 already bills the live August order stream.`,
      }).eq('id', oldAug.id).eq('customer_id', dupe.id).eq('status', oldAug.status)
      if (error) throw error
      const { data: dl, error: dlErr } = await a.from('ledger_entries').delete().eq('reference_table', 'invoices').eq('reference_id', oldAug.id).eq('entry_type', 'invoice').select('id')
      if (dlErr) throw dlErr
      console.log('removed stale August ledger rows:', dl.length)
    }
  }

  // Move/repoint remaining child rows. The old subscription is stale; cancel it as historical before moving.
  const { data: dupeSubs, error: subErr } = await a.from('customer_subscriptions').select('*').eq('customer_id', dupe.id)
  if (subErr) throw subErr
  console.log('\nOld subscriptions to move/cancel:', dupeSubs.length)
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

  for (const t of ['payments', 'ledger_entries', 'balance_adjustments']) {
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

  // Reconcile statuses for keeper invoices.
  const keepInvs = await all((f, t) => a.from('invoices').select('id').eq('customer_id', keeper.id).range(f, t))
  for (const inv of keepInvs) {
    const msg = await reconcileInvoiceStatus(inv.id)
    if (msg) console.log(msg)
  }

  if (CONFIRM) {
    const { error: auditErr } = await a.from('audit_logs').insert({
      table_name: 'customers', record_id: keeper.id, action: 'update',
      old_value: JSON.stringify({ merged_from: DUPE_CODE, merged_from_id: dupe.id }),
      new_value: JSON.stringify({ note: `Merged duplicate SALMAN ${DUPE_CODE} into SALMAN 2797 ${KEEPER_CODE}: moved orders, voided exact duplicate orders, absorbed July invoice, repointed May/June invoice, cancelled stale old August fixed invoice.` }),
      changed_by: OWNER,
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
    console.log(`deleted duplicate customer ${DUPE_CODE}`)
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
