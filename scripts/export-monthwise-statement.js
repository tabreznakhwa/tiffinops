// Month-wise statement for Mai Dubai customers (blank area counts as Mai Dubai,
// per owner): one row per customer, one column per billing month, cell = summed
// billed invoice amount (issued/partial/paid/overdue; drafts & cancelled excluded).
// Sorted by total desc so the highest billers (AKBAR etc.) are on top.
// Landscape A4 HTML → ~/Downloads, then converted to PDF via Edge (foreground).
// READ-ONLY on the DB.
const fs = require('fs')
const path = require('path')
const os = require('os')
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/)
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '')
}
const { createClient } = require('@supabase/supabase-js')
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

const OUT = path.join(os.homedir(), 'Downloads', 'Statement Month-wise - Mai Dubai.html')
const BILLED = ['issued', 'partial', 'paid', 'overdue']

const PAGE = 1000
async function fetchAll(build) {
  const out = []; let o = 0
  while (true) { const { data, error } = await build(o, o + PAGE - 1); if (error) throw error; out.push(...(data ?? [])); if ((data ?? []).length < PAGE) break; o += PAGE }
  return out
}
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

// Bucket an invoice into a month label: cycle 26 Jul → 25 Aug counts as "August"
// (the month the cycle ends in), same convention as the Aug statement. Fixed
// monthly 1–31 Aug also lands in August. Null period → invoice_date month.
function monthKey(inv) {
  const d = inv.billing_period_end || inv.invoice_date
  const [y, m] = d.split('-').map(Number)
  return `${y}-${String(m).padStart(2, '0')}`
}
const monthLabel = key => { const [y, m] = key.split('-').map(Number); return `${MONTHS[m - 1].slice(0, 3)} ${y}` }

async function main() {
  const { data: st } = await admin.from('app_settings').select('business_name, contact_phone, contact_email').eq('id', 1).single()
  const customers = await fetchAll((f, t) => admin.from('customers').select('id, full_name, customer_code, area').range(f, t))
  const custById = Object.fromEntries(customers.map(c => [c.id, c]))
  const inArea = c => !c.area || c.area === 'Mai Dubai'

  const invoices = await fetchAll((f, t) => admin.from('invoices')
    .select('customer_id, invoice_date, billing_period_start, billing_period_end, total_amount, status')
    .in('status', BILLED).range(f, t))

  const rowsByCust = {}   // cust_id -> { [monthKey]: amount }
  const monthSet = new Set()
  for (const inv of invoices) {
    const c = custById[inv.customer_id]
    if (!c || !inArea(c)) continue
    const k = monthKey(inv)
    monthSet.add(k)
    const r = rowsByCust[inv.customer_id] || (rowsByCust[inv.customer_id] = {})
    r[k] = (r[k] || 0) + parseFloat(inv.total_amount)
  }
  const months = [...monthSet].sort()

  const custRows = Object.entries(rowsByCust).map(([cid, byMonth]) => {
    const c = custById[cid]
    const total = months.reduce((s, k) => s + (byMonth[k] || 0), 0)
    return { name: (c.full_name || '').trim(), code: c.customer_code, byMonth, total }
  }).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))

  const colTotals = Object.fromEntries(months.map(k => [k, custRows.reduce((s, r) => s + (r.byMonth[k] || 0), 0)]))
  const grand = custRows.reduce((s, r) => s + r.total, 0)

  const cell = v => v ? v.toFixed(2) : '<span class="dash">–</span>'
  const trs = custRows.map((r, i) => `<tr>
    <td class="c">${i + 1}</td>
    <td>${esc(r.name)}</td>
    <td class="mut">${esc(r.code)}</td>
    ${months.map(k => `<td class="r">${cell(r.byMonth[k])}</td>`).join('')}
    <td class="r tot">${r.total.toFixed(2)}</td>
  </tr>`).join('\n')

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Month-wise Statement — Mai Dubai</title><style>
  @page{size:A4 landscape;margin:10mm 8mm}
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Segoe UI',Arial,sans-serif;color:#1a1a1a;font-size:10.5px;padding:16px 18px}
  .head{border-bottom:3px solid #b45309;padding-bottom:8px;margin-bottom:10px;display:flex;justify-content:space-between;align-items:flex-end}
  .biz{font-size:18px;font-weight:700;color:#b45309}
  .sub{color:#555;font-size:10px;margin-top:2px}
  h2{font-size:13px;text-align:right}
  .meta{color:#555;font-size:10px;text-align:right}
  table{width:100%;border-collapse:collapse}
  th{background:#b45309;color:#fff;text-align:left;padding:4px 6px;font-size:10px;white-space:nowrap}
  th.r{text-align:right}
  td{padding:2.5px 6px;border-bottom:1px solid #eee;white-space:nowrap}
  tr:nth-child(even) td{background:#fafafa}
  td.r{text-align:right;font-variant-numeric:tabular-nums}
  td.c{text-align:center;color:#999;width:24px}
  td.mut{color:#777}
  td.tot{font-weight:700;background:#faf5ee!important}
  .dash{color:#ccc}
  .total td{border-top:2px solid #b45309;font-weight:700;font-size:12px;background:#faf5ee!important}
  thead{display:table-header-group}
  </style></head><body>
  <div class="head">
    <div><div class="biz">${esc(st.business_name)}</div>
    <div class="sub">${esc(st.contact_phone)} · ${esc(st.contact_email)}</div></div>
    <div><h2>Month-wise Statement — Mai Dubai customers</h2>
    <div class="meta">All billed invoices (each cycle shown under the month it ends in) · ${custRows.length} customers · amounts in AED</div></div>
  </div>
  <table>
  <thead><tr><th></th><th>Customer</th><th>Code</th>${months.map(k => `<th class="r">${monthLabel(k)}</th>`).join('')}<th class="r">Total</th></tr></thead>
  <tbody>
  ${trs}
  <tr class="total"><td></td><td>TOTAL</td><td>${custRows.length} customers</td>${months.map(k => `<td class="r">${colTotals[k].toFixed(2)}</td>`).join('')}<td class="r">${grand.toFixed(2)}</td></tr>
  </tbody></table>
  </body></html>`

  fs.writeFileSync(OUT, html)
  console.log(`Months: ${months.map(monthLabel).join(', ')}`)
  console.log(`Wrote ${custRows.length} customers, grand total AED ${grand.toFixed(2)} → ${OUT}`)
  console.log('Top 5: ' + custRows.slice(0, 5).map(r => `${r.name} ${r.total.toFixed(2)}`).join(' | '))
}

main().catch(e => { console.error(e); process.exit(1) })
