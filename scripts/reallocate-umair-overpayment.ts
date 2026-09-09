// One-off, part 2 of the Umair Muteena (AC-CUST-00163) fix.
//
// Context: after correcting his subscription start_date to 2026-07-01 (via
// the UI) and fixing reconcileInvoicesForSubscription's invoice-window bug
// (it was silently skipping invoices whose billing period starts before a
// just-corrected, later start_date), a fresh dry run shows AC-INV-01521
// (Jun 10 - Jul 9 cycle, billed under the old wrong Jun 10 start) should
// drop from AED 200 to AED 60 — it's already paid in full via PAY-00108
// (AED 200, bank transfer, 2026-07-01), so correcting it creates a AED 140
// surplus on that invoice.
//
// Owner decision: apply that AED 140 toward AC-INV-01523 (currently AED
// 148.39, unpaid) rather than refund it or leave it unapplied — same money,
// reallocated. Since payments are linked 1:1 to a single invoice
// (payments.invoice_id) and reconcileInvoicePaymentStatus sums payments by
// invoice_id, the reallocation is done by splitting PAY-00108 in place:
//   - PAY-00108 itself reduced from AED 200 to AED 60 (still linked to
//     AC-INV-01521, same date/mode/reference — it's the same bank transfer).
//   - A new payment row for AED 140 inserted, linked to AC-INV-01523, same
//     date/mode/reference/is_advance as PAY-00108 (again, same money) with
//     notes cross-referencing PAY-00108 so the audit trail is clear both ways.
//
// This script:
//   1. Runs the real reconcileInvoicesForSubscription for Umair's
//      subscription — corrects AC-INV-01521's total to AED 60 (proration
//      adjustment line + ledger). AC-INV-01522/01523 are expected to be
//      no-ops (already correct per the last dry run).
//   2. Splits PAY-00108 as described above.
//   3. Re-runs reconcileInvoicePaymentStatus for both AC-INV-01521 and
//      AC-INV-01523 so their status (paid/partial/issued) reflects the split.
//
// Dry-run by default (shows current state + what would change, no writes).
// Pass --confirm to actually apply it.
//
// Usage:
//   npx tsx scripts/reallocate-umair-overpayment.ts            (dry run)
//   npx tsx scripts/reallocate-umair-overpayment.ts --confirm   (apply)

import fs from 'fs'
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/)
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '')
}

import { createClient } from '@supabase/supabase-js'
import { reconcileInvoicesForSubscription } from '../lib/fixed-menu/subscription-approval'
import { reconcileInvoicePaymentStatus } from '../lib/invoices/reconcile'

const CONFIRM = process.argv.includes('--confirm')
const SUBSCRIPTION_ID = '208ce65e-6780-4dfe-9c39-58943240ce10'
const CUSTOMER_ID = 'ea1d88e2-607a-4767-a48a-00be3d37d5fc'
const INV_01521_ID = '842036b7-0f80-4acb-8708-a03528414fd3'
const INV_01523_ID = '552be169-e04f-4041-831f-8b1c83d96272'
const PAY_00108_ID = 'a56a684b-bdb5-4c68-b7da-cb7e23bf9d90'
const OWNER_USER_ID = 'a277b0b4-7869-4c7f-bab3-99b522d249f3' // tabrez nakhwa, owner
const ACTOR_ID = 'system-script'
const SURPLUS = 140.00
const REMAINING_ON_01521 = 60.00

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
) as any

async function snapshot() {
  const { data: invoices } = await admin
    .from('invoices')
    .select('id, invoice_number, billing_period_start, billing_period_end, status, total_amount')
    .eq('customer_id', CUSTOMER_ID)
    .order('billing_period_start')
  console.log('invoices:')
  console.table(invoices)

  const { data: payments } = await admin
    .from('payments')
    .select('payment_number, amount, invoice_id, payment_date, mode, notes')
    .eq('customer_id', CUSTOMER_ID)
    .order('payment_date')
  console.log('payments:')
  console.table(payments.map((p: { invoice_id: string | null } & Record<string, unknown>) => ({
    ...p,
    invoice_number: invoices.find((i: { id: string; invoice_number: string }) => i.id === p.invoice_id)?.invoice_number ?? '(unlinked)',
  })))
}

async function main() {
  console.log('--- BEFORE ---')
  await snapshot()

  if (!CONFIRM) {
    console.log(`
[DRY RUN] plan:
  1. reconcileInvoicesForSubscription on subscription ${SUBSCRIPTION_ID}
     -> expected: AC-INV-01521 total 200.00 -> 60.00 (proration adjustment line + ledger update)
        AC-INV-01522, AC-INV-01523 unchanged (already correct per last dry run)
  2. PAY-00108 (currently AED 200.00, linked to AC-INV-01521) split:
     -> PAY-00108 amount reduced to AED ${REMAINING_ON_01521.toFixed(2)} (stays linked to AC-INV-01521)
     -> new payment inserted: AED ${SURPLUS.toFixed(2)}, linked to AC-INV-01523, same date/mode/reference as PAY-00108
  3. reconcileInvoicePaymentStatus re-run for AC-INV-01521 and AC-INV-01523
     -> AC-INV-01521: paid 60.00 / total 60.00 -> 'paid'
     -> AC-INV-01523: paid 140.00 / total 148.39 -> 'partial', AED 8.39 still due

No writes made. Re-run with --confirm to apply.`)
    return
  }

  const result = await reconcileInvoicesForSubscription(
    admin,
    SUBSCRIPTION_ID,
    ACTOR_ID,
    'Retroactive fix — corrected start date (Jun 10 -> Jul 1) invalidated AC-INV-01521\'s original amount',
  )
  console.log('\nreconcile result:', result)

  const { data: origPayment } = await admin
    .from('payments')
    .select('payment_number, mode, reference_number, payment_date, is_advance')
    .eq('id', PAY_00108_ID)
    .single()

  const { error: splitErr } = await admin
    .from('payments')
    .update({
      amount: REMAINING_ON_01521.toFixed(2),
      notes: `AED ${SURPLUS.toFixed(2)} of this payment reallocated to AC-INV-01523 (start-date correction reduced this invoice's true amount; see new payment record) — owner-approved, ${new Date().toISOString().slice(0, 10)}`,
    })
    .eq('id', PAY_00108_ID)
  if (splitErr) { console.error('failed to split PAY-00108:', splitErr.message); process.exit(1) }

  const { data: payNumber, error: numErr } = await admin.rpc('next_payment_number')
  if (numErr || !payNumber) { console.error('could not generate payment number:', numErr?.message); process.exit(1) }

  const { error: insertErr } = await admin.from('payments').insert({
    payment_number: payNumber as string,
    customer_id: CUSTOMER_ID,
    invoice_id: INV_01523_ID,
    amount: SURPLUS.toFixed(2),
    mode: origPayment.mode,
    reference_number: origPayment.reference_number,
    payment_date: origPayment.payment_date,
    is_advance: origPayment.is_advance,
    notes: `Reallocated from ${origPayment.payment_number} (AC-INV-01521 overpayment after start-date correction) — owner-approved, ${new Date().toISOString().slice(0, 10)}`,
    received_by: OWNER_USER_ID,
  })
  if (insertErr) { console.error('failed to insert new payment:', insertErr.message); process.exit(1) }

  await reconcileInvoicePaymentStatus(admin, INV_01521_ID)
  await reconcileInvoicePaymentStatus(admin, INV_01523_ID)

  console.log('\n--- AFTER ---')
  await snapshot()
}

main().catch(e => { console.error(e); process.exit(1) })
