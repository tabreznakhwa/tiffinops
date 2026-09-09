// AC-INV-01124's status was left stale at 'paid' from before the SALMAN merge
// (finish-salman-merge.js / merge-salman-2797.js absorbed AC-INV-01063,
// AED 174.25, into this invoice, growing its total from 0.00 -> 174.25, but
// neither script reconciled its status afterward). It has 0 linked payments,
// so it should be 'issued', not 'paid'.
//
// DRY RUN BY DEFAULT — writes nothing.
//   node scripts/fix-inv01124-status.js
//   node scripts/fix-inv01124-status.js --confirm
const fs = require('fs')
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/)
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '')
}
const { createClient } = require('@supabase/supabase-js')
const a = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
const CONFIRM = process.argv.includes('--confirm')

async function main() {
  const inv = (await a.from('invoices').select('*').eq('invoice_number', 'AC-INV-01124').single()).data
  const pays = (await a.from('payments').select('id, amount').eq('invoice_id', inv.id).is('voided_at', null)).data
  const paidSum = (pays || []).reduce((s, p) => s + parseFloat(p.amount || 0), 0)
  console.log('AC-INV-01124 current: status =', inv.status, ', total =', inv.total_amount, ', linked payments =', pays.length, '(sum', paidSum.toFixed(2) + ')')

  if (inv.status !== 'paid') {
    console.log('status is not "paid" — nothing to do')
    return
  }
  if (paidSum > 0) {
    console.log('found linked payments covering the total — status looks correct, not touching it')
    return
  }
  console.log(CONFIRM ? 'UPDATING status: paid -> issued' : 'DRY RUN — would update status: paid -> issued')
  if (CONFIRM) {
    const { data, error } = await a.from('invoices').update({ status: 'issued' }).eq('id', inv.id).eq('status', 'paid').select('invoice_number, status, total_amount')
    if (error) throw error
    console.log('after:', data)
  } else {
    console.log('\nDry run only — re-run with --confirm to apply.')
  }
}
main().catch(e => { console.error(e); process.exit(1) })
