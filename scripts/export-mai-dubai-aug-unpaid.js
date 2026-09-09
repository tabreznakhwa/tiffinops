// Mai Dubai — August 2026 unpaid list (PDF for the owner).
// All Mai Dubai customers' invoices whose billing period falls in the Aug
// bucket (billing_period_end in Aug 2026), status issued/partial/overdue.
// Remaining = invoice total − non-voided payments linked to that invoice.
// HTML written to ~/Downloads, converted to PDF via headless Edge.
const fs = require('fs')
const path = require('path')
const os = require('os')
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/)
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '')
}
const { createClient } = require('@supabase/supabase-js')
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

const OUT = path.join(os.homedir(), 'Downloads', 'Mai Dubai - August 2026 Unpaid.html')

const PAGE = 1000
async function fetchAll(build) {
  const out = []; let o = 0
  while (true) { const { data, error } = await build(o, o + PAGE - 1); if (error) throw error; out.push(...(data ?? [])); if ((data ?? []).length < PAGE) break; o += PAGE }
  return out
}
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const fmtD = d => d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : ''

async function main() {
  const { data: st } = await admin.from('app_settings').select('business_name, contact_phone, contact_email').eq('id', 1).single()
  const { data: custs } = await admin.from('customers')
    .select('id, full_name, customer_code, mobile_number').eq('area', 'Mai Dubai')
  const custById = new Map(custs.map(c => [c.id, c]))

  const invs = await fetchAll((f, t) => admin.from('invoices')
    .select('id, customer_id, invoice_number, billing_period_start, billing_period_end, total_amount, status')
    .in('customer_id', custs.map(c => c.id))
    .gte('billing_period_end', '2026-08-01').lte('billing_period_end', '2026-08-31')
    .in('status', ['issued', 'partial', 'overdue'])
    .range(f, t))

  const pays = await fetchAll((f, t) => admin.from('payments')
    .select('invoice_id, amount').in('invoice_id', invs.map(i => i.id)).is('voided_at', null).range(f, t))
  const paidByInv = new Map()
  for (const p of pays) paidByInv.set(p.invoice_id, (paidByInv.get(p.invoice_id) ?? 0) + parseFloat(p.amount))

  const list = invs.map(i => {
    const c = custById.get(i.customer_id)
    const billed = parseFloat(i.total_amount)
    const paid = Math.min(paidByInv.get(i.id) ?? 0, billed)
    return { name: (c.full_name || '').trim(), code: c.customer_code, mobile: c.mobile_number || '', inv: i.invoice_number, ps: i.billing_period_start, pe: i.billing_period_end, billed, paid, remaining: billed - paid }
  }).filter(r => r.remaining > 0.005)
  list.sort((a, b) => a.name.localeCompare(b.name))

  const tBilled = list.reduce((s, r) => s + r.billed, 0)
  const tPaid = list.reduce((s, r) => s + r.paid, 0)
  const tRem = list.reduce((s, r) => s + r.remaining, 0)

  const rows = list.map((r, idx) => `<tr>
    <td class="c">${idx + 1}</td>
    <td>${esc(r.name)}</td>
    <td class="mut">${esc(r.code)}</td>
    <td class="mut">${esc(r.mobile)}</td>
    <td class="mut">${esc(r.inv)}</td>
    <td class="c mut">${fmtD(r.ps)} – ${fmtD(r.pe)}</td>
    <td class="r">${r.billed.toFixed(2)}</td>
    <td class="r">${r.paid ? r.paid.toFixed(2) : '—'}</td>
    <td class="r rem">${r.remaining.toFixed(2)}</td>
  </tr>`).join('\n')

  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 11px; color: #1a1a1a; padding: 28px 32px; }
    .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #1a1a1a; padding-bottom: 10px; margin-bottom: 14px; }
    .biz { font-size: 17px; font-weight: 700; }
    .sub, .meta { color: #666; font-size: 10px; margin-top: 3px; }
    h2 { font-size: 14px; text-align: right; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; font-size: 9.5px; text-transform: uppercase; letter-spacing: .4px; color: #555; border-bottom: 1.5px solid #999; padding: 5px 6px; }
    td { padding: 4.5px 6px; border-bottom: 1px solid #e4e4e4; }
    tr:nth-child(even) td { background: #f7f7f7; }
    .c { text-align: center; } .r { text-align: right; font-variant-numeric: tabular-nums; } th.r { text-align: right; }
    .mut { color: #555; }
    .rem { font-weight: 700; color: #b0231f; }
    .total td { border-top: 2px solid #1a1a1a; border-bottom: none; font-weight: 700; font-size: 12px; padding-top: 7px; }
    .foot { margin-top: 14px; color: #888; font-size: 9px; }
  </style></head><body>
  <div class="head">
    <div><div class="biz">${esc(st.business_name)}</div>
    <div class="sub">${esc(st.contact_phone)} · ${esc(st.contact_email)}</div></div>
    <div><h2>Mai Dubai — August 2026 Unpaid</h2>
    <div class="meta">August billing cycle · ${list.length} customers pending · generated 01 Sep 2026</div></div>
  </div>
  <table>
  <thead><tr><th></th><th>Customer</th><th>Code</th><th>Mobile</th><th>Invoice</th><th style="text-align:center">Period</th><th class="r">Billed</th><th class="r">Paid</th><th class="r">Pending (AED)</th></tr></thead>
  <tbody>
  ${rows}
  <tr class="total"><td></td><td>TOTAL</td><td></td><td></td><td>${list.length} invoices</td><td></td><td class="r">${tBilled.toFixed(2)}</td><td class="r">${tPaid ? tPaid.toFixed(2) : '—'}</td><td class="r rem">${tRem.toFixed(2)}</td></tr>
  </tbody></table>
  <div class="foot">Invoices with status issued/partial/overdue for the August cycle. Paid = payments recorded against that invoice. Draft (unissued) invoices are not included.</div>
  </body></html>`

  fs.writeFileSync(OUT, html)
  console.log(`Wrote ${list.length} rows, pending AED ${tRem.toFixed(2)} -> ${OUT}`)
}

main().catch(e => { console.error(e); process.exit(1) })
