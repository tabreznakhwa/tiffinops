// WRITE script — user-confirmed revert of the previous correction. The
// owner confirmed the AED 460 plan/invoice was correct all along, and the
// AED 660 subscription entered earlier today (2026-09-11) was their own
// data-entry mistake. This undoes fix-hassanmiya-460-to-660.js exactly:
//  1. Cancel AC-INV-01641 (the mistaken 660 invoice)
//  2. Restore AC-INV-01479 back to 'issued' at AED 460
//  3. Reverse both invoices' ledger entries accordingly
//  4. Correct the live subscription row back to the original 460 plan so
//     future cron-generated invoices don't repeat the 660 mistake
const fs = require('fs')
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/)
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '')
}
const { createClient } = require('@supabase/supabase-js')
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

const CUSTOMER_ID       = '2d96885c-192f-4a29-81d6-1b2a9b8534a5' // Hassan Miya
const OWNER_ID          = 'a277b0b4-7869-4c7f-bab3-99b522d249f3' // tabrez nakhwa (owner)
const OLD_INVOICE_ID    = '8022628d-819b-4362-a53e-d1cbbc0aba39' // AC-INV-01479 (460, currently cancelled)
const MISTAKEN_INVOICE_ID = '7477058b-7261-46fc-8148-866eb4380f2d' // AC-INV-01641 (660, currently issued)
const MISTAKEN_LEDGER_ID  = 'aba2374f-d332-4fde-92cb-41a0330c956b' // debit 660 for AC-INV-01641
const REVERSAL_LEDGER_ID  = '54e5bf6e-2200-476b-a9e7-a14bf2c19e0c' // credit 460 reversal for AC-INV-01479
const MISTAKEN_SUB_ID    = 'bd9bdcff-f443-4dee-8623-0b36a7ee071a' // "Hassanmiya 660" row, active, start 2026-07-03
const CORRECT_PLAN_ID    = '9edc49bb-6b1a-43b9-a027-30a0e4de7fbf' // "Basic Lunch & Dinner" (460)
const today = '2026-09-11'

