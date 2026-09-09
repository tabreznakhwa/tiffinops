// Read-only scan for potential duplicate customers, same idea as the SALMAN case:
// same mobile number, or same/near-identical full_name, across different customer rows.
const fs = require('fs')
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/)
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '')
}
const { createClient } = require('@supabase/supabase-js')
const a = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

function normName(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}
function normMobile(s) {
  return (s || '').replace(/[^0-9]/g, '').replace(/^0+/, '')
}

async function main() {
  const { data: customers, error } = await a.from('customers').select('id, customer_code, full_name, mobile_number, status, created_at')
  if (error) throw error
  console.log('total customers:', customers.length)

  // Group by normalized mobile number
  const byMobile = new Map()
  for (const c of customers) {
    const key = normMobile(c.mobile_number)
    if (!key) continue
    if (!byMobile.has(key)) byMobile.set(key, [])
    byMobile.get(key).push(c)
  }
  const mobileDupes = [...byMobile.entries()].filter(([, list]) => list.length > 1)

  console.log('\n=== Same mobile number, different customer rows ===')
  for (const [mobile, list] of mobileDupes) {
    console.log(`\nmobile ${mobile}:`)
    for (const c of list) console.log(`  ${c.customer_code}  ${c.full_name}  active=${c.status}  created=${c.created_at}`)
  }
  if (!mobileDupes.length) console.log('(none found)')

  // Group by normalized name (exact match after normalization)
  const byName = new Map()
  for (const c of customers) {
    const key = normName(c.full_name)
    if (!key) continue
    if (!byName.has(key)) byName.set(key, [])
    byName.get(key).push(c)
  }
  const nameDupes = [...byName.entries()].filter(([, list]) => list.length > 1)

  console.log('\n=== Same normalized full name, different customer rows ===')
  for (const [name, list] of nameDupes) {
    // skip ones already reported as mobile dupes to reduce noise
    console.log(`\nname "${name}":`)
    for (const c of list) console.log(`  ${c.customer_code}  ${c.full_name}  ${c.mobile_number}  active=${c.status}  created=${c.created_at}`)
  }
  if (!nameDupes.length) console.log('(none found)')

  // Fuzzy: names that share the first token (e.g. "SALMAN" vs "SALMAN 2797") but aren't exact matches
  console.log('\n=== Same first name-token, but not already listed above ===')
  const exactKeys = new Set(nameDupes.map(([k]) => k))
  const byFirstToken = new Map()
  for (const c of customers) {
    const norm = normName(c.full_name)
    const first = norm.split(' ')[0]
    if (!first) continue
    if (!byFirstToken.has(first)) byFirstToken.set(first, [])
    byFirstToken.get(first).push(c)
  }
  for (const [tok, list] of byFirstToken.entries()) {
    if (list.length < 2) continue
    const names = new Set(list.map(c => normName(c.full_name)))
    if (names.size < 2) continue // all exact-same name, already covered above
    console.log(`\nfirst token "${tok}":`)
    for (const c of list) console.log(`  ${c.customer_code}  ${c.full_name}  ${c.mobile_number}  active=${c.status}  created=${c.created_at}`)
  }
}
main().catch(e => { console.error(e); process.exit(1) })
