// READ-ONLY diagnostic — no writes. Run with: node scripts/audit-draft-discount-gap.js
//
// For each customer with a draft invoice, compares:
//   - total they've been formally invoiced (issued/partial/paid/overdue invoices — excludes this draft, cancelled, written_off)
//   - total they've actually paid (all non-voided payments, all-time)
// The surplus (paid - invoiced) is money that's arrived but has nowhere to
// land except this draft invoice — that's the "implied discount" needed on
// the draft to bring its total down to just the real remaining balance.
const fs = require('fs')
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/)
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '')
}
const { createClient } = require('@supabase/supabase-js')
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

async function main() {
  const { data: drafts, error } = await admin
    .from('invoices')
    .select('id, invoice_number, invoice_type, total_amount, customer_id, customers(full_name, customer_code, customer_type)')
    .eq('status', 'draft')
  if (error) { console.error(error); process.exit(1) }

  const customerIds = [...new Set(drafts.map(d => d.customer_id))]

  const { data: otherInvoices } = await admin
    .from('invoices')
    .select('customer_id, total_amount, status')
    .in('customer_id', customerIds)
    .in('status', ['issued', 'partial', 'paid', 'overdue'])

  const invoicedByCustomer = new Map()
  for (const inv of otherInvoices ?? []) {
    invoicedByCustomer.set(inv.customer_id, (invoicedByCustomer.get(inv.customer_id) || 0) + parseFloat(inv.total_amount))
  }

  const { data: payments } = await admin
    .from('payments')
    .select('customer_id, amount')
    .in('customer_id', customerIds)
    .is('voided_at', null)

  const paidByCustomer = new Map()
  for (const p of payments ?? []) {
    paidByCustomer.set(p.customer_id, (paidByCustomer.get(p.customer_id) || 0) + parseFloat(p.amount))
  }

  const rows = drafts.map(inv => {
    const invoiced = invoicedByCustomer.get(inv.customer_id) || 0
    const paid = paidByCustomer.get(inv.customer_id) || 0
    const surplus = Math.max(0, paid - invoiced) // money paid with nowhere else to land
    const draftTotal = parseFloat(inv.total_amount)
    const impliedDiscount = Math.min(surplus, draftTotal)
    const impliedDiscountPct = draftTotal > 0 ? (impliedDiscount / draftTotal) * 100 : 0
    return {
      invoice_number: inv.invoice_number,
      customer_type: inv.customers?.customer_type ?? 'unknown',
      customer: inv.customers?.full_name ?? inv.customer_id,
      draft_total: draftTotal.toFixed(2),
      other_invoiced: invoiced.toFixed(2),
      total_paid: paid.toFixed(2),
      surplus_paid: surplus.toFixed(2),
      implied_discount_pct: impliedDiscountPct.toFixed(1),
    }
  }).filter(r => parseFloat(r.implied_discount_pct) > 0)
    .sort((a, b) => parseFloat(b.implied_discount_pct) - parseFloat(a.implied_discount_pct))

  console.log(`Draft invoices with a nonzero implied discount (surplus payment): ${rows.length} of ${drafts.length}\n`)
  console.table(rows)

  const byType = {}
  for (const r of rows) {
    if (!byType[r.customer_type]) byType[r.customer_type] = { count: 0, sumPct: 0 }
    byType[r.customer_type].count += 1
    byType[r.customer_type].sumPct += parseFloat(r.implied_discount_pct)
  }
  console.log('\nAverage implied discount % by customer_type (among those with a nonzero gap):')
  for (const [ct, s] of Object.entries(byType)) {
    console.log(`  ${ct}: ${s.count} invoices, avg implied discount ${(s.sumPct / s.count).toFixed(1)}%`)
  }
}
main()