async function main() {
  // 0. Re-verify preconditions
  const { data: oldInv, error: oldErr } = await admin
    .from('invoices')
    .select('id, invoice_number, status, total_amount, customer_id')
    .eq('id', OLD_INVOICE_ID)
    .single()
  if (oldErr || !oldInv) throw new Error(`Old invoice lookup failed: ${oldErr?.message}`)
  if (oldInv.customer_id !== CUSTOMER_ID) throw new Error('Old invoice customer mismatch — aborting')
  if (oldInv.status !== 'cancelled') throw new Error(`Expected AC-INV-01479 status 'cancelled', got '${oldInv.status}' — aborting`)

  const { data: mistakenInv, error: mErr } = await admin
    .from('invoices')
    .select('id, invoice_number, status, total_amount, customer_id')
    .eq('id', MISTAKEN_INVOICE_ID)
    .single()
  if (mErr || !mistakenInv) throw new Error(`Mistaken invoice lookup failed: ${mErr?.message}`)
  if (mistakenInv.customer_id !== CUSTOMER_ID) throw new Error('Mistaken invoice customer mismatch — aborting')
  if (mistakenInv.status !== 'issued') throw new Error(`Expected AC-INV-01641 status 'issued', got '${mistakenInv.status}' — aborting`)

  const { data: appliedPayments } = await admin
    .from('payments')
    .select('id')
    .eq('invoice_id', MISTAKEN_INVOICE_ID)
    .is('voided_at', null)
  if (appliedPayments && appliedPayments.length > 0) {
    throw new Error(`AC-INV-01641 has ${appliedPayments.length} payment(s) applied — aborting, needs manual handling`)
  }

  console.log('Preconditions OK.')

  // 1. Cancel the mistaken 660 invoice
  const { error: cancelErr } = await admin
    .from('invoices')
    .update({
      status: 'cancelled',
      notes: `Corrected ${today}: reverted — the AED 660 subscription this was based on was a data-entry mistake (confirmed by owner). Restored AC-INV-01479 at the correct AED 460.`,
    })
    .eq('id', MISTAKEN_INVOICE_ID)
    .eq('status', 'issued')
  if (cancelErr) throw new Error(`Cancelling AC-INV-01641 failed: ${cancelErr.message}`)
  console.log('Cancelled AC-INV-01641 (660)')

  // 2. Restore AC-INV-01479 back to issued at 460
  const { error: restoreErr } = await admin
    .from('invoices')
    .update({
      status: 'issued',
      notes: `Restored ${today}: the AED 660 correction was reverted — owner confirmed AED 460 was correct all along and the 660 subscription entry was a mistake.`,
    })
    .eq('id', OLD_INVOICE_ID)
    .eq('status', 'cancelled')
  if (restoreErr) throw new Error(`Restoring AC-INV-01479 failed: ${restoreErr.message}`)
  console.log('Restored AC-INV-01479 (460) to issued')

  // 3a. Reverse the mistaken invoice's ledger debit
  const { error: rev1Err } = await admin.from('ledger_entries').insert({
    customer_id: CUSTOMER_ID,
    entry_date: today,
    entry_type: 'invoice',
    debit_amount: '0.00',
    credit_amount: '660.00',
    description: 'Reversal of Invoice AC-INV-01641 (voided — 660 was a data-entry mistake)',
    reference_table: 'invoices',
    reference_id: MISTAKEN_INVOICE_ID,
    reversal_of: MISTAKEN_LEDGER_ID,
    created_by: OWNER_ID,
  })
  if (rev1Err) console.error('WARNING: ledger reversal for AC-INV-01641 failed:', rev1Err.message)
  else console.log('Reversed ledger debit for AC-INV-01641')

  // 3b. Reverse the earlier reversal against AC-INV-01479 (restore its debit)
  const { error: rev2Err } = await admin.from('ledger_entries').insert({
    customer_id: CUSTOMER_ID,
    entry_date: today,
    entry_type: 'invoice',
    debit_amount: '460.00',
    credit_amount: '0.00',
    description: 'Reversal of reversal — AC-INV-01479 restored to issued at AED 460',
    reference_table: 'invoices',
    reference_id: OLD_INVOICE_ID,
    reversal_of: REVERSAL_LEDGER_ID,
    created_by: OWNER_ID,
  })
  if (rev2Err) console.error('WARNING: ledger restore for AC-INV-01479 failed:', rev2Err.message)
  else console.log('Restored ledger debit for AC-INV-01479')

  // 4. Fix the live subscription: point it back at the correct 460 plan so
  // next month's cron doesn't repeat the mistake. Re-verify it's still the
  // mistaken row before touching it.
  const { data: sub, error: subErr } = await admin
    .from('customer_subscriptions')
    .select('id, customer_id, agreed_monthly_price, fixed_plan_id, status')
    .eq('id', MISTAKEN_SUB_ID)
    .single()
  if (subErr || !sub) throw new Error(`Subscription lookup failed: ${subErr?.message}`)
  if (sub.customer_id !== CUSTOMER_ID) throw new Error('Subscription customer mismatch — aborting sub fix')
  if (parseFloat(String(sub.agreed_monthly_price)) !== 660) {
    console.log(`Subscription price is already ${sub.agreed_monthly_price}, not 660 — skipping subscription fix (may have been fixed already)`)
  } else {
    const { error: subFixErr } = await admin
      .from('customer_subscriptions')
      .update({
        fixed_plan_id: CORRECT_PLAN_ID,
        agreed_monthly_price: '460.00',
        meal_prices: null,
        notes: `Corrected ${today}: price/plan reverted from an AED 660 data-entry mistake back to the correct AED 460 "Basic Lunch & Dinner" plan.`,
      })
      .eq('id', MISTAKEN_SUB_ID)
    if (subFixErr) throw new Error(`Subscription fix failed: ${subFixErr.message}`)
    console.log('Fixed subscription: 660 -> 460, plan restored to "Basic Lunch & Dinner"')
  }

  console.log('\nDone. Summary:')
  console.log('  AC-INV-01641 (660): cancelled')
  console.log('  AC-INV-01479 (460): restored to issued')
  console.log('  Subscription bd9bdcff: corrected back to 460 / Basic Lunch & Dinner')
}

main().catch(e => { console.error('FAILED:', e.message); process.exit(1) })
