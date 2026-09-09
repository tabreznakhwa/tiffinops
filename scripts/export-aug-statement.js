// Accountant statement for the Aug cycle (26 Jul → 25 Aug): one row per
// customer with their issued invoice amount, saved to ~/Downloads as .xlsx.
// READ-ONLY on the DB.
const fs = require('fs')
const path = require('path')
const os = require('os')
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/)
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '')
}
const { createClient } = require('@supabase/supabase-js')
const XLSX = require('xlsx')
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

const P_START = '2026-07-26'
const P_END = '2026-08-25'
const OUT = path.join(os.homedir(), 'Downloads', 'Statement - August 2026.xlsx')

const PAGE = 1000
async function fetchAll(build) {
  const out = []; let o = 0
  while (true) { const { data, error } = await build(o, o + PAGE - 1); if (error) throw error; out.push(...(data ?? [])); if ((data ?? []).length < PAGE) break; o += PAGE }
  return out
}

async function main() {
  const invoices = await fetchAll((f, t) => admin.from('invoices')
    .select('invoice_number, invoice_date, total_amount, status, customers(full_name, customer_code, area, mobile_number)')
    .eq('billing_period_start', P_START).eq('billing_period_end', P_END).eq('status', 'issued')
    .range(f, t))

  invoices.sort((a, b) => parseFloat(b.total_amount) - parseFloat(a.total_amount))

  const rows = invoices.map((i, idx) => ({
    '#': idx + 1,
    'Customer': (i.customers?.full_name || '').trim(),
    'Code': i.customers?.customer_code || '',
    'Area': i.customers?.area || '',
    'Mobile': i.customers?.mobile_number || '',
    'Invoice No': i.invoice_number,
    'Invoice Date': i.invoice_date,
    'Billing Period': '26 Jul – 25 Aug 2026',
    'Invoice Amount (AED)': parseFloat(i.total_amount),
  }))
  const total = rows.reduce((s, r) => s + r['Invoice Amount (AED)'], 0)
  rows.push({ '#': '', 'Customer': 'TOTAL', 'Code': '', 'Area': '', 'Mobile': '', 'Invoice No': `${rows.length} invoices`, 'Invoice Date': '', 'Billing Period': '', 'Invoice Amount (AED)': +total.toFixed(2) })

  const ws = XLSX.utils.json_to_sheet(rows)
  ws['!cols'] = [{ wch: 4 }, { wch: 28 }, { wch: 16 }, { wch: 14 }, { wch: 16 }, { wch: 15 }, { wch: 12 }, { wch: 22 }, { wch: 20 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'August 2026')
  XLSX.writeFile(wb, OUT)
  console.log(`Wrote ${rows.length - 1} customers, total AED ${total.toFixed(2)} → ${OUT}`)
}

main().catch(e => { console.error(e); process.exit(1) })
