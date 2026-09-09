// One-page statement (HTML) for the Aug cycle: customer name + invoice amount,
// for the accountant. Written to ~/Downloads, then converted to PDF via Edge.
const fs = require('fs')
const path = require('path')
const os = require('os')
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/)
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '')
}
const { createClient } = require('@supabase/supabase-js')
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

const P_START = '2026-07-26'
const P_END = '2026-08-25'
const OUT = path.join(os.homedir(), 'Downloads', 'Statement - August 2026.html')

const PAGE = 1000
async function fetchAll(build) {
  const out = []; let o = 0
  while (true) { const { data, error } = await build(o, o + PAGE - 1); if (error) throw error; out.push(...(data ?? [])); if ((data ?? []).length < PAGE) break; o += PAGE }
  return out
}
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

async function main() {
  const { data: st } = await admin.from('app_settings').select('business_name, contact_phone, contact_email').eq('id', 1).single()
  const invoices = await fetchAll((f, t) => admin.from('invoices')
    .select('invoice_number, total_amount, customers(full_name, customer_code)')
    .eq('billing_period_start', P_START).eq('billing_period_end', P_END).in('status', ['issued', 'partial', 'paid', 'overdue'])
    .range(f, t))
  invoices.sort((a, b) => (a.customers?.full_name || '').trim().localeCompare((b.customers?.full_name || '').trim()))
  const total = invoices.reduce((s, i) => s + parseFloat(i.total_amount), 0)

  const rows = invoices.map((i, idx) => `<tr>
    <td class="c">${idx + 1}</td>
    <td>${esc((i.customers?.full_name || '').trim())}</td>
    <td class="mut">${esc(i.customers?.customer_code)}</td>
    <td class="mut">${esc(i.invoice_number)}</td>
    <td class="r">${parseFloat(i.total_amount).toFixed(2)}</td>
  </tr>`).join('\n')

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Statement — August 2026</title><style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Segoe UI',Arial,sans-serif;color:#1a1a1a;font-size:12px;padding:24px 28px}
  .head{border-bottom:3px solid #b45309;padding-bottom:10px;margin-bottom:14px;display:flex;justify-content:space-between;align-items:flex-end}
  .biz{font-size:20px;font-weight:700;color:#b45309}
  .sub{color:#555;font-size:11px;margin-top:2px}
  h2{font-size:14px;text-align:right}
  .meta{color:#555;font-size:11px;text-align:right}
  table{width:100%;border-collapse:collapse}
  th{background:#b45309;color:#fff;text-align:left;padding:5px 8px;font-size:11px}
  th.r{text-align:right}
  td{padding:3px 8px;border-bottom:1px solid #eee}
  tr:nth-child(even) td{background:#fafafa}
  td.r{text-align:right;font-variant-numeric:tabular-nums}
  td.c{text-align:center;color:#999;width:30px}
  td.mut{color:#777}
  .total td{border-top:2px solid #b45309;font-weight:700;font-size:14px;background:#faf5ee}
  thead{display:table-header-group}
  </style></head><body>
  <div class="head">
    <div><div class="biz">${esc(st.business_name)}</div>
    <div class="sub">${esc(st.contact_phone)} · ${esc(st.contact_email)}</div></div>
    <div><h2>Invoice Statement — August 2026</h2>
    <div class="meta">Billing period 26 Jul – 25 Aug 2026 · ${invoices.length} customers</div></div>
  </div>
  <table>
  <thead><tr><th></th><th>Customer</th><th>Code</th><th>Invoice No</th><th class="r">Invoice Amount (AED)</th></tr></thead>
  <tbody>
  ${rows}
  <tr class="total"><td></td><td>TOTAL</td><td></td><td>${invoices.length} invoices</td><td class="r">${total.toFixed(2)}</td></tr>
  </tbody></table>
  </body></html>`

  fs.writeFileSync(OUT, html)
  console.log(`Wrote ${invoices.length} customers, total AED ${total.toFixed(2)} → ${OUT}`)
}

main().catch(e => { console.error(e); process.exit(1) })
