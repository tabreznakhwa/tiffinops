// READ-ONLY diagnostic — no writes. Run with: node scripts/audit-draft-invoices.js
const fs = require('fs')
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/)
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '')
}
const { createClient } = require('@supabase/supabase-js')

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

async function main() {
  const { data: drafts, error } = await admin
    .from('invoices')
    .select('id, invoice_number, invoice_type, customer_id, total_amount, invoice_date, customers(full_name, customer_code)')
    .eq('status', 'draft')
    .order('invoice_date', { ascending: true })

  if (error) { console.error(error); process.exit(1) }
  if (!drafts || drafts.length === 0) { console.log('No draft invoices.'); return }

  // Breakdown by invoice_type
  const byType = {}
  for (const inv of drafts) {
    byType[inv.invoice_type] = (byType[inv.invoice_type] || 0) + 1
  }
  console.log(`\nTotal draft invoices: ${drafts.length}`)
  console.log('By type:', byType)

  // Payments linked directly (invoice_id) — these are payments already
  // recorded against these draft invoices, i.e. the "payment came in before
  // status was fixed" cases.
  const ids = drafts.map(d => d.id)
  const { data: linkedPayments } = await admin
    .from('payments')
    .select('invoice_id, amount, payment_date')
    .in('invoice_id', ids)
    .is('voided_at', null)

  const paidByInvoice = new Map()
  for (const p of linkedPayments ?? []) {
    paidByInvoice.set(p.invoice_id, (paidByInvoice.get(p.invoice_id) || 0) + parseFloat(p.amount))
  }

  console.log(`\nDraft invoices WITH a payment already linked to them: ${paidByInvoice.size}`)

  // For each draft invoice with a payment, show total vs paid vs implied
  // discount % needed to bring total down to what was actually paid.
  const rows = drafts
    .filter(inv => paidByInvoice.has(inv.id))
    .map(inv => {
      const total = parseFloat(inv.total_amount)
      const paid = paidByInvoice.get(inv.id)
      const gap = total - paid
      const impliedDiscountPct = total > 0 ? (gap / total) * 100 : 0
      return {
        invoice_number: inv.invoice_number,
        type: inv.invoice_type,
        customer: inv.customers?.full_name ?? inv.customer_id,
        total: total.toFixed(2),
        paid: paid.toFixed(2),
        gap: gap.toFixed(2),
        implied_discount_pct: impliedDiscountPct.toFixed(1),
      }
    })
    .sort((a, b) => parseFloat(b.implied_discount_pct) - parseFloat(a.implied_discount_pct))

  console.log('\nPer-invoice detail (sorted by implied discount % needed, highest first):')
  console.table(rows)

  // Aggregate implied-discount stats by invoice type
  const byTypeStats = {}
  for (const r of rows) {
    if (!byTypeStats[r.type]) byTypeStats[r.type] = { count: 0, totalGap: 0, totalAmount: 0 }
    byTypeStats[r.type].count += 1
    byTypeStats[r.type].totalGap += parseFloat(r.gap)
    byTypeStats[r.type].totalAmount += parseFloat(r.total)
  }
  console.log('\nAggregate by invoice type:')
  for (const [type, s] of Object.entries(byTypeStats)) {
    const avgDiscountPct = s.totalAmount > 0 ? (s.totalGap / s.totalAmount) * 100 : 0
    console.log(`  ${type}: ${s.count} invoices, total gap AED ${s.totalGap.toFixed(2)} / total amount AED ${s.totalAmount.toFixed(2)} → avg implied discount ${avgDiscountPct.toFixed(1)}%`)
  }
}

main()
