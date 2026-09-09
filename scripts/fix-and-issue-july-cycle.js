// Fix gaps in the 26 Jun → 25 Jul billing cycle and issue its never-issued drafts.
//
// Owner instructions (29 Aug):
//   1. Bill the unbilled orders from that period (SURVE 2382's 33 unlinked
//      orders, Moiz's missing invoice, IMRAN KHAN's 1 backfilled order).
//   2. For draft invoices of fixed-plan customers whose amount exceeds the
//      agreed plan price: discount down to the plan price, show the discount
//      on the bill, then ISSUE the invoice.
//   All drafts in the batch get issued (ledger debit on issue, same as
//   issueInvoice() in lib/invoices/actions.ts).
//
// Scope pinned to billing_period 2026-06-26 → 2026-07-25, status 'draft'.
// Sequence per draft: (a) link any of the customer's unlinked non-voided
// period orders into it (adds invoice_items, recomputes subtotal); (b) if the
// customer has a subscription covering the period and subtotal > agreed price,
// set discount = subtotal − agreed, total = agreed, note on bill; (c) issue.
// Customers with unlinked period orders and NO period invoice get a new draft
// created (next_invoice_number RPC) then processed the same way. Customers
// whose period invoice is already issued/paid but still have unlinked orders
// are only REPORTED (manual decision), never auto-touched.
//
// DRY RUN BY DEFAULT — prints proposed actions, writes nothing.
//   node scripts/fix-and-issue-july-cycle.js            (dry run)
//   node scripts/fix-and-issue-july-cycle.js --confirm  (writes for real)
const fs = require('fs')
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/)
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '')
}
const { createClient } = require('@supabase/supabase-js')
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

const CONFIRM = process.argv.includes('--confirm')
const P_START = '2026-06-26'
const P_END = '2026-07-25'
const TODAY = '2026-08-29' // Asia/Dubai date at time of writing

const PAGE = 1000
async function fetchAll(build) {
  const out = []; let o = 0
  while (true) { const { data, error } = await build(o, o + PAGE - 1); if (error) throw error; out.push(...(data ?? [])); if ((data ?? []).length < PAGE) break; o += PAGE }
  return out
}

