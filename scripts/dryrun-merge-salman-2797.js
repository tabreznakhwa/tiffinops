// READ-ONLY dry-run for merging SALMAN (AC-CUST-00020) into
// SALMAN 2797 (AC-CUST-00148). Checks order overlaps/duplicates and shows
// existing invoice/payment state so billing can be merged without double count.
const fs = require('fs')
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/)
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '')
}
const { createClient } = require('@supabase/supabase-js')
const a = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

async function sumPayments(invoiceId) {
  const { data, error } = await a.from('payments').select('amount').eq('invoice_id', invoiceId).is('voided_at', null)
  if (error) throw error
  return (data ?? []).reduce((s, p) => s + parseFloat(p.amount || 0), 0)
}

async function main() {
  const { data: dupe, error: de } = await a.from('customers').select('*').eq('customer_code', 'AC-CUST-00020').single()
  if (de) throw de
  const { data: keeper, error: ke } = await a.from('customers').select('*').eq('customer_code', 'AC-CUST-00148').single()
  if (ke) throw ke
  console.log('DUPE:', dupe.customer_code, dupe.full_name, dupe.id, dupe.mobile_number, dupe.customer_type)
  console.log('KEEP:', keeper.customer_code, keeper.full_name, keeper.id, keeper.mobile_number, keeper.customer_type)

  const { data: dupeOrders, error: doe } = await a.from('orders').select('id, order_number, order_date, meal_period, total_amount, order_status, voided_at').eq('customer_id', dupe.id).order('order_date')
  if (doe) throw doe
  const { data: keepOrders, error: koe } = await a.from('orders').select('id, order_number, order_date, meal_period, total_amount, order_status, voided_at').eq('customer_id', keeper.id).order('order_date')
  if (koe) throw koe
  console.log('\nOrders before merge:', { dupe: dupeOrders.length, keeper: keepOrders.length, combined: dupeOrders.length + keepOrders.length })
  console.log('Dupe order range:', dupeOrders[0]?.order_date, '->', dupeOrders.at(-1)?.order_date)
  console.log('Keeper order range:', keepOrders[0]?.order_date, '->', keepOrders.at(-1)?.order_date)

  const active = [...dupeOrders.map(o => ({ ...o, src: 'dupe' })), ...keepOrders.map(o => ({ ...o, src: 'keeper' }))]
    .filter(o => !o.voided_at && o.order_status !== 'cancelled')
  const groups = new Map()
  for (const o of active) {
    const k = `${o.order_date}|${o.meal_period}`
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push(o)
  }
  const duplicatedSlots = [...groups.entries()].filter(([, arr]) => arr.length > 1)
  console.log('\nSame date + meal slots with more than one active order:', duplicatedSlots.length)
  if (duplicatedSlots.length) {
    for (const [slot, arr] of duplicatedSlots) {
      console.log(slot, arr.map(o => `${o.src}:${o.order_number}:AED${o.total_amount}`).join(' | '))
    }
  } else {
    console.log('No duplicate date+meal orders found. Moving all dupe orders will not create duplicate meals.')
  }

  const periodSum = (from, to) => active.filter(o => o.order_date >= from && o.order_date <= to).reduce((s, o) => s + parseFloat(o.total_amount || 0), 0)
  console.log('\nCombined actual order totals:')
  console.log('May26-Jun25:', periodSum('2026-05-26', '2026-06-25').toFixed(2))
  console.log('Jun26-Jul25:', periodSum('2026-06-26', '2026-07-25').toFixed(2))
  console.log('Jul26-Aug25:', periodSum('2026-07-26', '2026-08-25').toFixed(2))
  console.log('Aug01-Aug31:', periodSum('2026-08-01', '2026-08-31').toFixed(2), '(calendar month actual orders)')

  for (const [label, c] of [['DUPE', dupe], ['KEEPER', keeper]]) {
    const { data: invs, error } = await a.from('invoices')
      .select('id, invoice_number, invoice_type, billing_period_start, billing_period_end, subtotal, discount_amount, tax_amount, total_amount, status, notes')
      .eq('customer_id', c.id).order('billing_period_start')
    if (error) throw error
    console.log(`\n${label} invoices:`)
    for (const inv of invs) {
      const paid = await sumPayments(inv.id)
      console.log(`${inv.invoice_number} ${inv.invoice_type} ${inv.billing_period_start}..${inv.billing_period_end} subtotal ${inv.subtotal} disc ${inv.discount_amount} total ${inv.total_amount} status ${inv.status} paid ${paid.toFixed(2)}`)
      console.log('  notes:', String(inv.notes || '').replace(/\n/g, ' / '))
    }
  }

  for (const [label, c] of [['DUPE', dupe], ['KEEPER', keeper]]) {
    const { data: subs, error } = await a.from('customer_subscriptions').select('*, fixed_plans(plan_name, meal_periods, default_monthly_price)').eq('customer_id', c.id)
    if (error) throw error
    console.log(`\n${label} subscriptions:`)
    console.log(JSON.stringify(subs, null, 2))
  }
}
main().catch(e => { console.error(e); process.exit(1) })
