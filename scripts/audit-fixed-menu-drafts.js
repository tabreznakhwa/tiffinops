// READ-ONLY. Fixed_menu-customer draft invoices with a surplus-payment gap.
const fs = require('fs')
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/)
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '')
}
const { createClient } = require('@supabase/supabase-js')
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

async function main() {
  const { data: drafts } = await admin
    .from('invoices')
    .select('id, invoice_number, invoice_date, due_date, total_amount, customer_id, customers(full_name, customer_code, customer_type)')
    .eq('status', 'draft')

  const fixedDrafts = drafts.filter(d => d.customers?.customer_type === 'fixed_menu')
  const customerIds = [...new Set(fixedDrafts.map(d => d.customer_id))]

  const { data: otherInvoices } = await admin
    .from('invoices').select('customer_id, total_amount, status')
    .in('customer_id', customerIds).in('status', ['issued', 'partial', 'paid', 'overdue'])
  const invoicedByCustomer = new Map()
  for (const inv of otherInvoices ?? []) invoicedByCustomer.set(inv.customer_id, (invoicedByCustomer.get(inv.customer_id) || 0) + parseFloat(inv.total_amount))

  const { data: payments } = await admin
    .from('payments').select('customer_id, amount, payment_date, invoice_id')
    .in('customer_id', customerIds).is('voided_at', null)
  const paidByCustomer = new Map()
  const paymentsByCustomer = new Map()
  for (const p of payments ?? []) {
    paidByCustomer.set(p.customer_id, (paidByCustomer.get(p.customer_id) || 0) + parseFloat(p.amount))
    if (!paymentsByCustomer.has(p.customer_id)) paymentsByCustomer.set(p.customer_id, [])
    paymentsByCustomer.get(p.customer_id).push(p)
  }

  const rows = fixedDrafts.map(inv => {
    const invoiced = invoicedByCustomer.get(inv.customer_id) || 0
    const paid = paidByCustomer.get(inv.customer_id) || 0
    const surplus = Math.max(0, paid - invoiced)
    const draftTotal = parseFloat(inv.total_amount)
    const impliedDiscount = Math.min(surplus, draftTotal)
    const remaining = Math.max(0, draftTotal - impliedDiscount)
    const unlinkedPaymentCount = (paymentsByCustomer.get(inv.customer_id) || []).filter(p => !p.invoice_id).length
    return {
      invoice_number: inv.invoice_number,
      customer: inv.customers?.full_name,
      customer_code: inv.customers?.customer_code,
      invoice_date: inv.invoice_date,
      draft_total: draftTotal.toFixed(2),
      customer_total_paid: paid.toFixed(2),
      already_invoiced_elsewhere: invoiced.toFixed(2),
      surplus: surplus.toFixed(2),
      implied_discount: impliedDiscount.toFixed(2),
      remaining_due_after_discount: remaining.toFixed(2),
      unlinked_payment_count: unlinkedPaymentCount,
    }
  }).sort((a, b) => parseFloat(b.implied_discount) - parseFloat(a.implied_discount))

  console.log(`Fixed-menu customers with draft invoices: ${fixedDrafts.length}`)
  console.log(`...of which have a nonzero surplus/implied-discount gap: ${rows.filter(r => parseFloat(r.implied_discount) > 0).length}\n`)
  console.table(rows)

  const fullyCovered = rows.filter(r => parseFloat(r.remaining_due_after_discount) < 0.01)
  console.log(`\nFully covered by surplus (would become 100% discount, straight to Paid): ${fullyCovered.length}`)
  const partiallyCovered = rows.filter(r => parseFloat(r.implied_discount) > 0 && parseFloat(r.remaining_due_after_discount) >= 0.01)
  console.log(`Partially covered (discount + still owe something after): ${partiallyCovered.length}`)
  const noGap = rows.filter(r => parseFloat(r.implied_discount) === 0)
  console.log(`No surplus at all (genuinely just unbilled, not a reconciliation case): ${noGap.length}`)
}
main()
