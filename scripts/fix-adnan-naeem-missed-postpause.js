// One-off correction. AC-INV-01767 (Adnan 2075) and AC-INV-01768 (Naeem
// 3111) missed 2 post-pause dinner orders each (Sept 17 & 23), wrongly
// netted to AED 0 by bill-paused-mai-dubai-gap.ts's in-plan-usage
// classification (it checked subscription_meal_pauses windows, not the
// subscription's own end_date). Adds one "missed, outside plan" line item
// per order to each existing invoice and bumps subtotal/tax/total_amount by
// the missed amount, rather than issuing a new invoice for this cycle.
const fs = require('fs')
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/)
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '')
}
const { createClient } = require('@supabase/supabase-js')
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

async function main() {
  const { data: settings } = await admin.from('app_settings').select('vat_percent').eq('id', 1).single()
  const vatRate = parseFloat(String(settings?.vat_percent ?? '5'))

  const targets = [
    { code: 'AC-CUST-00051', invoiceNumber: 'AC-INV-01767', name: 'Adnan 2075', orderNumbers: ['AC-A-260923-11094', 'AC-A-260917-10062'] },
    { code: 'AC-CUST-00219', invoiceNumber: 'AC-INV-01768', name: 'Naeem 3111', orderNumbers: ['AC-A-260923-11065', 'AC-A-260917-10067'] },
  ]

  const results = []
  for (const t of targets) {
    const { data: cust } = await admin.from('customers').select('id, full_name').eq('customer_code', t.code).single()
    const { data: invoice } = await admin.from('invoices').select('id, invoice_number, subtotal, tax_amount, total_amount, discount_amount').eq('invoice_number', t.invoiceNumber).single()
    if (!invoice) throw new Error(`${t.invoiceNumber} not found`)

    const { data: orders } = await admin.from('orders')
      .select('id, order_number, order_date, meal_period, total_amount, notes, order_items(item_name_snapshot, quantity, unit_price)')
      .eq('customer_id', cust.id)
      .in('order_number', t.orderNumbers)
    if (orders.length !== t.orderNumbers.length) throw new Error(`${t.name}: expected ${t.orderNumbers.length} orders, found ${orders.length}`)

    // Verify these order_ids aren't already linked to any invoice_item anywhere
    const { data: existingLinks } = await admin.from('invoice_items').select('order_id').in('order_id', orders.map(o => o.id))
    if (existingLinks.length > 0) throw new Error(`${t.name}: some orders already linked to an invoice_item: ${JSON.stringify(existingLinks)}`)

    const missedAmount = orders.reduce((s, o) => s + parseFloat(o.total_amount), 0)

    const lineItems = orders.flatMap(o => {
      const oitems = o.order_items ?? []
      if (oitems.length === 0) {
        return [{ invoice_id: invoice.id, order_id: o.id, description: `${o.order_date} · ${o.meal_period} · missed, outside plan (post-pause) · ${o.order_number}`, quantity: '1', unit_price: parseFloat(o.total_amount).toFixed(2), total_price: parseFloat(o.total_amount).toFixed(2) }]
      }
      return oitems.map(it => {
        const qty = parseFloat(it.quantity)
        const unitPrice = parseFloat(String(it.unit_price ?? '0'))
        return { invoice_id: invoice.id, order_id: o.id, description: `${o.order_date} · ${o.meal_period} · missed, outside plan (post-pause) · ${it.item_name_snapshot}`, quantity: String(qty), unit_price: unitPrice.toFixed(2), total_price: (qty * unitPrice).toFixed(2) }
      })
    })

    const { error: itemsErr } = await admin.from('invoice_items').insert(lineItems)
    if (itemsErr) throw new Error(`${t.name}: insert failed: ${itemsErr.message}`)

    const newSubtotal = parseFloat(invoice.subtotal) + missedAmount
    const newTotal     = parseFloat(invoice.total_amount) + missedAmount
    const newTax        = (newTotal * vatRate) / (100 + vatRate)

    const { error: updErr } = await admin.from('invoices').update({
      subtotal:     newSubtotal.toFixed(2),
      tax_amount:   newTax.toFixed(2),
      total_amount: newTotal.toFixed(2),
    }).eq('id', invoice.id)
    if (updErr) throw new Error(`${t.name}: invoice update failed: ${updErr.message}`)

    results.push({ customer: t.name, invoice: t.invoiceNumber, missedAmount: missedAmount.toFixed(2), oldTotal: invoice.total_amount, newTotal: newTotal.toFixed(2) })
  }
  console.table(results)
}
main().catch(e => { console.error('FAILED:', e.message); process.exit(1) })
