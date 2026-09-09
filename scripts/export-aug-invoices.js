// Export all ISSUED invoices of the 26 Jul → 25 Aug cycle as printable HTML
// bills into ~/Downloads/Invoices - August 2026/, one file per customer
// ("CUSTOMER NAME (CODE) - August 2026.html") + one combined file with page
// breaks for bulk printing. READ-ONLY on the DB.
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
const MONTH_LABEL = 'August 2026'
const OUT_DIR = path.join(os.homedir(), 'Downloads', `Invoices - ${MONTH_LABEL}`)

const PAGE = 1000
async function fetchAll(build) {
  const out = []; let o = 0
  while (true) { const { data, error } = await build(o, o + PAGE - 1); if (error) throw error; out.push(...(data ?? [])); if ((data ?? []).length < PAGE) break; o += PAGE }
  return out
}
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const money = v => parseFloat(v).toFixed(2)
const safeName = s => String(s).trim().replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ')

async function main() {
  const { data: st } = await admin.from('app_settings').select('*').eq('id', 1).single()
  const SELECT = 'id, invoice_number, invoice_date, billing_period_start, billing_period_end, subtotal, discount_amount, tax_amount, total_amount, notes, customers(full_name, customer_code, area, mobile_number)'
  const invoices = await fetchAll((f, t) => admin.from('invoices')
    .select(SELECT)
    .eq('billing_period_start', P_START).eq('billing_period_end', P_END).eq('status', 'issued')
    .order('invoice_number').range(f, t))
  // AC-INV-01461 (Naeem 3111): app edit on 29 Aug cleared its billing period —
  // still an Aug-cycle bill, include explicitly if the period is still null.
  if (!invoices.some(i => i.invoice_number === 'AC-INV-01461')) {
    const { data: extra } = await admin.from('invoices').select(SELECT).eq('invoice_number', 'AC-INV-01461').eq('status', 'issued').single()
    if (extra) { extra.billing_period_start = P_START; extra.billing_period_end = P_END; invoices.push(extra) }
  }
  invoices.sort((a, b) => a.invoice_number.localeCompare(b.invoice_number))

  const items = []
  const ids = invoices.map(i => i.id)
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = await fetchAll((f, t) => admin.from('invoice_items')
      .select('invoice_id, description, quantity, unit_price, total_price')
      .in('invoice_id', ids.slice(i, i + 100)).order('description').range(f, t))
    items.push(...chunk)
  }
  const itemsByInv = {}
  for (const it of items) (itemsByInv[it.invoice_id] = itemsByInv[it.invoice_id] || []).push(it)

  fs.mkdirSync(OUT_DIR, { recursive: true })

  const style = `<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Segoe UI',Arial,sans-serif;color:#1a1a1a;font-size:13px}
  .bill{max-width:760px;margin:0 auto;padding:28px 32px;page-break-after:always}
  .head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #b45309;padding-bottom:12px;margin-bottom:16px}
  .biz{font-size:22px;font-weight:700;color:#b45309}
  .biz-sub{color:#555;font-size:12px;margin-top:2px}
  .inv-no{font-size:16px;font-weight:700;text-align:right}
  .meta{text-align:right;color:#555;font-size:12px}
  .cust{background:#faf5ee;border:1px solid #e7d8c2;border-radius:8px;padding:10px 14px;margin-bottom:14px;display:flex;justify-content:space-between}
  .cust b{font-size:15px}
  table{width:100%;border-collapse:collapse;margin-bottom:12px}
  th{background:#b45309;color:#fff;text-align:left;padding:6px 8px;font-size:12px}
  th.r,td.r{text-align:right}
  td{padding:4px 8px;border-bottom:1px solid #eee}
  tr:nth-child(even) td{background:#fafafa}
  .totals{margin-left:auto;width:280px}
  .totals td{padding:5px 8px;border:none}
  .totals .grand td{border-top:2px solid #b45309;font-weight:700;font-size:16px}
  .disc{color:#15803d}
  .notes{background:#f6f6f6;border-radius:6px;padding:8px 12px;font-size:11px;color:#555;margin-top:8px;white-space:pre-wrap}
  .pay{margin-top:14px;font-size:12px;color:#333;border-top:1px dashed #ccc;padding-top:8px}
  @media print{.bill{padding:10mm 8mm}}
  </style>`

  function billHtml(inv) {
    const c = inv.customers || {}
    const list = itemsByInv[inv.id] || []
    const rows = list.map(it => `<tr><td>${esc(it.description)}</td><td class="r">${it.quantity}</td><td class="r">${money(it.unit_price)}</td><td class="r">${money(it.total_price)}</td></tr>`).join('')
    const disc = parseFloat(inv.discount_amount)
    return `<div class="bill">
  <div class="head">
    <div><div class="biz">${esc(st.business_name)}</div>
      <div class="biz-sub">${esc(st.contact_phone)} · ${esc(st.contact_email)} · ${esc(st.country)}</div></div>
    <div><div class="inv-no">${esc(inv.invoice_number)}</div>
      <div class="meta">Invoice date: ${esc(inv.invoice_date)}<br>Billing period: ${esc(inv.billing_period_start)} → ${esc(inv.billing_period_end)}</div></div>
  </div>
  <div class="cust">
    <div><b>${esc(c.full_name)}</b><br><span style="color:#777">${esc(c.customer_code)}${c.area ? ' · ' + esc(c.area) : ''}${c.mobile_number ? ' · ' + esc(c.mobile_number) : ''}</span></div>
    <div style="text-align:right;align-self:center"><span style="color:#777;font-size:11px">MONTH</span><br><b>${MONTH_LABEL}</b></div>
  </div>
  <table><thead><tr><th>Description</th><th class="r">Qty</th><th class="r">Price</th><th class="r">Amount (AED)</th></tr></thead>
  <tbody>${rows || '<tr><td colspan="4" style="color:#999">No line items</td></tr>'}</tbody></table>
  <table class="totals">
    <tr><td>Subtotal</td><td class="r">AED ${money(inv.subtotal)}</td></tr>
    ${disc > 0 ? `<tr class="disc"><td>Discount (fixed plan)</td><td class="r">− AED ${money(inv.discount_amount)}</td></tr>` : ''}
    <tr><td style="color:#777">VAT ${st.vat_percent}% (included)</td><td class="r" style="color:#777">AED ${money(inv.tax_amount)}</td></tr>
    <tr class="grand"><td>TOTAL DUE</td><td class="r">AED ${money(inv.total_amount)}</td></tr>
  </table>
  ${inv.notes ? `<div class="notes">${esc(inv.notes)}</div>` : ''}
  <div class="pay">Pay by bank transfer: <b>${esc(st.bank_name)}</b> · ${esc(st.bank_account_name)} · IBAN <b>${esc(st.bank_iban)}</b> — or cash to the delivery team.</div>
</div>`
  }

  let n = 0
  const parts = []
  for (const inv of invoices) {
    const html = billHtml(inv)
    parts.push(html)
    const c = inv.customers || {}
    const file = `${safeName(c.full_name)} (${safeName(c.customer_code)}) - ${MONTH_LABEL}.html`
    fs.writeFileSync(path.join(OUT_DIR, file), `<!doctype html><html><head><meta charset="utf-8"><title>${esc(inv.invoice_number)} — ${esc(c.full_name)}</title>${style}</head><body>${html}</body></html>`)
    n++
  }
  fs.writeFileSync(path.join(OUT_DIR, `ALL INVOICES - ${MONTH_LABEL}.html`),
    `<!doctype html><html><head><meta charset="utf-8"><title>All invoices — ${MONTH_LABEL}</title>${style}</head><body>${parts.join('\n')}</body></html>`)
  console.log(`Wrote ${n} bills + 1 combined file to ${OUT_DIR}`)
}

main().catch(e => { console.error(e); process.exit(1) })
