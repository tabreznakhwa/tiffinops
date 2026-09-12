// WRITE script — user-confirmed correction (2026-09-12). Tabrez gave the true
// payment history for Hassan Miya directly: AED 460 paid 3 Jul, AED 460 paid
// 3 Aug — two payments, nothing else — and said the AED 49 entry (PAY-00115,
// 17 Jul) is a wrong entry to remove, leaving September's AED 460 pending.
//
// Current records before this fix:
//   PAY-00093  AED 600   2026-07-03   (should be 460 — the 3 Jul payment)
//   PAY-00115  AED  49   2026-07-17   (wrong entry — to be voided/removed)
//   PAY-00211  AED 460   2026-08-07   (already correct — the 3 Aug payment;
//                                      already fixed once this session for an
//                                      unrelated double-count, untouched here)
//
// After this fix: 460 (Jul) + 460 (Aug) = 920 total paid, matching Tabrez's
// numbers exactly, so September (3rd anniversary) correctly shows pending.
//
// PAY-00115 is voided (not hard-deleted) via the same voided_at/voided_by/
// void_reason mechanism lib/payments/actions.ts's voidPayment() uses, so the
// audit trail is preserved and deletePayment()'s "voided payments cannot be
// deleted" rule is respected.
const fs = require('fs')
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/)
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '')
}
const { createClient } = require('@supabase/supabase-js')
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

const CUSTOMER_ID = '2d96885c-192f-4a29-81d6-1b2a9b8534a5' // Hassan Miya
const OWNER_ID    = 'a277b0b4-7869-4c7f-bab3-99b522d249f3' // tabrez nakhwa (owner)
const JUL_PAYMENT_ID = '9b2b27db-0cd2-493c-b83f-803998eb254d' // PAY-00093
const WRONG_PAYMENT_ID = 'c2aa1fe9-78ac-4ecd-82c5-9d7cd761582f' // PAY-00115
const today = '2026-09-12'