async function main() {
  const { data: owner } = await admin.from('users').select('id, full_name').eq('role', 'owner').limit(1).single()
  if (!owner) throw new Error('owner user not found')
  const { data: settingsRow } = await admin.from('app_settings').select('vat_percent').eq('id', 1).single()
  const vatRate = parseFloat(String(settingsRow?.vat_percent ?? '5'))

  // --- All invoices for the period (any status) + all customers ---
  const periodInvoices = await fetchAll((f, t) => admin.from('invoices')
    .select('id, invoice_number, customer_id, status, subtotal, discount_amount, tax_amount, total_amount, notes')
    .eq('billing_period_start', P_START).eq('billing_period_end', P_END).range(f, t))
  const custs = await fetchAll((f, t) => admin.from('customers').select('id, full_name, customer_code, area, customer_type').range(f, t))
  const custById = Object.fromEntries(custs.map(c => [c.id, c]))

  // --- All non-voided orders in the period ---
  const orders = await fetchAll((f, t) => admin.from('orders')
    .select('id, customer_id, order_date, meal_period, total_amount')
    .gte('order_date', P_START).lte('order_date', P_END).is('voided_at', null).range(f, t))

  // --- Which orders are already linked to ANY invoice (any period/status) ---
  const linkedSet = new Set()
  const oids = orders.map(o => o.id)
  for (let i = 0; i < oids.length; i += 200) {
    const chunk = await fetchAll((f, t) => admin.from('invoice_items')
      .select('order_id').in('order_id', oids.slice(i, i + 200)).range(f, t))
    for (const r of chunk) linkedSet.add(r.order_id)
  }
  const unlinked = orders.filter(o => !linkedSet.has(o.id))
  const unlinkedByCust = {}
  for (const o of unlinked) (unlinkedByCust[o.customer_id] = unlinkedByCust[o.customer_id] || []).push(o)

  // --- Subscriptions covering the period ---
  const subs = await fetchAll((f, t) => admin.from('customer_subscriptions')
    .select('customer_id, agreed_monthly_price, start_date, end_date, status')
    .in('status', ['active', 'completed', 'paused'])
    .lte('start_date', P_END).range(f, t))
  const subByCust = {}
  for (const s of subs) {
    if (s.end_date && s.end_date < P_START) continue
    // keep the highest-priced covering sub if several
    if (!subByCust[s.customer_id] || parseFloat(s.agreed_monthly_price) > parseFloat(subByCust[s.customer_id].agreed_monthly_price)) subByCust[s.customer_id] = s
  }

  const drafts = periodInvoices.filter(i => i.status === 'draft')
  const invByCust = {}
  for (const i of periodInvoices) (invByCust[i.customer_id] = invByCust[i.customer_id] || []).push(i)

  // --- Plan actions ---
  const addToDraft = []   // { inv, orders, addValue }
  const createNew = []    // { customer_id, orders, value }
  const manualReview = [] // customer has unlinked orders but non-draft period invoice
  for (const [cid, os] of Object.entries(unlinkedByCust)) {
    const invs = invByCust[cid] || []
    const draft = invs.find(i => i.status === 'draft')
    const val = os.reduce((s, o) => s + parseFloat(o.total_amount), 0)
    if (draft) addToDraft.push({ inv: draft, orders: os, addValue: val })
    else if (invs.length === 0) createNew.push({ customer_id: cid, orders: os, value: val })
    else manualReview.push({ customer_id: cid, invs: invs.map(i => `${i.invoice_number}(${i.status})`).join(','), orders: os.length, value: val })
  }

  // --- Build final per-draft picture (existing drafts + to-be-created) ---
  const addByInvId = Object.fromEntries(addToDraft.map(a => [a.inv.id, a]))
  const rows = []
  for (const inv of drafts) {
    const add = addByInvId[inv.id]
    const newSubtotal = parseFloat(inv.subtotal) + (add ? add.addValue : 0)
    const sub = subByCust[inv.customer_id]
    const plan = sub ? parseFloat(sub.agreed_monthly_price) : null
    const discount = plan !== null && newSubtotal > plan ? +(newSubtotal - plan).toFixed(2) : 0
    const newTotal = +(newSubtotal - discount).toFixed(2)
    rows.push({ kind: 'existing', inv, customer_id: inv.customer_id, addOrders: add ? add.orders : [], addValue: add ? add.addValue : 0, newSubtotal, plan, discount, newTotal })
  }
  for (const c of createNew) {
    const sub = subByCust[c.customer_id]
    const plan = sub ? parseFloat(sub.agreed_monthly_price) : null
    const discount = plan !== null && c.value > plan ? +(c.value - plan).toFixed(2) : 0
    rows.push({ kind: 'NEW', inv: null, customer_id: c.customer_id, addOrders: c.orders, addValue: c.value, newSubtotal: c.value, plan, discount, newTotal: +(c.value - discount).toFixed(2) })
  }
  rows.sort((a, b) => b.discount - a.discount || b.newTotal - a.newTotal)

  console.log(`${CONFIRM ? 'CONFIRM MODE — writing for real' : 'DRY RUN — no writes'}`)
  console.log(`Period ${P_START} → ${P_END}: invoices=${periodInvoices.length} (drafts=${drafts.length}), period orders=${orders.length}, unlinked orders=${unlinked.length}`)
  console.log(`Actions: ${rows.length} invoices to finalize+issue (${createNew.length} newly created), ${manualReview.length} manual-review cases\n`)

  console.table(rows.map(r => {
    const c = custById[r.customer_id] || {}
    return {
      invoice: r.inv ? r.inv.invoice_number : '(NEW)',
      customer: `${c.full_name} (${c.customer_code})`,
      area: c.area, type: c.customer_type,
      add_orders: r.addOrders.length, add_AED: r.addValue.toFixed(2),
      subtotal: r.newSubtotal.toFixed(2),
      plan_AED: r.plan === null ? '' : r.plan.toFixed(2),
      discount: r.discount.toFixed(2),
      final_total: r.newTotal.toFixed(2),
    }
  }))
  const tDisc = rows.reduce((s, r) => s + r.discount, 0)
  const tTotal = rows.reduce((s, r) => s + r.newTotal, 0)
  const tAdd = rows.reduce((s, r) => s + r.addValue, 0)
  console.log(`\nTotals: gap orders billed AED ${tAdd.toFixed(2)} | fixed-plan discounts AED ${tDisc.toFixed(2)} (${rows.filter(r => r.discount > 0).length} invoices) | total to issue AED ${tTotal.toFixed(2)}`)
  if (manualReview.length) {
    console.log('\nMANUAL REVIEW (unlinked orders but period invoice already issued/paid — NOT touched):')
    console.table(manualReview.map(m => ({ customer: `${custById[m.customer_id]?.full_name} (${custById[m.customer_id]?.customer_code})`, invoices: m.invs, orders: m.orders, value: m.value.toFixed(2) })))
  }

  if (!CONFIRM) { console.log('\nDry run only — re-run with --confirm to apply.'); return }

  let ok = 0, failed = 0
  for (const r of rows) {
    const c = custById[r.customer_id] || {}
    try {
      let invId = r.inv?.id, invNumber = r.inv?.invoice_number, oldNotes = r.inv?.notes
      // (a) create the invoice if missing
      if (!invId) {
        const { data: invNum, error: numErr } = await admin.rpc('next_invoice_number')
        if (numErr) throw new Error('next_invoice_number: ' + numErr.message)
        const { data: created, error: insErr } = await admin.from('invoices').insert({
          invoice_number: invNum, customer_id: r.customer_id,
          invoice_date: TODAY, due_date: TODAY,
          invoice_type: 'a_la_carte_cycle',
          billing_period_start: P_START, billing_period_end: P_END,
          subtotal: '0.00', discount_amount: '0.00', tax_amount: '0.00', total_amount: '0.00',
          status: 'draft', notes: 'A La Carte cycle — July 2026 (missed in 27 Jul run, generated 29 Aug)',
          created_by: owner.id,
        }).select('id, invoice_number, notes').single()
        if (insErr) throw new Error('insert invoice: ' + insErr.message)
        invId = created.id; invNumber = created.invoice_number; oldNotes = created.notes
      }
      // (b) link missing orders
      if (r.addOrders.length) {
        const addIds = r.addOrders.map(o => o.id)
        const oi = []
        for (let i = 0; i < addIds.length; i += 200) {
          const chunk = await fetchAll((f, t) => admin.from('order_items')
            .select('order_id, item_name_snapshot, quantity, unit_price, total_price').in('order_id', addIds.slice(i, i + 200)).range(f, t))
          oi.push(...chunk)
        }
        const meta = Object.fromEntries(r.addOrders.map(o => [o.id, o]))
        const itemRows = oi.map(it => ({
          invoice_id: invId, order_id: it.order_id,
          description: `${meta[it.order_id].order_date} · ${meta[it.order_id].meal_period || 'meal'} · ${it.item_name_snapshot}`,
          quantity: it.quantity, unit_price: it.unit_price, total_price: it.total_price,
        }))
        const { error: itemErr } = await admin.from('invoice_items').insert(itemRows)
        if (itemErr) throw new Error('insert invoice_items: ' + itemErr.message)
      }
      // (c) totals + discount note + issue
      const newTax = +((r.newTotal * vatRate) / (100 + vatRate)).toFixed(2)
      const noteParts = []
      if (r.addOrders.length) noteParts.push(`[${TODAY}] ${r.addOrders.length} missed order(s) worth AED ${r.addValue.toFixed(2)} added to this invoice (left out of the 27 Jul generation).`)
      if (r.discount > 0) noteParts.push(`Fixed plan AED ${r.plan.toFixed(2)}/month — actual orders AED ${r.newSubtotal.toFixed(2)}, discount AED ${r.discount.toFixed(2)} applied so the bill equals the agreed plan price.`)
      const notes = [oldNotes, ...noteParts].filter(Boolean).join('\n')
      const { error: updErr } = await admin.from('invoices').update({
        subtotal: r.newSubtotal.toFixed(2),
        discount_amount: r.discount.toFixed(2),
        tax_amount: newTax.toFixed(2),
        total_amount: r.newTotal.toFixed(2),
        notes, status: 'issued',
      }).eq('id', invId).eq('status', 'draft')
      if (updErr) throw new Error('update invoice: ' + updErr.message)
      const { error: ledgerErr } = await admin.from('ledger_entries').insert({
        customer_id: r.customer_id, entry_date: TODAY, entry_type: 'invoice',
        debit_amount: r.newTotal.toFixed(2), credit_amount: '0.00',
        description: `Invoice ${invNumber}`, reference_table: 'invoices', reference_id: invId,
        created_by: owner.id,
      })
      if (ledgerErr) throw new Error('ledger insert: ' + ledgerErr.message + ' — INVOICE ISSUED BUT LEDGER MISSING, fix manually')
      await admin.from('audit_logs').insert({
        user_id: owner.id, action: 'july_cycle_fix_and_issue', table_name: 'invoices', record_id: invId,
        old_value: { status: 'draft', subtotal: r.inv ? r.inv.subtotal : 0, discount_amount: r.inv ? r.inv.discount_amount : 0, total_amount: r.inv ? r.inv.total_amount : 0 },
        new_value: { status: 'issued', subtotal: r.newSubtotal, discount_amount: r.discount, total_amount: r.newTotal, orders_added: r.addOrders.length },
      })
      console.log(`OK ${invNumber} ${c.full_name} → issued AED ${r.newTotal.toFixed(2)}${r.discount ? ` (discount ${r.discount.toFixed(2)})` : ''}${r.addOrders.length ? ` (+${r.addOrders.length} orders)` : ''}`)
      ok++
    } catch (e) {
      console.error(`FAILED ${r.inv?.invoice_number || '(new)'} ${c.full_name}: ${e.message}`)
      failed++
    }
  }
  console.log(`\nDone: ${ok} issued, ${failed} failed.`)
}

main().catch(e => { console.error(e); process.exit(1) })
