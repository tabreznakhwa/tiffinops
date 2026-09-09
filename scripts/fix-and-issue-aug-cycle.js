// Rebuild + issue the 26 Jul → 25 Aug a_la_carte cycle drafts (generated
// 26 Aug 14:01, BEFORE the backfill finished, so they miss ~2 weeks of orders).
//
// Owner instructions (29 Aug), same as the July cycle fix plus three decisions:
//   1. Add every non-voided period order that isn't linked to any invoice yet
//      into its customer's draft (create a draft when the customer has none).
//   2. REMOVE invoice lines pointing at orders voided after generation (the
//      13 Aug duplicate cleanup happened 27–28 Aug, after these drafts were cut).
//   3. Plan price = the customer's fixed_monthly Aug draft amount (the app
//      already resolved which of their overlapping subscriptions to bill);
//      fallback = subscription price where no fixed draft exists.
//   4. Fixed-plan billing lands EXACTLY on plan price: above plan → discount
//      shown on bill; below plan → top-up line added (owner: "bill plan
//      price"). Top-up only where a fixed Aug draft confirms the active plan —
//      subscription-fallback customers get discount-only (stale-sub safety).
//   5. The redundant fixed_monthly 1–31 Aug DRAFTS of these customers are
//      CANCELLED to avoid double billing (owner-confirmed).
//   6. Issue (ledger debit + audit log, same as issueInvoice() in the app).
//
// DRY RUN BY DEFAULT — prints proposed actions, writes nothing.
//   node scripts/fix-and-issue-aug-cycle.js            (dry run)
//   node scripts/fix-and-issue-aug-cycle.js --confirm  (writes for real)
const fs = require('fs')
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/)
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '')
}
const { createClient } = require('@supabase/supabase-js')
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