async function main() {
  // 0. Re-verify preconditions
  const { data: julPay, error: julErr } = await admin
    .from('payments')
    .select('id, payment_number, customer_id, amount, invoice_id, voided_at, notes')
    .eq('id', JUL_PAYMENT_ID)
    .single()
  if (julErr || !julPay) throw new Error(`July payment lookup failed: ${julErr?.message}`)
  if (julPay.payment_number !== 'PAY-00093') throw new Error(`Expected PAY-00093, got ${julPay.payment_number} — aborting`)
  if (julPay.customer_id !== CUSTOMER_ID) throw new Error('Customer mismatch (PAY-00093) — aborting')
  if (julPay.voided_at) throw new Error('PAY-00093 already voided — aborting')
  if (parseFloat(String(julPay.amount)) !== 600) throw new Error(`Expected PAY-00093 amount 600, got ${julPay.amount} — aborting`)
  if (julPay.invoice_id) throw new Error('PAY-00093 is linked to an invoice — needs manual handling, aborting')

  const { data: wrongPay, error: wrongErr } = await admin
    .from('payments')
    .select('id, payment_number, customer_id, amount, invoice_id, voided_at, notes')
    .eq('id', WRONG_PAYMENT_ID)
    .single()
  if (wrongErr || !wrongPay) throw new Error(`Wrong-entry payment lookup failed: ${wrongErr?.message}`)
  if (wrongPay.payment_number !== 'PAY-00115') throw new Error(`Expected PAY-00115, got ${wrongPay.payment_number} — aborting`)
  if (wrongPay.customer_id !== CUSTOMER_ID) throw new Error('Customer mismatch (PAY-00115) — aborting')
  if (wrongPay.voided_at) throw new Error('PAY-00115 already voided — aborting')
  if (parseFloat(String(wrongPay.amount)) !== 49) throw new Error(`Expected PAY-00115 amount 49, got ${wrongPay.amount} — aborting`)
  if (wrongPay.invoice_id) throw new Error('PAY-00115 is linked to an invoice — needs manual handling, aborting')

  console.log('Preconditions OK.')
  console.log('  PAY-00093:', julPay)
  console.log('  PAY-00115:', wrongPay)

  // 1. Correct PAY-00093: 600 -> 460 (the real 3 Jul payment)
  const { error: julUpdErr } = await admin
    .from('payments')
    .update({
      amount: '460.00',
      notes: `Corrected ${today}: reduced from AED 600 to AED 460 — owner confirmed the actual 3 Jul payment was AED 460. Original note: "${julPay.notes ?? ''}"`,
    })
    .eq('id', JUL_PAYMENT_ID)
    .eq('amount', '600.00')
  if (julUpdErr) throw new Error(`PAY-00093 update failed: ${julUpdErr.message}`)
  console.log('Updated PAY-00093: 600 -> 460')

  // 2. Void PAY-00115 entirely — owner confirmed it's a wrong entry
  const { error: voidErr } = await admin
    .from('payments')
    .update({
      voided_at: new Date().toISOString(),
      voided_by: OWNER_ID,
      void_reason: `Owner confirmed ${today}: incorrect entry — actual payment history is AED 460 on 3 Jul and AED 460 on 3 Aug only, nothing else.`,
    })
    .eq('id', WRONG_PAYMENT_ID)
    .is('voided_at', null)
  if (voidErr) throw new Error(`PAY-00115 void failed: ${voidErr.message}`)
  console.log('Voided PAY-00115 (AED 49)')

  // 3. Ledger corrections (audit trail only — not read by any dashboard)
  const { data: julLedger } = await admin
    .from('ledger_entries')
    .select('id, credit_amount')
    .eq('reference_table', 'payments')
    .eq('reference_id', JUL_PAYMENT_ID)
    .is('reversal_of', null)
  for (const entry of julLedger ?? []) {
    const { error: ledgerErr } = await admin.from('ledger_entries').insert({
      customer_id: CUSTOMER_ID,
      entry_date: today,
      entry_type: 'payment',
      debit_amount: '140.00',
      credit_amount: '0.00',
      description: 'Correction: PAY-00093 reduced 600 -> 460 (owner-confirmed actual 3 Jul payment)',
      reference_table: 'payments',
      reference_id: JUL_PAYMENT_ID,
      reversal_of: entry.id,
      created_by: OWNER_ID,
    })
    if (ledgerErr) console.error('WARNING: ledger correction insert failed (PAY-00093):', ledgerErr.message)
    else console.log('Inserted ledger correction (debit 140) for PAY-00093')
  }

  const { data: wrongLedger } = await admin
    .from('ledger_entries')
    .select('id, credit_amount')
    .eq('reference_table', 'payments')
    .eq('reference_id', WRONG_PAYMENT_ID)
    .is('reversal_of', null)
  for (const entry of wrongLedger ?? []) {
    const { error: ledgerErr } = await admin.from('ledger_entries').insert({
      customer_id: CUSTOMER_ID,
      entry_date: today,
      entry_type: 'payment',
      debit_amount: '49.00',
      credit_amount: '0.00',
      description: 'Voided: PAY-00115 was an incorrect entry (owner-confirmed actual history is 460 on 3 Jul + 460 on 3 Aug only)',
      reference_table: 'payments',
      reference_id: WRONG_PAYMENT_ID,
      reversal_of: entry.id,
      created_by: OWNER_ID,
    })
    if (ledgerErr) console.error('WARNING: ledger correction insert failed (PAY-00115):', ledgerErr.message)
    else console.log('Inserted ledger correction (debit 49) for PAY-00115')
  }

  console.log('\nDone. Hassan Miya payments corrected:')
  console.log('  PAY-00093: AED 600 -> AED 460 (3 Jul)')
  console.log('  PAY-00115: voided (AED 49, wrong entry)')
  console.log('  PAY-00211: unchanged at AED 460 (3 Aug, from an earlier correction)')
  console.log('  Total paid: AED 920')
}

main().catch(e => { console.error('FAILED:', e.message); process.exit(1) })
