// MUTATION / AUDIT TRAIL: rebuild October 2026 Mai Dubai a_la_carte_cycle
// invoice lines from the authoritative orders + order_items tables. Corrects
// both duplicated and omitted lines caused by embedded PostgREST pagination.
// Preserves invoice numbers, payments and discount percentages. Run --apply.
const fs = require('fs')
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/)
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '')
}
const { createClient } = require('@supabase/supabase-js')
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
const APPLY = process.argv.includes('--apply')
const START = '2026-09-26', END = '2026-10-25', PAGE = 500, ID_BATCH = 100

async function all(build) {
  const out = []; let offset = 0
  while (true) {
    const { data, error } = await build(offset, offset + PAGE - 1)
    if (error) throw error
    out.push(...(data ?? []))
    if ((data ?? []).length < PAGE) return out
    offset += PAGE
  }
}
async function batched(ids, build) {
  const out = []
  for (let i = 0; i < ids.length; i += ID_BATCH) {
    const batch = ids.slice(i, i + ID_BATCH); let offset = 0
    while (true) {
      const { data, error } = await build(batch, offset, offset + PAGE - 1)
      if (error) throw error
      out.push(...(data ?? []))
      if ((data ?? []).length < PAGE) break
      offset += PAGE
    }
  }
  return out
}
function hasActivePlanOn(subs, date) {
  return (subs ?? []).some(s => s.start_date <= date && (s.end_date == null || s.end_date >= date) && Number(s.agreed_monthly_price) > 0)
}
function roundMoney(value) { return Math.round((Number(value) + Number.EPSILON) * 100) / 100 }
function signature(row) {
  return [row.description, Number(row.quantity), Number(row.unit_price), Number(row.total_price)].join('|')
}
function push(map, key, value) {
  const list = map.get(key)
  if (list) list.push(value); else map.set(key, [value])
}
function expectedLines(order, sourceItems, invoiceId) {
  if (!sourceItems.length) return [{
    invoice_id: invoiceId,
    order_id: order.id,
    description: order.notes?.trim() ? `${order.order_date} · ${order.meal_period} · ${order.notes.trim()}` : `${order.order_date} · ${order.meal_period} · ${order.order_number}`,
    quantity: '1',
    unit_price: Number(order.total_amount).toFixed(2),
    total_price: Number(order.total_amount).toFixed(2),
  }]
  return sourceItems.map(item => {
    const quantity = Number(item.quantity), unitPrice = Number(item.unit_price ?? 0)
    return {
      invoice_id: invoiceId,
      order_id: order.id,
      description: `${order.order_date} · ${order.meal_period} · ${item.item_name_snapshot}`,
      quantity: String(quantity),
      unit_price: unitPrice.toFixed(2),
      total_price: (quantity * unitPrice).toFixed(2),
    }
  })
}

