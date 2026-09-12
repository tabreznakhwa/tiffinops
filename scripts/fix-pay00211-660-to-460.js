// WRITE script — user-confirmed correction. PAY-00211 (Hassan Miya, 7 Aug
// 2026, card, advance) was recorded at AED 660, but its own note says it was
// a combined collection: "Awwaf-200 / Hassan Miya-460 / Total -660 AED paid
// Aug". Awwaf's AED 200 share is already correctly recorded separately as
// PAY-00212 (linked to an invoice) — so PAY-00211 double-counts that 200.
// Correcting PAY-00211 down to AED 460 (Hassan Miya's real share) removes
// the double-count; Awwaf's PAY-00212 is untouched.
const fs = require('fs')
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/)
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '')
}
const { createClient } = require('@supabase/supabase-js')
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

const PAYMENT_ID  = 'a219f55d-7c6b-42ed-b66f-cd98655eb6df' // PAY-00211
const CUSTOMER_ID = '2d96885c-192f-4a29-81d6-1b2a9b8534a5' // Hassan Miya
const OWNER_ID    = 'a277b0b4-7869-4c7f-bab3-99b522d249f3' // tabrez nakhwa (owner)
const today = '2026-09-11'

async function main() {
  // 0. Re-verify preconditions
  const { data: pay, error: payErr } = await admin
    .from('payments')
    .select('id, payment_number, customer_id, amount, invoice_id, voided_at, notes')
    .eq('id', PAYMENT_ID)
    .single()
  if (payErr || !pay) throw new Error(`Payment lookup failed: ${payErr?.message}`)
  if (pay.payment_number !== 'PAY-00211') throw new Error(`Expected PAY-00211, got ${pay.payment_number} — aborting`)
  if (pay.customer_id !== CUSTOMER_ID) throw new Error('Customer mismatch — aborting')
  if (pay.voided_at) throw new Error('Payment already voided — aborting')
  if (parseFloat(String(pay.amount)) !== 660) throw new Error(`Expected amount 660, got ${pay.amount} — aborting`)
  if (pay.invoice_id) throw new Error('Payment is linked to an invoice — needs manual handling, aborting')

  const { data: ledger } = await admin
    .from('ledger_entries')
    .select('id, credit_amount')
    .eq('reference_table', 'payments')
    .eq('reference_id', PAYMENT_ID)
    .is('reversal_of', null)
  console.log('Preconditions OK. Payment:', pay)
  console.log('Original ledger entries for this payment:', ledger)

  // 1. Correct the payment amount
  const { error: updErr } = await admin
    .from('payments')
    .update({
      amount: '460.00',
      notes: `Corrected ${today}: reduced from AED 660 to AED 460 — the AED 200 Awwaf share (see original note) is already recorded separately as PAY-00212 and was being double-counted here. Original note: "${pay.notes}"`,
    })
    .eq('id', PAYMENT_ID)
    .eq('amount', '660.00')
  if (updErr) throw new Error(`Payment update failed: ${updErr.message}`)
  console.log('Updated PAY-00211: 660 -> 460')

  // 2. Ledger correction: reduce the credit by 200 (debit entry reversing
  // the double-counted portion), referencing the original credit entry.
  for (const entry of ledger ?? []) {
    const { error: ledgerErr } = await admin.from('ledger_entries').insert({
      customer_id: CUSTOMER_ID,
      entry_date: today,
      entry_type: 'payment',
      debit_amount: '200.00',
      credit_amount: '0.00',
      description: 'Correction: PAY-00211 reduced 660 -> 460 (AED 200 Awwaf share was double-counted; already recorded as PAY-00212)',
      reference_table: 'payments',
      reference_id: PAYMENT_ID,
      reversal_of: entry.id,
      created_by: OWNER_ID,
    })
    if (ledgerErr) console.error('WARNING: ledger correction insert failed:', ledgerErr.message)
    else console.log('Inserted ledger correction (debit 200) for PAY-00211')
  }

  console.log('\nDone. PAY-00211 corrected: AED 660 -> AED 460')
}

main().catch(e => { console.error('FAILED:', e.message); process.exit(1) })
