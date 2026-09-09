// Lakhbir Singh (AC-CUST-00063) asked for a "full month" invoice, 1 Aug - 31 Aug 2026.
// His real billing cycle is 26th-25th and 1-25 Aug is already on AC-INV-01411 (issued).
// Owner chose "custom statement, calendar Aug" — a customer-facing document only:
// NOT inserted into the invoices table, does not touch the ledger/Outstanding, does not
// change his billing cycle. Styled to match app/print/invoice/[id]/page.tsx (TAX INVOICE).
const fs = require('fs')
const path = require('path')
const os = require('os')
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/)
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '')
}
const { createClient } = require('@supabase/supabase-js')
const a = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

const CID = '5f4fe0b8-073b-4444-97e9-dbfe578ca4b1'
const P_START = '2026-08-01'
const P_END = '2026-08-31'
const STMT_NO = 'STMT-AUG2026-00063'
const OUT = path.join(os.homedir(), 'Downloads', 'Lakhbir Singh - August 2026 Statement.html')

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const fmtLongDate = d => new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })

async function main() {
  const { data: st } = await a.from('app_settings').select('*').eq('id', 1).single()
  const { data: c } = await a.from('customers').select('full_name, customer_code, mobile_number, area, email, delivery_address').eq('id', CID).single()
  const { data: orders } = await a.from('orders')
    .select('id, order_date, meal_period, total_amount')
    .eq('customer_id', CID).gte('order_date', P_START).lte('order_date', P_END)
    .not('order_status', 'in', '(cancelled,voided,draft)').order('order_date')
  const orderIds = orders.map(o => o.id)
  const { data: ois } = await a.from('order_items').select('order_id, item_name_snapshot, quantity, unit_price, total_price').in('order_id', orderIds)
  const oiByOrder = new Map()
  for (const oi of ois) (oiByOrder.get(oi.order_id) ?? oiByOrder.set(oi.order_id, []).get(oi.order_id)).push(oi)

  const MEAL_ORDER = { breakfast: 0, lunch: 1, dinner: 2 }
  const lineItems = []
  for (const o of orders.slice().sort((x, y) => x.order_date.localeCompare(y.order_date) || (MEAL_ORDER[x.meal_period] ?? 9) - (MEAL_ORDER[y.meal_period] ?? 9))) {
    for (const oi of oiByOrder.get(o.id) ?? []) {
      lineItems.push({ desc: `${o.order_date} · ${o.meal_period} · ${oi.item_name_snapshot}`, qty: parseFloat(oi.quantity), unit: parseFloat(oi.unit_price), total: parseFloat(oi.total_price) })
    }
  }
  const total = lineItems.reduce((s, li) => s + li.total, 0)
  const vatRate = parseFloat(st.vat_percent)
  const vatAmount = total - total / (1 + vatRate / 100)
  const exclVAT = total - vatAmount

  const rows = lineItems.map(li => `<div class="row">
    <span class="desc">${esc(li.desc)}</span>
    <span class="num">${Number.isInteger(li.qty) ? li.qty : li.qty.toFixed(2)}</span>
    <span class="num mut">${li.unit.toFixed(2)}</span>
    <span class="num bold">${li.total.toFixed(2)}</span>
  </div>`).join('\n')

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Statement</title><style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Segoe UI',Arial,sans-serif;color:#221A13;font-size:13px;line-height:1.5;padding:24px 28px;max-width:760px;margin:0 auto}
  .head{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;padding-bottom:16px;border-bottom:3px solid #221A13}
  h1{font-size:22px;font-weight:800;margin:0 0 2px;letter-spacing:-.01em}
  .sub{font-size:11px;color:#7C7063}
  .lbl{font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#7C7063;margin:0 0 2px}
  .num-box{font-size:15px;font-weight:800;margin:0 0 8px}
  .meta{display:grid;grid-template-columns:70px 1fr;column-gap:8px;row-gap:3px;font-size:11px;text-align:left}
  .meta span:nth-child(odd){color:#7C7063;font-weight:600}
  .meta span:nth-child(even){font-weight:700}
  .billto{margin-bottom:24px;padding:12px 16px;background:#FBF6EE;border-radius:10px;border:1px solid #ECE2D3}
  .billto-lbl{font-size:10px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#7C7063;margin:0 0 4px}
  .billto-name{font-size:18px;font-weight:800;margin:0 0 2px}
  .billto-sub{font-size:11px;color:#7C7063}
  .thead{display:grid;grid-template-columns:1fr 60px 90px 90px;gap:8px;padding:6px 0;border-bottom:2px solid #221A13;font-weight:700;font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:#7C7063}
  .row{display:grid;grid-template-columns:1fr 60px 90px 90px;gap:8px;padding:5px 0;border-bottom:1px solid #ECE2D3;align-items:center;font-size:12px}
  .num{text-align:right}
  .mut{color:#7C7063}
  .bold{font-weight:700}
  .totals{margin-top:16px;display:flex;justify-content:flex-end}
  .totals-box{width:280px}
  .divider{border-top:1px solid #ECE2D3;margin:6px 0}
  .divider-thick{border-top:2px solid #221A13;margin:10px 0}
  .trow{display:flex;justify-content:space-between;padding:3px 0;font-size:12px}
  .trow .l{color:#7C7063}
  .trow .r{font-weight:600}
  .grand{display:flex;justify-content:space-between;padding:4px 0}
  .grand .l{font-size:15px;font-weight:800}
  .grand .r{font-size:16px;font-weight:800}
  .note{margin-top:20px;padding:10px 14px;border-radius:8px;background:#FFF8F0;border:1px solid #ECE2D3;font-size:11.5px;color:#221A13}
  .foot{margin-top:24px;text-align:center;font-size:10px;color:#7C7063;padding-top:12px;border-top:1px solid #ECE2D3}
  </style></head><body>
  <div class="head">
    <div>
      <h1>CUSTOMER STATEMENT</h1>
      <div class="sub">Full Calendar Month · August 2026</div>
    </div>
    <div style="text-align:right">
      <p class="lbl">Statement #</p>
      <p class="num-box">${STMT_NO}</p>
      <div class="meta">
        <span>Period</span><span>1 – 31 August 2026</span>
        <span>Printed</span><span class="mut">${fmtLongDate('2026-09-04')}</span>
      </div>
    </div>
  </div>
  <div class="billto">
    <p class="billto-lbl">Bill To</p>
    <p class="billto-name">${esc(c.full_name.trim())}</p>
    <p class="billto-sub">${esc(c.customer_code)}${c.mobile_number ? ' · ' + esc(c.mobile_number) : ''}${c.area ? ' · ' + esc(c.area) : ''}</p>
  </div>
  <div class="thead"><span>Description</span><span class="num">Qty</span><span class="num">Unit Price (${st.currency})</span><span class="num">Total (${st.currency})</span></div>
  ${rows}
  <div class="totals"><div class="totals-box">
    <div class="divider"></div>
    <div class="trow"><span class="l">Subtotal (excl. VAT)</span><span class="r">${st.currency} ${exclVAT.toFixed(2)}</span></div>
    <div class="trow"><span class="l">VAT ${vatRate}% (included in prices)</span><span class="r mut">${st.currency} ${vatAmount.toFixed(2)}</span></div>
    <div class="divider-thick"></div>
    <div class="grand"><span class="l">TOTAL (VAT INCLUSIVE)</span><span class="r">${st.currency} ${total.toFixed(2)}</span></div>
    <div class="divider-thick"></div>
  </div></div>
  <div class="note">This is a customer-copy statement of all orders for the full calendar month of August 2026, issued at the customer's request. It is not a separate bill — charges for 1–25 Aug are already included in invoice AC-INV-01411 (billing cycle 26 Jul – 25 Aug); charges for 26–31 Aug will appear on the next regular cycle invoice.</div>
  <div class="foot">${esc(st.business_name)} · ${esc(st.country)} · Thank you for your business</div>
  </body></html>`

  fs.writeFileSync(OUT, html)
  console.log(`${lineItems.length} line items across ${orders.length} orders, total ${st.currency} ${total.toFixed(2)} -> ${OUT}`)
}

main().catch(e => { console.error(e); process.exit(1) })