async function main() {
  const customers = await all((from, to) => db.from('customers')
    .select('id,full_name,customer_code').eq('area', 'Mai Dubai').order('id').range(from, to))
  const customerById = new Map(customers.map(c => [c.id, c]))
  const invoices = (await all((from, to) => db.from('invoices')
    .select('id,customer_id,invoice_number,status,subtotal,discount_amount,tax_amount,total_amount,notes')
    .eq('invoice_type', 'a_la_carte_cycle').eq('billing_period_start', START).eq('billing_period_end', END)
    .neq('status', 'cancelled').order('id').range(from, to))).filter(i => customerById.has(i.customer_id))
  const invoiceByCustomer = new Map(invoices.map(i => [i.customer_id, i]))
  if (invoiceByCustomer.size !== invoices.length) throw new Error('Duplicate active cycle invoice found for a customer')

  const invoiceIds = invoices.map(i => i.id)
  const existingItems = await batched(invoiceIds, (ids, from, to) => db.from('invoice_items')
    .select('id,invoice_id,order_id,description,quantity,unit_price,total_price')
    .in('invoice_id', ids).order('id').range(from, to))
  const existingByInvoice = new Map()
  for (const item of existingItems) push(existingByInvoice, item.invoice_id, item)

  const customerIds = [...invoiceByCustomer.keys()]
  const orders = await batched(customerIds, (ids, from, to) => db.from('orders')
    .select('id,customer_id,total_amount,order_date,order_number,meal_period,notes')
    .in('customer_id', ids).gte('order_date', START).lte('order_date', END)
    .eq('is_credit', true).not('order_status', 'in', '(cancelled,voided,draft)').order('id').range(from, to))
  const subscriptions = await batched(customerIds, (ids, from, to) => db.from('customer_subscriptions')
    .select('id,customer_id,start_date,end_date,agreed_monthly_price').in('customer_id', ids).order('id').range(from, to))
  const subsByCustomer = new Map()
  for (const sub of subscriptions) push(subsByCustomer, sub.customer_id, sub)
  const eligibleOrders = orders.filter(order => !hasActivePlanOn(subsByCustomer.get(order.customer_id), order.order_date))

  const sourceItems = await batched(eligibleOrders.map(o => o.id), (ids, from, to) => db.from('order_items')
    .select('id,order_id,item_name_snapshot,quantity,unit_price').in('order_id', ids).order('id').range(from, to))
  const sourceByOrder = new Map()
  for (const item of sourceItems) push(sourceByOrder, item.order_id, item)
  for (const order of eligibleOrders) {
    const itemTotal = roundMoney((sourceByOrder.get(order.id) ?? []).reduce((sum, item) => sum + Number(item.quantity) * Number(item.unit_price ?? 0), 0))
    if ((sourceByOrder.get(order.id) ?? []).length && Math.abs(itemTotal - Number(order.total_amount)) > 0.011) {
      throw new Error(`${order.order_number}: source order_items total ${itemTotal} != order total ${order.total_amount}`)
    }
  }

  const settingsResult = await db.from('app_settings').select('vat_percent').eq('id', 1).single()
  if (settingsResult.error) throw settingsResult.error
  const vatRate = Number(settingsResult.data?.vat_percent ?? 5)
  const ledgers = await batched(invoiceIds, (ids, from, to) => db.from('ledger_entries')
    .select('id,reference_id,debit_amount').eq('reference_table', 'invoices').in('reference_id', ids).order('id').range(from, to))
  const ledgersByInvoice = new Map()
  for (const ledger of ledgers) push(ledgersByInvoice, ledger.reference_id, ledger)
  const payments = await batched(invoiceIds, (ids, from, to) => db.from('payments')
    .select('id,invoice_id,amount').in('invoice_id', ids).is('voided_at', null).order('id').range(from, to))
  const paidByInvoice = new Map()
  for (const payment of payments) paidByInvoice.set(payment.invoice_id, (paidByInvoice.get(payment.invoice_id) ?? 0) + Number(payment.amount))

  const expectedByInvoice = new Map(), ordersByInvoice = new Map()
  for (const order of eligibleOrders) {
    const invoice = invoiceByCustomer.get(order.customer_id)
    if (!invoice) continue
    push(ordersByInvoice, invoice.id, order)
    for (const line of expectedLines(order, sourceByOrder.get(order.id) ?? [], invoice.id)) push(expectedByInvoice, invoice.id, line)
  }

  const repairs = []
  for (const invoice of invoices) {
    const actual = existingByInvoice.get(invoice.id) ?? []
    const expected = expectedByInvoice.get(invoice.id) ?? []
    const actualBySignature = new Map(), expectedBySignature = new Map()
    for (const row of actual) push(actualBySignature, `${row.order_id}|${signature(row)}`, row)
    for (const row of expected) push(expectedBySignature, `${row.order_id}|${signature(row)}`, row)
    const deleteIds = [], insertRows = []
    for (const [sig, rows] of actualBySignature) {
      const keep = (expectedBySignature.get(sig) ?? []).length
      deleteIds.push(...rows.slice(keep).map(row => row.id))
    }
    for (const [sig, rows] of expectedBySignature) {
      const have = (actualBySignature.get(sig) ?? []).length
      insertRows.push(...rows.slice(have))
    }

    const expectedSubtotal = roundMoney((ordersByInvoice.get(invoice.id) ?? []).reduce((sum, order) => sum + Number(order.total_amount), 0))
    const oldSubtotal = Number(invoice.subtotal), oldDiscount = Number(invoice.discount_amount)
    const discountRate = oldSubtotal > 0 ? oldDiscount / oldSubtotal : 0
    const newDiscount = roundMoney(expectedSubtotal * discountRate)
    const newTotal = roundMoney(Math.max(0, expectedSubtotal - newDiscount))
    const newTax = roundMoney(newTotal * vatRate / (100 + vatRate))
    const paid = roundMoney(paidByInvoice.get(invoice.id) ?? 0)
    const newStatus = invoice.status === 'draft' ? 'draft' : paid >= newTotal - 0.005 ? 'paid' : paid > 0.005 ? 'partial' : 'issued'
    const invoiceChanged = Math.abs(oldSubtotal - expectedSubtotal) > 0.011 || Math.abs(oldDiscount - newDiscount) > 0.011 || Math.abs(Number(invoice.total_amount) - newTotal) > 0.011 || Math.abs(Number(invoice.tax_amount) - newTax) > 0.011 || invoice.status !== newStatus
    if (!deleteIds.length && !insertRows.length && !invoiceChanged) continue

    const invoiceLedgers = ledgersByInvoice.get(invoice.id) ?? []
    if (invoiceLedgers.length > 1) throw new Error(`${invoice.invoice_number}: multiple invoice ledger debits found`)
    if (invoice.status !== 'draft' && invoiceLedgers.length !== 1) throw new Error(`${invoice.invoice_number}: issued invoice has no ledger debit`)
    repairs.push({ invoice, customer: customerById.get(invoice.customer_id), deleteIds, insertRows, expectedSubtotal, newDiscount, newTax, newTotal, paid, newStatus, ledger: invoiceLedgers[0] ?? null })
  }

  console.table(repairs.map(r => ({
    customer: r.customer.full_name, invoice: r.invoice.invoice_number,
    removeLines: r.deleteIds.length, addLines: r.insertRows.length,
    oldSubtotal: Number(r.invoice.subtotal), newSubtotal: r.expectedSubtotal,
    oldTotal: Number(r.invoice.total_amount), newTotal: r.newTotal,
    oldStatus: r.invoice.status, newStatus: r.newStatus,
  })))
  console.log({
    mode: APPLY ? 'APPLY' : 'DRY RUN', invoices: repairs.length,
    linesToRemove: repairs.reduce((sum, r) => sum + r.deleteIds.length, 0),
    linesToAdd: repairs.reduce((sum, r) => sum + r.insertRows.length, 0),
    oldTotal: roundMoney(repairs.reduce((sum, r) => sum + Number(r.invoice.total_amount), 0)),
    newTotal: roundMoney(repairs.reduce((sum, r) => sum + r.newTotal, 0)),
  })
  if (!APPLY) return

  const backupPath = `scripts/.backup-mai-dubai-oct-ala-carte-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  fs.writeFileSync(backupPath, JSON.stringify({ createdAt: new Date().toISOString(), invoices, invoiceItems: existingItems, ledgers }, null, 2))
  console.log(`Backup written: ${backupPath}`)

  for (const repair of repairs) {
    for (let i = 0; i < repair.deleteIds.length; i += ID_BATCH) {
      const { error } = await db.from('invoice_items').delete().in('id', repair.deleteIds.slice(i, i + ID_BATCH))
      if (error) throw new Error(`${repair.invoice.invoice_number} delete: ${error.message}`)
    }
    for (let i = 0; i < repair.insertRows.length; i += ID_BATCH) {
      const { error } = await db.from('invoice_items').insert(repair.insertRows.slice(i, i + ID_BATCH))
      if (error) throw new Error(`${repair.invoice.invoice_number} insert: ${error.message}`)
    }
    const correctionNote = 'rebuilt from source orders: duplicates removed and missing entries restored (31 Oct 2026)'
    const notes = repair.invoice.notes?.includes(correctionNote) ? repair.invoice.notes : `${repair.invoice.notes ?? 'A La Carte cycle — October 2026'} · ${correctionNote}`
    const { error: invoiceError } = await db.from('invoices').update({
      subtotal: repair.expectedSubtotal.toFixed(2), discount_amount: repair.newDiscount.toFixed(2),
      tax_amount: repair.newTax.toFixed(2), total_amount: repair.newTotal.toFixed(2),
      status: repair.newStatus, notes,
    }).eq('id', repair.invoice.id)
    if (invoiceError) throw new Error(`${repair.invoice.invoice_number} update: ${invoiceError.message}`)
    if (repair.ledger) {
      const { error: ledgerError } = await db.from('ledger_entries').update({ debit_amount: repair.newTotal.toFixed(2) }).eq('id', repair.ledger.id)
      if (ledgerError) throw new Error(`${repair.invoice.invoice_number} ledger: ${ledgerError.message}`)
    }
  }
  console.log(`Rebuild applied successfully to ${repairs.length} invoices.`)
}
main().catch(error => { console.error('FAILED:', error.message); process.exit(1) })
