// One-off catch-up billing for exactly the 8 fixed_menu/no-active-sub Mai
// Dubai customers confirmed as fully unbilled this cycle (26 Aug-25 Sep
// 2026): INNOCENT, HASSAN 2453, Imross 2828, Surya 2869, Dauad 2611,
// Sadiq 2346, TWALIBU 1832, SHADUL 1578. Deliberately excludes Adnan 2075 /
// Naeem 3111 (already invoiced via AC-INV-01767/01768; their 2 missed
// post-pause orders each are merged into those existing invoices by a
// separate script instead of a new standalone invoice here). Mirrors
// generateAlaCarteInvoices.ts's per-item line logic and VAT calc exactly,
// scoped to this explicit customer allowlist so nobody else is touched.
const fs = require('fs')
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/)
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '')
}
const { createClient } = require('@supabase/supabase-js')
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

const CODES = ['AC-CUST-00028', 'AC-CUST-00119', 'AC-CUST-00204', 'AC-CUST-00203', 'AC-CUST-00134', 'AC-CUST-00255', 'AC-CUST-00152', 'AC-CUST-00150']
const PERIOD_START = '2026-08-26'
const PERIOD_END = '2026-09-25'
const MONTH_LABEL = 'September 2026'

async function main() {
  const { data: customers } = await admin.from('customers').select('id, full_name, customer_code').in('customer_code', CODES)
  if (customers.length !== CODES.length) throw new Error(`Expected ${CODES.length} customers, found ${customers.length}`)

  const { data: settings } = await admin.from('app_settings').select('vat_percent').eq('id', 1).single()
  const vatRate = parseFloat(String(settings?.vat_percent ?? '5'))

  const customerIds = customers.map(c => c.id)

  // Sanity: none of these 8 already have an a_la_carte_cycle invoice this cycle
  const { data: existing } = await admin.from('invoices').select('customer_id').eq('invoice_type', 'a_la_carte_cycle').eq('billing_period_start', PERIOD_START).eq('billing_period_end', PERIOD_END).in('customer_id', customerIds)
  if (existing.length > 0) throw new Error(`Already have invoices this cycle: ${JSON.stringify(existing)}`)

  // Already-invoiced order IDs (any invoice type, non-cancelled) — safety net
  const { data: items } = await admin.from('invoice_items').select('order_id, invoices!inner(status)').not('order_id', 'is', null).not('invoices.status', 'eq', 'cancelled')
  const alreadyInvoiced = new Set((items ?? []).filter(i => i.order_id).map(i => i.order_id))

  const { data: orders } = await admin.from('orders')
    .select('id, customer_id, total_amount, order_date, order_number, meal_period, notes, order_items(item_name_snapshot, quantity, unit_price)')
    .in('customer_id', customerIds)
    .gte('order_date', PERIOD_START).lte('order_date', PERIOD_END)
    .eq('is_credit', true)
    .not('order_status', 'in', '(cancelled,voided,draft)')

  const byCustomer = new Map()
  for (const o of orders) {
    if (alreadyInvoiced.has(o.id)) continue
    if (!byCustomer.has(o.customer_id)) byCustomer.set(o.customer_id, [])
    byCustomer.get(o.customer_id).push(o)
  }

  const results = []
  for (const cust of customers) {
    const custOrders = byCustomer.get(cust.id) ?? []
    const subtotal = custOrders.reduce((s, o) => s + parseFloat(o.total_amount), 0)
    if (subtotal < 0.01) { results.push({ customer: cust.full_name, skipped: 'no uninvoiced orders' }); continue }

    const taxAmount = (subtotal * vatRate) / (100 + vatRate)

    const { data: invNum, error: numErr } = await admin.rpc('next_invoice_number')
    if (numErr || !invNum) { results.push({ customer: cust.full_name, error: 'invoice number failed' }); continue }

    const today = '2026-09-28'
    const { data: invoice, error: insertErr } = await admin.from('invoices').insert({
      invoice_number: invNum,
      customer_id: cust.id,
      invoice_date: today,
      due_date: PERIOD_END,
      invoice_type: 'a_la_carte_cycle',
      billing_period_start: PERIOD_START,
      billing_period_end: PERIOD_END,
      subtotal: subtotal.toFixed(2),
      discount_amount: '0.00',
      tax_amount: taxAmount.toFixed(2),
      total_amount: subtotal.toFixed(2),
      status: 'draft',
      notes: `A La Carte cycle — ${MONTH_LABEL} · catch-up billing (fixed_menu, no active plan this cycle)`,
      created_by: null,
    }).select('id').single()
    if (insertErr || !invoice) { results.push({ customer: cust.full_name, error: insertErr?.message }); continue }

    const lineItems = custOrders.flatMap(o => {
      const oitems = o.order_items ?? []
      if (oitems.length === 0) {
        const description = o.notes?.trim() ? `${o.order_date} · ${o.meal_period} · ${o.notes.trim()}` : `${o.order_date} · ${o.meal_period} · ${o.order_number}`
        return [{ invoice_id: invoice.id, order_id: o.id, description, quantity: '1', unit_price: parseFloat(o.total_amount).toFixed(2), total_price: parseFloat(o.total_amount).toFixed(2) }]
      }
      return oitems.map(it => {
        const qty = parseFloat(it.quantity)
        const unitPrice = parseFloat(String(it.unit_price ?? '0'))
        return { invoice_id: invoice.id, order_id: o.id, description: `${o.order_date} · ${o.meal_period} · ${it.item_name_snapshot}`, quantity: String(qty), unit_price: unitPrice.toFixed(2), total_price: (qty * unitPrice).toFixed(2) }
      })
    })
    const { error: itemsErr } = await admin.from('invoice_items').insert(lineItems)
    if (itemsErr) { await admin.from('invoices').delete().eq('id', invoice.id); results.push({ customer: cust.full_name, error: itemsErr.message }); continue }

    results.push({ customer: cust.full_name, invoice_number: invNum, total: subtotal.toFixed(2) })
  }
  console.table(results)
}
main().catch(e => { console.error('FAILED:', e.message); process.exit(1) })