const CONFIRM = process.argv.includes('--confirm')
const P_START = '2026-07-26'
const P_END = '2026-08-25'
const TODAY = '2026-08-29'

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

  const periodInvoices = await fetchAll((f, t) => admin.from('invoices')
    .select('id, invoice_number, customer_id, status, subtotal, discount_amount, tax_amount, total_amount, notes')
    .eq('billing_period_start', P_START).eq('billing_period_end', P_END).range(f, t))
  const custs = await fetchAll((f, t) => admin.from('customers').select('id, full_name, customer_code, area, customer_type').range(f, t))
  const custById = Object.fromEntries(custs.map(c => [c.id, c]))

  // Separate fixed_monthly Aug drafts (double-billing risk flag)
  const fixedAug = await fetchAll((f, t) => admin.from('invoices')
    .select('id, invoice_number, customer_id, status, total_amount, notes')
    .eq('billing_period_start', '2026-08-01').eq('billing_period_end', '2026-08-31').range(f, t))
  const fixedAugByCust = {}
  for (const i of fixedAug) (fixedAugByCust[i.customer_id] = fixedAugByCust[i.customer_id] || []).push(i)
  // Plan price authority: the customer's fixed_monthly Aug DRAFT amount
  const planFromDraft = {}
  for (const i of fixedAug) {
    if (i.status !== 'draft') continue
    if (planFromDraft[i.customer_id] === undefined || parseFloat(i.total_amount) > planFromDraft[i.customer_id]) planFromDraft[i.customer_id] = parseFloat(i.total_amount)
  }

  // ALL period orders incl. voided (to detect voided-but-still-linked lines)
  const orders = await fetchAll((f, t) => admin.from('orders')
    .select('id, customer_id, order_date, meal_period, total_amount, voided_at')
    .gte('order_date', P_START).lte('order_date', P_END).range(f, t))
  const orderById = Object.fromEntries(orders.map(o => [o.id, o]))
  const live = orders.filter(o => !o.voided_at)

  // Existing linkage for period orders
  const oids = orders.map(o => o.id)
  const links = [] // { invoice_id, order_id, total_price, id }
  for (let i = 0; i < oids.length; i += 200) {
    const chunk = await fetchAll((f, t) => admin.from('invoice_items')
      .select('id, invoice_id, order_id, total_price').in('order_id', oids.slice(i, i + 200)).range(f, t))
    links.push(...chunk)
  }
  const linkedSet = new Set(links.map(l => l.order_id))
  const unlinked = live.filter(o => !linkedSet.has(o.id))
  const unlinkedByCust = {}
  for (const o of unlinked) (unlinkedByCust[o.customer_id] = unlinkedByCust[o.customer_id] || []).push(o)

  // Voided orders still linked into a period draft → lines to remove
  const drafts = periodInvoices.filter(i => i.status === 'draft')
  const draftIds = new Set(drafts.map(d => d.id))
  const voidedLinksByInv = {}
  for (const l of links) {
    const o = orderById[l.order_id]
    if (o && o.voided_at && draftIds.has(l.invoice_id)) (voidedLinksByInv[l.invoice_id] = voidedLinksByInv[l.invoice_id] || []).push(l)
  }

  // Subscriptions covering the period
  const subs = await fetchAll((f, t) => admin.from('customer_subscriptions')
    .select('customer_id, agreed_monthly_price, start_date, end_date, status')
    .in('status', ['active', 'completed', 'paused'])
    .lte('start_date', P_END).range(f, t))
  const subByCust = {}
  for (const s of subs) {
    if (s.end_date && s.end_date < P_START) continue
    if (!subByCust[s.customer_id] || parseFloat(s.agreed_monthly_price) > parseFloat(subByCust[s.customer_id].agreed_monthly_price)) subByCust[s.customer_id] = s
  }

  const invByCust = {}
  for (const i of periodInvoices) (invByCust[i.customer_id] = invByCust[i.customer_id] || []).push(i)

  const addToDraft = []; const createNew = []; const manualReview = []
  for (const [cid, os] of Object.entries(unlinkedByCust)) {
    const invs = invByCust[cid] || []
    const draft = invs.find(i => i.status === 'draft')
    const val = os.reduce((s, o) => s + parseFloat(o.total_amount), 0)
    if (draft) addToDraft.push({ inv: draft, orders: os, addValue: val })
    else if (invs.length === 0) createNew.push({ customer_id: cid, orders: os, value: val })
    else manualReview.push({ customer_id: cid, invs: invs.map(i => `${i.invoice_number}(${i.status})`).join(','), orders: os.length, value: val })
  }
  const addByInvId = Object.fromEntries(addToDraft.map(a => [a.inv.id, a]))

  function planFor(cid) {
    if (planFromDraft[cid] !== undefined) return { plan: planFromDraft[cid], src: 'fixed_draft' }
    const sub = subByCust[cid]
    if (sub) return { plan: parseFloat(sub.agreed_monthly_price), src: 'subscription' }
    return { plan: null, src: null }
  }
  function applyPlan(subtotal, cid) {
    const { plan, src } = planFor(cid)
    const discount = plan !== null && subtotal > plan ? +(subtotal - plan).toFixed(2) : 0
    // top-up to plan only when the fixed Aug draft confirms the active plan
    const topup = plan !== null && src === 'fixed_draft' && subtotal < plan ? +(plan - subtotal).toFixed(2) : 0
    return { plan, src, discount, topup, newTotal: +(subtotal - discount + topup).toFixed(2) }
  }
  const allRows = []
  for (const inv of drafts) {
    const add = addByInvId[inv.id]
    const removeLinks = voidedLinksByInv[inv.id] || []
    const removeValue = removeLinks.reduce((s, l) => s + parseFloat(l.total_price), 0)
    const newSubtotal = +(parseFloat(inv.subtotal) + (add ? add.addValue : 0) - removeValue).toFixed(2)
    allRows.push({ kind: 'existing', inv, customer_id: inv.customer_id, addOrders: add ? add.orders : [], addValue: add ? add.addValue : 0, removeLinks, removeValue, newSubtotal, ...applyPlan(newSubtotal, inv.customer_id) })
  }
  for (const c of createNew) {
    allRows.push({ kind: 'NEW', inv: null, customer_id: c.customer_id, addOrders: c.orders, addValue: c.value, removeLinks: [], removeValue: 0, newSubtotal: c.value, ...applyPlan(c.value, c.customer_id) })
  }
  allRows.sort((a, b) => b.discount - a.discount || b.newTotal - a.newTotal)
  // Mai Dubai only (owner instruction 29 Aug): customers of OTHER areas are
  // NOT touched — their drafts stay drafts, reported for owner review.
  // Blank-area customers count as Mai Dubai (owner-confirmed).
  const AREA = 'Mai Dubai'
  const inArea = cid => { const a = custById[cid]?.area; return !a || a === AREA }
  const rows = allRows.filter(r => inArea(r.customer_id))
  const outOfArea = allRows.filter(r => !inArea(r.customer_id))

  // Fixed Aug drafts to cancel (customers billed via the cycle invoice) + orphans
  const rowCustSet = new Set(rows.map(r => r.customer_id))
  const fixedToCancel = fixedAug.filter(i => i.status === 'draft' && rowCustSet.has(i.customer_id))
  const fixedOrphans = fixedAug.filter(i => i.status === 'draft' && !rowCustSet.has(i.customer_id))

  console.log(`${CONFIRM ? 'CONFIRM MODE — writing for real' : 'DRY RUN — no writes'}`)
  console.log(`Period ${P_START} → ${P_END}: invoices=${periodInvoices.length} (drafts=${drafts.length}), live orders=${live.length}, unlinked=${unlinked.length}, voided-but-linked lines=${Object.values(voidedLinksByInv).flat().length}`)
  console.log(`Actions: ${rows.length} invoices to finalize+issue (${rows.filter(r => r.kind === 'NEW').length} newly created), ${manualReview.length} manual-review cases, ${outOfArea.length} skipped (not ${AREA})\n`)

  console.table(rows.map(r => {
    const c = custById[r.customer_id] || {}
    return {
      invoice: r.inv ? r.inv.invoice_number : '(NEW)',
      customer: `${c.full_name} (${c.customer_code})`,
      area: c.area, type: c.customer_type,
      add_orders: r.addOrders.length,
      rm_voided: r.removeLinks.length,
      orders_AED: r.newSubtotal.toFixed(2),
      plan_AED: r.plan === null ? '' : r.plan.toFixed(2),
      plan_src: r.src || '',
      discount: r.discount.toFixed(2),
      topup: r.topup.toFixed(2),
      final_total: r.newTotal.toFixed(2),
      cancel_fixed: (fixedAugByCust[r.customer_id] || []).filter(i => i.status === 'draft').map(i => i.invoice_number).join(',') || '',
    }
  }))
  const tDisc = rows.reduce((s, r) => s + r.discount, 0)
  const tTopup = rows.reduce((s, r) => s + r.topup, 0)
  const tTotal = rows.reduce((s, r) => s + r.newTotal, 0)
  const tAdd = rows.reduce((s, r) => s + r.addValue, 0)
  const tRm = rows.reduce((s, r) => s + r.removeValue, 0)
  console.log(`\nTotals: orders added AED ${tAdd.toFixed(2)} | voided lines removed AED ${tRm.toFixed(2)}`)
  console.log(`Fixed-plan: discounts AED ${tDisc.toFixed(2)} (${rows.filter(r => r.discount > 0).length} invoices) | top-ups AED ${tTopup.toFixed(2)} (${rows.filter(r => r.topup > 0).length} invoices)`)
  console.log(`Total to issue AED ${tTotal.toFixed(2)} | fixed_monthly Aug drafts to CANCEL: ${fixedToCancel.length} (AED ${fixedToCancel.reduce((s, i) => s + parseFloat(i.total_amount), 0).toFixed(2)})`)
  if (fixedOrphans.length) {
    console.log('\nFIXED AUG DRAFTS WITH NO CYCLE INVOICE (left untouched — owner to decide):')
    console.table(fixedOrphans.map(i => ({ invoice: i.invoice_number, customer: `${custById[i.customer_id]?.full_name} (${custById[i.customer_id]?.customer_code})`, amount: i.total_amount })))
  }
  if (outOfArea.length) {
    console.log(`\nNOT MAI DUBAI — skipped, left as-is (${outOfArea.length} customers):`)
    console.table(outOfArea.map(r => {
      const c = custById[r.customer_id] || {}
      return { invoice: r.inv ? r.inv.invoice_number : '(no invoice — unbilled orders)', customer: `${c.full_name} (${c.customer_code})`, area: c.area || '(blank)', orders_AED: r.newSubtotal.toFixed(2) }
    }))
  }
  if (manualReview.length) {
    console.log('\nMANUAL REVIEW (unlinked orders but period invoice already issued/paid — NOT touched):')
    console.table(manualReview.map(m => ({ customer: `${custById[m.customer_id]?.full_name} (${custById[m.customer_id]?.customer_code})`, invoices: m.invs, orders: m.orders, value: m.value.toFixed(2) })))
  }

  if (!CONFIRM) { console.log('\nDry run only — re-run with --confirm to apply.'); return }

  let ok = 0, failed = 0
  const issuedByCust = {} // customer_id -> cycle invoice number (for the cancel notes)
  for (const r of rows) {
    const c = custById[r.customer_id] || {}
    try {
      let invId = r.inv?.id, invNumber = r.inv?.invoice_number, oldNotes = r.inv?.notes
      if (!invId) {
        const { data: invNum, error: numErr } = await admin.rpc('next_invoice_number')
        if (numErr) throw new Error('next_invoice_number: ' + numErr.message)
        const { data: created, error: insErr } = await admin.from('invoices').insert({
          invoice_number: invNum, customer_id: r.customer_id,
          invoice_date: TODAY, due_date: TODAY,
          invoice_type: 'a_la_carte_cycle',
          billing_period_start: P_START, billing_period_end: P_END,
          subtotal: '0.00', discount_amount: '0.00', tax_amount: '0.00', total_amount: '0.00',
          status: 'draft', notes: 'A La Carte cycle — August 2026 (generated after backfill, 29 Aug)',
          created_by: owner.id,
        }).select('id, invoice_number, notes').single()
        if (insErr) throw new Error('insert invoice: ' + insErr.message)
        invId = created.id; invNumber = created.invoice_number; oldNotes = created.notes
      }
      // remove voided lines
      if (r.removeLinks.length) {
        const { error: delErr } = await admin.from('invoice_items').delete().in('id', r.removeLinks.map(l => l.id))
        if (delErr) throw new Error('delete voided lines: ' + delErr.message)
      }
      // link missing orders
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
        for (let i = 0; i < itemRows.length; i += 500) {
          const { error: itemErr } = await admin.from('invoice_items').insert(itemRows.slice(i, i + 500))
          if (itemErr) throw new Error('insert invoice_items: ' + itemErr.message)
        }
      }
      // fixed-plan top-up line (subtotal below plan; plan confirmed by fixed Aug draft)
      if (r.topup > 0) {
        const { error: topErr } = await admin.from('invoice_items').insert({
          invoice_id: invId, order_id: null,
          description: `Fixed plan — top-up to agreed monthly price (AED ${r.plan.toFixed(2)}/month)`,
          quantity: 1, unit_price: r.topup.toFixed(2), total_price: r.topup.toFixed(2),
        })
        if (topErr) throw new Error('insert top-up line: ' + topErr.message)
      }
      const invSubtotal = +(r.newSubtotal + r.topup).toFixed(2) // matches invoice_items sum
      const newTax = +((r.newTotal * vatRate) / (100 + vatRate)).toFixed(2)
      const noteParts = []
      if (r.addOrders.length) noteParts.push(`[${TODAY}] ${r.addOrders.length} backfilled order(s) worth AED ${r.addValue.toFixed(2)} added after the 26 Aug generation.`)
      if (r.removeLinks.length) noteParts.push(`[${TODAY}] ${r.removeLinks.length} line(s) worth AED ${r.removeValue.toFixed(2)} removed (orders voided as duplicates after generation).`)
      if (r.discount > 0) noteParts.push(`Fixed plan AED ${r.plan.toFixed(2)}/month — actual orders AED ${r.newSubtotal.toFixed(2)}, discount AED ${r.discount.toFixed(2)} applied so the bill equals the agreed plan price.`)
      if (r.topup > 0) noteParts.push(`Fixed plan AED ${r.plan.toFixed(2)}/month — actual orders AED ${r.newSubtotal.toFixed(2)}, top-up AED ${r.topup.toFixed(2)} added so the bill equals the agreed plan price.`)
      const notes = [oldNotes, ...noteParts].filter(Boolean).join('\n')
      const { error: updErr } = await admin.from('invoices').update({
        subtotal: invSubtotal.toFixed(2),
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
        user_id: owner.id, action: 'aug_cycle_fix_and_issue', table_name: 'invoices', record_id: invId,
        old_value: { status: 'draft', subtotal: r.inv ? r.inv.subtotal : 0, discount_amount: r.inv ? r.inv.discount_amount : 0, total_amount: r.inv ? r.inv.total_amount : 0 },
        new_value: { status: 'issued', subtotal: invSubtotal, discount_amount: r.discount, total_amount: r.newTotal, orders_added: r.addOrders.length, voided_lines_removed: r.removeLinks.length, topup: r.topup },
      })
      issuedByCust[r.customer_id] = invNumber
      console.log(`OK ${invNumber} ${c.full_name} → issued AED ${r.newTotal.toFixed(2)}${r.discount ? ` (discount ${r.discount.toFixed(2)})` : ''}${r.topup ? ` (top-up ${r.topup.toFixed(2)})` : ''}${r.addOrders.length ? ` (+${r.addOrders.length} orders)` : ''}${r.removeLinks.length ? ` (−${r.removeLinks.length} voided lines)` : ''}`)
      ok++
    } catch (e) {
      console.error(`FAILED ${r.inv?.invoice_number || '(new)'} ${c.full_name}: ${e.message}`)
      failed++
    }
  }
  console.log(`\nDone: ${ok} issued, ${failed} failed.`)

  // Cancel the now-redundant fixed_monthly 01–31 Aug drafts (owner decision:
  // everything is billed through the cycle invoice at plan price). Only cancel
  // where this run actually issued the customer's cycle invoice.
  let cOk = 0, cFail = 0
  for (const i of fixedToCancel) {
    const cycleInv = issuedByCust[i.customer_id]
    if (!cycleInv) { console.log(`SKIP cancel ${i.invoice_number} — cycle invoice for this customer was not issued`); cFail++; continue }
    const note = `[${TODAY}] Cancelled — superseded by cycle invoice ${cycleInv} (26 Jul–25 Aug billed at plan price); cancelled to avoid double billing.`
    const { error: cErr } = await admin.from('invoices').update({
      status: 'cancelled',
      notes: [i.notes, note].filter(Boolean).join('\n'),
    }).eq('id', i.id).eq('status', 'draft')
    if (cErr) { console.error(`FAILED cancel ${i.invoice_number}: ${cErr.message}`); cFail++; continue }
    await admin.from('audit_logs').insert({
      user_id: owner.id, action: 'aug_cycle_fix_and_issue', table_name: 'invoices', record_id: i.id,
      old_value: { status: 'draft', total_amount: i.total_amount },
      new_value: { status: 'cancelled', reason: `superseded by ${cycleInv}` },
    })
    console.log(`CANCELLED ${i.invoice_number} (AED ${i.total_amount}) → superseded by ${cycleInv}`)
    cOk++
  }
  if (fixedToCancel.length) console.log(`\nFixed Aug drafts: ${cOk} cancelled, ${cFail} failed/skipped.`)
}

main().catch(e => { console.error(e); process.exit(1) })
