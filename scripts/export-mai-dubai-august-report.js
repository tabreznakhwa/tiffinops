// Mai Dubai — August 2026 report (Paid + Pending), by customer name.
// Invoices whose billing_period_end falls in Aug 2026, status not draft/cancelled.
// Remaining = invoice total − non-voided payments linked to that invoice.
// HTML written to ~/Downloads.
const fs = require('fs')
const path = require('path')
const os = require('os')
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/)
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '')
}
const { createClient } = require('@supabase/supabase-js')
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

const OUT = path.join(os.homedir(), 'Downloads', 'Mai Dubai - August 2026 Report.html')

const PAGE = 1000
async function fetchAll(build) {
  const out = []; let o = 0
  while (true) { const { data, error } = await build(o, o + PAGE - 1); if (error) throw error; out.push(...(data ?? [])); if ((data ?? []).length < PAGE) break; o += PAGE }
  return out
}
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

async function main() {
  const { data: st } = await admin.from('app_settings').select('business_name, contact_phone, contact_email').eq('id', 1).single()
  const { data: custs } = await admin.from('customers')
    .select('id, full_name, customer_code, mobile_number').eq('area', 'Mai Dubai')
  const custById = new Map(custs.map(c => [c.id, c]))

  const invs = await fetchAll((f, t) => admin.from('invoices')
    .select('id, customer_id, invoice_number, status, total_amount')
    .in('customer_id', custs.map(c => c.id))
    .not('status', 'in', '(draft,cancelled)')
    .gte('billing_period_end', '2026-08-01').lte('billing_period_end', '2026-08-31')
    .range(f, t))

  const pays = await fetchAll((f, t) => admin.from('payments')
    .select('invoice_id, amount').in('invoice_id', invs.map(i => i.id)).is('voided_at', null).range(f, t))
  const paidByInv = new Map()
  for (const p of pays) paidByInv.set(p.invoice_id, (paidByInv.get(p.invoice_id) ?? 0) + parseFloat(p.amount))

  const perCust = new Map()
  for (const i of invs) {
    const billed = parseFloat(i.total_amount)
    const paid = Math.min(paidByInv.get(i.id) ?? 0, billed)
    const agg = perCust.get(i.customer_id) ?? { billed: 0, paid: 0, invoices: 0 }
    agg.billed += billed; agg.paid += paid; agg.invoices += 1
    perCust.set(i.customer_id, agg)
  }

  const rows = [...perCust.entries()].map(([custId, agg]) => {
    const c = custById.get(custId)
    const remaining = agg.billed - agg.paid
    return { name: (c.full_name || '').trim(), code: c.customer_code, mobile: c.mobile_number || '', invoices: agg.invoices, billed: agg.billed, paid: agg.paid, remaining }
  }).sort((a, b) => a.name.localeCompare(b.name))

  const paidRows = rows.filter(r => r.remaining <= 0.005)
  const pendingRows = rows.filter(r => r.remaining > 0.005)
  const tBilled = rows.reduce((s, r) => s + r.billed, 0)
  const tPaid = rows.reduce((s, r) => s + r.paid, 0)
  const tRem = rows.reduce((s, r) => s + r.remaining, 0)

  const rowHtml = (r, idx, showRem) => `<tr>
    <td class="c">${idx + 1}</td>
    <td>${esc(r.name)}</td>
    <td class="mut">${esc(r.code)}</td>
    <td class="mut">${esc(r.mobile)}</td>
    <td class="r">${r.billed.toFixed(2)}</td>
    <td class="r">${r.paid.toFixed(2)}</td>
    ${showRem ? `<td class="r rem">${r.remaining.toFixed(2)}</td>` : ''}
  </tr>`

  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 11px; color: #1a1a1a; padding: 28px 32px; }
    .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #1a1a1a; padding-bottom: 10px; margin-bottom: 14px; }
    .biz { font-size: 17px; font-weight: 700; }
    .sub, .meta { color: #666; font-size: 10px; margin-top: 3px; }
    h2 { font-size: 14px; text-align: right; }
    h3 { font-size: 12.5px; margin: 18px 0 6px; padding-bottom: 4px; border-bottom: 1px solid #ccc; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; font-size: 9.5px; text-transform: uppercase; letter-spacing: .4px; color: #555; border-bottom: 1.5px solid #999; padding: 5px 6px; }
    td { padding: 4.5px 6px; border-bottom: 1px solid #e4e4e4; }
    tr:nth-child(even) td { background: #f7f7f7; }
    .c { text-align: center; } .r { text-align: right; font-variant-numeric: tabular-nums; } th.r { text-align: right; }
    .mut { color: #555; }
    .rem { font-weight: 700; color: #b0231f; }
    .ok { font-weight: 700; color: #1a7a3c; }
    .total td { border-top: 2px solid #1a1a1a; border-bottom: none; font-weight: 700; font-size: 12px; padding-top: 7px; }
    .foot { margin-top: 14px; color: #888; font-size: 9px; }
    .summary { display: flex; gap: 22px; margin-bottom: 4px; font-size: 11px; }
    .summary b { font-size: 13px; }
  </style></head><body>
  <div class="head">
    <div><div class="biz">${esc(st.business_name)}</div>
    <div class="sub">${esc(st.contact_phone)} · ${esc(st.contact_email)}</div></div>
    <div><h2>Mai Dubai — August 2026 Report</h2>
    <div class="meta">August billing cycle · ${rows.length} customers billed · generated 07 Sep 2026</div></div>
  </div>
  <div class="summary">
    <div>Paid: <b class="ok">${paidRows.length}</b></div>
    <div>Pending: <b class="rem">${pendingRows.length}</b></div>
    <div>Total billed: <b>AED ${tBilled.toFixed(2)}</b></div>
    <div>Total paid: <b>AED ${tPaid.toFixed(2)}</b></div>
    <div>Total pending: <b class="rem">AED ${tRem.toFixed(2)}</b></div>
  </div>

  <h3>Pending (${pendingRows.length} customers)</h3>
  <table>
  <thead><tr><th></th><th>Customer</th><th>Code</th><th>Mobile</th><th class="r">Billed</th><th class="r">Paid</th><th class="r">Pending (AED)</th></tr></thead>
  <tbody>
  ${pendingRows.map((r, i) => rowHtml(r, i, true)).join('\n')}
  <tr class="total"><td></td><td>TOTAL</td><td></td><td></td><td class="r">${pendingRows.reduce((s, r) => s + r.billed, 0).toFixed(2)}</td><td class="r">${pendingRows.reduce((s, r) => s + r.paid, 0).toFixed(2)}</td><td class="r rem">${tRem.toFixed(2)}</td></tr>
  </tbody></table>

  <h3>Paid (${paidRows.length} customers)</h3>
  <table>
  <thead><tr><th></th><th>Customer</th><th>Code</th><th>Mobile</th><th class="r">Billed</th><th class="r">Paid</th></tr></thead>
  <tbody>
  ${paidRows.map((r, i) => rowHtml(r, i, false)).join('\n')}
  <tr class="total"><td></td><td>TOTAL</td><td></td><td></td><td class="r">${paidRows.reduce((s, r) => s + r.billed, 0).toFixed(2)}</td><td class="r">${paidRows.reduce((s, r) => s + r.paid, 0).toFixed(2)}</td></tr>
  </tbody></table>

  <div class="foot">Invoices for the August billing cycle (billing_period_end in Aug 2026), status issued/partial/paid. Draft and cancelled invoices excluded. Paid = payments recorded against that invoice.</div>
  </body></html>`

  fs.writeFileSync(OUT, html)
  console.log(`Wrote report: ${rows.length} customers (${paidRows.length} paid, ${pendingRows.length} pending) -> ${OUT}`)
}

main().catch(e => { console.error(e); process.exit(1) })
