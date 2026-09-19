// WRITE script — one-off backfill, 2026-09-19.
//
// The cron invoice generators (prepaid anniversary, postpaid fixed
// anniversary, and the Mai Dubai monthly generator) create fixed_monthly
// invoices in `draft` status and nothing ever issued them — issuance was a
// separate manual "Issue" step that staff were not performing. As a result
// every fixed-menu bill piled up as an invisible draft: no ledger debit, and
// excluded from the Outstanding "month bills" breakdown (which only shows
// issued/partial/paid/overdue), so customers appeared "overdue" with no bill
// behind them.
//
// This backfills the ~31 fixed_monthly drafts currently stuck in the system by
// issuing each one: status draft -> issued, plus the matching ledger debit
// entry. It mirrors bulkIssueDraftInvoices() exactly, except created_by is
// null (system-initiated) and it skips any invoice that already has a
// non-reversed ledger entry, so a re-run can never double-debit.
//
// The generators themselves have been fixed to auto-issue going forward, so
// this script is a one-time cleanup, not a recurring step.
const fs = require('fs')
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/)
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '')
}
const { createClient } = require('@supabase/supabase-js')
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

function todayDubai() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

async function main() {
  const today = todayDubai()
  const { data: drafts, error } = await admin
    .from('invoices')
    .select('id, invoice_number, customer_id, total_amount, status, billing_period_start, billing_period_end')
    .eq('invoice_type', 'fixed_monthly')
    .eq('status', 'draft')

  if (error) throw new Error(error.message)
  console.log(`Found ${drafts?.length ?? 0} fixed_monthly drafts to issue.`)

  let issued = 0
  let skippedLedger = 0
  const failed = []

  for (const inv of drafts ?? []) {
    // Guard against double-debit: skip if a non-reversed ledger entry already exists.
    const { data: existing } = await admin
      .from('ledger_entries')
      .select('id')
      .eq('reference_table', 'invoices')
      .eq('reference_id', inv.id)
      .is('reversal_of', null)

    if (existing && existing.length > 0) {
      // Ledger already present — just flip status without adding another debit.
      const { error: uErr } = await admin.from('invoices').update({ status: 'issued' }).eq('id', inv.id)
      if (uErr) { failed.push(`${inv.invoice_number}: ${uErr.message}`); continue }
      skippedLedger++
      continue
    }

    const { error: updErr } = await admin.from('invoices').update({ status: 'issued' }).eq('id', inv.id).eq('status', 'draft')
    if (updErr) { failed.push(`${inv.invoice_number}: ${updErr.message}`); continue }

    const { error: ledgerErr } = await admin.from('ledger_entries').insert({
      customer_id:     inv.customer_id,
      entry_date:      today,
      entry_type:      'invoice',
      debit_amount:    parseFloat(String(inv.total_amount)).toFixed(2),
      credit_amount:   '0.00',
      description:     `Invoice ${inv.invoice_number}`,
      reference_table: 'invoices',
      reference_id:    inv.id,
      created_by:      null,
    })

    if (ledgerErr) {
      await admin.from('invoices').update({ status: 'draft' }).eq('id', inv.id)
      failed.push(`${inv.invoice_number}: ${ledgerErr.message}`)
      continue
    }
    issued++
  }

  console.log(`Issued (with new ledger debit): ${issued}`)
  console.log(`Issued (ledger already existed): ${skippedLedger}`)
  console.log(`Failed: ${failed.length}`)
  if (failed.length) console.table(failed)

  // Verify no drafts remain
  const { data: remaining } = await admin.from('invoices').select('id').eq('invoice_type', 'fixed_monthly').eq('status', 'draft')
  console.log(`Remaining fixed_monthly drafts: ${remaining?.length ?? 0}`)
}

main().catch(e => { console.error('FAILED', e.message); process.exit(1) })
