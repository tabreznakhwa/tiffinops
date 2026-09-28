// WRITE script — user-approved cleanup. Cancels the 40 stray fixed_monthly
// invoices identified by scripts/diag-mai-dubai-stray-invoices.js: they all
// share billing_period_start = '2026-08-26' but have a WRONG, truncated
// billing_period_end ('2026-08-31' or '2026-09-01' — a 6-7 day span) instead
// of the correct 31-day Mai Dubai cycle end '2026-09-25'.
//
// Root cause (confirmed via git log): these were created by
// scripts/backfill-multiplan-anniversary.ts, run at commit 56b9c05 (2026-09-11
// 11:47am) which called generateFixedAnniversaryInvoices() — at that point in
// time this function did NOT yet exclude Mai Dubai fixed_menu customers (that
// exclusion landed 4 hours later in commit 86fcef5, 3:50pm same day). So it
// billed these Mai Dubai customers on their own individual subscription
// anniversary date instead of the shared 26th cycle, producing a short stub
// period. generateFixedAnniversaryInvoices.ts has excluded area='Mai Dubai'
// fixed_menu customers ever since — this cannot happen again with current
// code, and generateMonthlyInvoices.ts / generatePrepaidInvoices.ts /
// subscription-approval.ts were independently confirmed unable to produce
// this period shape either.
//
// These stray invoices are also the reason the Aug26-Sep25 backfill produced
// generated:0 — generateMonthlyInvoices.ts's idempotency check only matches
// (customer_id, billing_period_start), so these wrong-period rows silently
// satisfied it. Cancelling them frees that (customer, periodStart) slot for
// the real invoice.
//
// Only cancels rows currently in 'draft' or 'issued' status (matches the
// existing voidInvoice() pattern in lib/invoices/actions.ts — no ledger
// reversal, consistent with how every other invoice cancellation in this
// app works; the customer balance used everywhere else is computed straight
// from orders+payments, not from invoices/ledger, so this doesn't touch any
// customer's real balance).
//
// Usage:
//   node scripts/cancel-stray-mai-dubai-invoices.js            (dry run)
//   node scripts/cancel-stray-mai-dubai-invoices.js --confirm   (apply)
const fs = require('fs')
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/)
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '')
}
const { createClient } = require('@supabase/supabase-js')
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

const CONFIRM = process.argv.includes('--confirm')
const PERIOD_START = '2026-08-26'
const CORRECT_PERIOD_END = '2026-09-25'
const TODAY = '2026-09-28'

async function main() {
  const { data: strays, error } = await admin
    .from('invoices')
    .select('id, invoice_number, customer_id, status, billing_period_start, billing_period_end, total_amount, customers(full_name, customer_code)')
    .eq('invoice_type', 'fixed_monthly')
    .eq('billing_period_start', PERIOD_START)
    .neq('billing_period_end', CORRECT_PERIOD_END)
    .order('invoice_number')
  if (error) throw error

  console.log(`[${CONFIRM ? 'APPLY' : 'DRY RUN'}] Found ${strays.length} stray fixed_monthly invoices (ps=${PERIOD_START}, wrong pe):\n`)
  console.table(strays.map(i => ({ inv: i.invoice_number, customer: i.customers?.full_name, code: i.customers?.customer_code, status: i.status, pe: i.billing_period_end, total: i.total_amount })))

  const toCancel = strays.filter(i => i.status === 'draft' || i.status === 'issued')
  const alreadyCancelled = strays.filter(i => i.status === 'cancelled')
  console.log(`\nTo cancel (draft/issued): ${toCancel.length}`)
  console.log(`Already cancelled (no action needed): ${alreadyCancelled.length}`)
  const other = strays.filter(i => !['draft', 'issued', 'cancelled'].includes(i.status))
  if (other.length) console.log(`UNEXPECTED status (needs manual review, NOT auto-cancelled): ${other.length}`, other.map(i => i.invoice_number))

  if (!CONFIRM) {
    console.log('\nRe-run with --confirm to cancel the draft/issued stray invoices above.')
    return
  }

  const reason = `[${TODAY}] Cancelled — stray invoice from a since-fixed generator bug (backfill-multiplan-anniversary.ts run on 2026-09-11 before the Mai Dubai exclusion in generateFixedAnniversaryInvoices.ts landed). Wrong period (${PERIOD_START}→${'{END}'}) instead of the correct Mai Dubai 26-25 cycle (${PERIOD_START}→${CORRECT_PERIOD_END}). Superseded by the correct full-cycle invoice.`

  let cancelled = 0
  const errors = []
  for (const inv of toCancel) {
    const { error: updErr } = await admin
      .from('invoices')
      .update({ status: 'cancelled', notes: reason.replace('{END}', inv.billing_period_end) })
      .eq('id', inv.id)
      .in('status', ['draft', 'issued'])
    if (updErr) { errors.push(`${inv.invoice_number}: ${updErr.message}`); continue }
    console.log(`Cancelled ${inv.invoice_number} (${inv.customers?.full_name}, was ${inv.status}, ${inv.billing_period_start}→${inv.billing_period_end})`)
    cancelled++
  }
  console.log(`\nCancelled ${cancelled}/${toCancel.length}`)
  if (errors.length) console.log('Errors:', errors)
}
main().catch(e => { console.error('FAILED:', e.message); process.exit(1) })
