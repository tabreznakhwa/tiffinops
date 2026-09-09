// READ-ONLY. Verifies the settle-fixed-menu-drafts.js --confirm run:
// checks final invoice state, ledger entries, and audit log coverage for
// all 27 settled invoices.
const fs = require('fs')
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/)
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '')
}
const { createClient } = require('@supabase/supabase-js')
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

const NUMS = ['AC-INV-01064','AC-INV-01148','AC-INV-01076','AC-INV-01099','AC-INV-01101','AC-INV-01075','AC-INV-01083','AC-INV-01124','AC-INV-01122','AC-INV-01118','AC-INV-01142','AC-INV-01127','AC-INV-01072','AC-INV-01128','AC-INV-01115','AC-INV-01121','AC-INV-01066','AC-INV-01102','AC-INV-01107','AC-INV-01134','AC-INV-01094','AC-INV-01126','AC-INV-01059','AC-INV-01093','AC-INV-01085','AC-INV-01130','AC-INV-01133']

async function main() {
  const { data: invoices } = await admin.from('invoices').select('id, invoice_number, status, discount_amount, total_amount').in('invoice_number', NUMS)
  const byNum = new Map(invoices.map(i => [i.invoice_number, i]))

  const { data: ledger } = await admin.from('ledger_entries').select('reference_id, debit_amount, credit_amount, entry_date').eq('reference_table', 'invoices').in('reference_id', invoices.map(i => i.id))
  const ledgerByRef = new Map()
  for (const l of ledger ?? []) {
    if (!ledgerByRef.has(l.reference_id)) ledgerByRef.set(l.reference_id, [])
    ledgerByRef.get(l.reference_id).push(l)
  }

  const { data: audit } = await admin.from('audit_logs').select('record_id').eq('action', 'fixed_menu_draft_reconciliation').in('record_id', invoices.map(i => i.id))
  const auditedIds = new Set((audit ?? []).map(a => a.record_id))

  const rows = NUMS.map(n => {
    const inv = byNum.get(n)
    const ledgerRows = ledgerByRef.get(inv.id) || []
    return {
      invoice_number: n,
      status: inv.status,
      total: inv.total_amount,
      ledger_count: ledgerRows.length,
      ledger_debit: ledgerRows.map(l => l.debit_amount).join(','),
      audited: auditedIds.has(inv.id),
    }
  })
  console.table(rows)

  const zeroTotalNoLedger = rows.filter(r => parseFloat(r.total) === 0 && r.ledger_count === 0)
  const nonZeroNoLedger = rows.filter(r => parseFloat(r.total) > 0 && r.ledger_count === 0)
  const missingAudit = rows.filter(r => !r.audited)
  console.log(`\nZero-total with no ledger (expected/correct): ${zeroTotalNoLedger.length}`)
  console.log(`Non-zero total with NO ledger entry (BUG if any): ${nonZeroNoLedger.length}`, nonZeroNoLedger)
  console.log(`Missing audit log entries (BUG if any): ${missingAudit.length}`, missingAudit)
}
main()
