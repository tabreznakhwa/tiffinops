const fs = require('fs')
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/)
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '')
}
const { createClient } = require('@supabase/supabase-js')
const a = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
const money = n => Math.round((parseFloat(n || 0) + Number.EPSILON) * 100) / 100
const fmt = n => money(n).toFixed(2)

async function main() {
  const keeper = (await a.from('customers').select('*').eq('customer_code','AC-CUST-00148').single()).data
  const dupeGone = (await a.from('customers').select('id').eq('customer_code','AC-CUST-00020').maybeSingle()).data
  console.log('AC-CUST-00020 still exists?', !!dupeGone)

  const invs = (await a.from('invoices').select('id, invoice_number, status, total_amount').eq('customer_id', keeper.id)).data
  for (const inv of invs) {
    if (['draft','cancelled','written_off'].includes(inv.status)) continue
    const pays = (await a.from('payments').select('amount').eq('invoice_id', inv.id).is('voided_at', null)).data
    const paid = money(pays.reduce((s,p) => s + parseFloat(p.amount||0), 0))
    const total = money(inv.total_amount)
    const expected = paid >= total - 0.01 ? 'paid' : paid > 0 ? 'partial' : 'issued'
    console.log(`${inv.invoice_number}: status=${inv.status} paid=${fmt(paid)} total=${fmt(total)} expected=${expected} ${expected===inv.status?'OK':'MISMATCH'}`)
  }

  const subs = (await a.from('customer_subscriptions').select('id, status, start_date, end_date, fixed_plan_id').eq('customer_id', keeper.id)).data
  console.log('\nkeeper subscriptions:')
  console.table(subs)
}
main().catch(e => { console.error(e); process.exit(1) })
