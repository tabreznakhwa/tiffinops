// WRITE script — user-approved recovery for the 26 Aug–25 Sep 2026 Mai Dubai
// cycle. 15 of 51 active fixed_menu customers got invoiced by the 26 Sep
// cron before it apparently timed out (no maxDuration set on the route,
// and no errors were logged — the run just stopped mid-loop). This calls
// the REAL production generator functions directly (same code the
// "Generate — Mai Dubai Only" button and the cron use) — both are
// idempotent, so the 15 already-invoiced customers are skipped automatically
// and only the missing ones get billed. Scoped to onlyArea: 'Mai Dubai' so
// it stays fast and doesn't touch any other area.
import fs from 'fs'
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/)
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '')
}
import { createClient } from '@supabase/supabase-js'
import { generateMonthlyInvoices } from '../lib/invoices/generateMonthlyInvoices'
import { generateAlaCarteInvoices } from '../lib/invoices/generateAlaCarteInvoices'

const MONTH = '2026-09'

async function main() {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } })
  const { data: owner, error } = await admin.from('users').select('id, full_name').eq('role', 'owner').limit(1).single()
  if (error || !owner) throw new Error(`Could not find owner user: ${error?.message}`)
  console.log(`Running as: ${owner.full_name} (${owner.id})`)

  console.log(`\n--- generateMonthlyInvoices('${MONTH}', onlyArea: 'Mai Dubai') ---`)
  const monthly = await generateMonthlyInvoices(MONTH, owner.id, { onlyArea: 'Mai Dubai' })
  console.log(monthly)

  console.log(`\n--- generateAlaCarteInvoices('${MONTH}', onlyArea: 'Mai Dubai') ---`)
  const alaCarte = await generateAlaCarteInvoices(MONTH, owner.id, { onlyArea: 'Mai Dubai' })
  console.log(alaCarte)
}

main().catch(e => { console.error('FAILED:', e); process.exit(1) })
