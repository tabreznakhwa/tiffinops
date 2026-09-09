// Correction for Nazir 3247 (AC-CUST-00156), draft invoice AC-INV-01309
// (Local Dinner plan, dinner-only, Aug 2026). Two bugs stacked on this one:
//  1) It was generated as a draft on 26 Aug, mid-cycle, and never refreshed —
//     so it only reflects orders placed by that date, not the full month.
//  2) The old fixedPlanInvoiceLines logic (now fixed) folded ALL orders
//     (any meal_period) into the flat-plan discount, so his breakfast/lunch
//     orders — outside the dinner-only plan — were being given away free.
// This recomputes the draft from the FULL August order set using the
// corrected in-plan/out-of-plan split. Never touches an issued invoice —
// guarded to only run while status is still 'draft'.
const fs = require('fs')
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/)
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '')
}
const { createClient } = require('@supabase/supabase-js')
const a = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

const CID = 'c0a4e5b6-3da2-445a-bdcb-1b1278c9f643'
const AMOUNT = 200
const VAT_RATE = 5

async function main() {
  const { data: inv } = await a.from('invoices').select('*').eq('invoice_number', 'AC-INV-01309').single()
  if (inv.status !== 'draft') throw new Error('not draft, aborting: ' + inv.status)

  const { data: orders } = await a.from('orders')
    .select('id, order_date, meal_period, total_amount')
    .eq('customer_id', CID).eq('is_credit', true)
    .gte('order_date', '2026-08-01').lte('order_date', '2026-08-31')
    .not('order_status', 'in', '(cancelled,voided,draft)').order('order_date')

  let inPlanUsage = 0
  const outOfPlanExtras = {}
  for (const o of orders) {
    const amt = parseFloat(o.total_amount)
    if (o.meal_period === 'dinner') inPlanUsage += amt
    else outOfPlanExtras[o.meal_period] = (outOfPlanExtras[o.meal_period] ?? 0) + amt
  }
  const outOfPlanTotal = Object.values(outOfPlanExtras).reduce((s, v) => s + v, 0)
  const billable = AMOUNT + outOfPlanTotal
  const taxAmount = (billable * VAT_RATE) / (100 + VAT_RATE)
  const subtotal = AMOUNT + inPlanUsage + outOfPlanTotal

  const header = {
    subtotal:        subtotal.toFixed(2),
    discount_amount: inPlanUsage.toFixed(2),
    tax_amount:      taxAmount.toFixed(2),
    total_amount:    billable.toFixed(2),
    notes: `[2026-09-05] Draft recomputed: original draft (created 26 Aug, mid-cycle) folded ALL August orders into the flat-plan discount, including breakfast/lunch orders outside the Local Dinner plan (dinner-only). Recomputed against the full month of orders: dinner usage AED ${inPlanUsage.toFixed(2)} absorbed into plan discount; breakfast+lunch AED ${outOfPlanTotal.toFixed(2)} billed in full as out-of-plan extras.`,
  }

  const { error: updErr } = await a.from('invoices').update(header).eq('id', inv.id)
  if (updErr) throw updErr

  await a.from('invoice_items').delete().eq('invoice_id', inv.id)

  const lineItems = [{
    invoice_id: inv.id, order_id: null,
    description: 'Monthly Fixed Plan — Local Dinner — August 2026',
    quantity: '1', unit_price: AMOUNT.toFixed(2), total_price: AMOUNT.toFixed(2),
  }]
  if (inPlanUsage > 0) {
    lineItems.push({ invoice_id: inv.id, order_id: null, description: 'Extra items — August 2026', quantity: '1', unit_price: inPlanUsage.toFixed(2), total_price: inPlanUsage.toFixed(2) })
    lineItems.push({ invoice_id: inv.id, order_id: null, description: 'Fixed-plan discount (extra items included in plan)', quantity: '1', unit_price: (-inPlanUsage).toFixed(2), total_price: (-inPlanUsage).toFixed(2) })
  }
  for (const [meal, amt] of Object.entries(outOfPlanExtras)) {
    if (amt < 0.005) continue
    const label = meal.charAt(0).toUpperCase() + meal.slice(1)
    lineItems.push({ invoice_id: inv.id, order_id: null, description: `${label} orders — outside plan — August 2026 (billed in full)`, quantity: '1', unit_price: amt.toFixed(2), total_price: amt.toFixed(2) })
  }
  const { error: itemErr } = await a.from('invoice_items').insert(lineItems)
  if (itemErr) throw itemErr

  console.log('Fixed AC-INV-01309 header:', JSON.stringify(header, null, 1))
  console.log('New line items:', JSON.stringify(lineItems, null, 1))
}

main().catch(e => { console.error(e); process.exit(1) })
