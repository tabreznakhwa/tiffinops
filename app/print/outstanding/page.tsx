import { formatInTimeZone } from 'date-fns-tz'
import { requireAuth } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSettings } from '@/lib/settings/getSettings'
import { BillPrintSetup } from '@/components/bills/bill-print-setup'

function fmtDate(d: string) {
  return new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  })
}

const cell: React.CSSProperties = {
  padding: '6px 8px',
  borderBottom: '1px solid #ECE2D3',
  fontSize: 12,
  verticalAlign: 'top',
  color: '#221A13',
}
const hdr: React.CSSProperties = {
  padding: '5px 8px',
  borderBottom: '2px solid #221A13',
  fontSize: 9.5,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '.08em',
  color: '#7C7063',
  textAlign: 'left',
}

export default async function OutstandingPrintPage() {
  await requireAuth()

  const admin    = createAdminClient()
  const settings = await getSettings()

  const printedAt = formatInTimeZone(new Date(), 'Asia/Dubai', 'd MMM yyyy, h:mm a')

  // Fetch all outstanding invoices (issued / overdue / partial) with customer info
  type InvRow = {
    id: string
    invoice_number: string
    invoice_date: string
    due_date: string
    invoice_type: string
    billing_period_start: string | null
    billing_period_end: string | null
    total_amount: string
    status: string
    customers: { full_name: string; customer_code: string } | null
  }

  // Paginate in case there are many invoices
  const allInvoices: InvRow[] = []
  const PAGE = 1000
  let offset = 0
  while (true) {
    const { data } = await admin
      .from('invoices')
      .select('id, invoice_number, invoice_date, due_date, invoice_type, billing_period_start, billing_period_end, total_amount, status, customers(full_name, customer_code)')
      .in('status', ['issued', 'overdue', 'partial'])
      .order('customers(full_name)', { ascending: true })
      .range(offset, offset + PAGE - 1)
    const batch = (data ?? []) as unknown as InvRow[]
    allInvoices.push(...batch)
    if (batch.length < PAGE) break
    offset += PAGE
  }

  // Group by customer
  type CustomerSummary = {
    full_name: string
    customer_code: string
    invoices: InvRow[]
    total: number
  }
  const custMap = new Map<string, CustomerSummary>()
  for (const inv of allInvoices) {
    const key  = inv.customers?.customer_code ?? inv.id
    const name = inv.customers?.full_name ?? 'Unknown'
    const code = inv.customers?.customer_code ?? ''
    if (!custMap.has(key)) {
      custMap.set(key, { full_name: name, customer_code: code, invoices: [], total: 0 })
    }
    const entry = custMap.get(key)!
    entry.invoices.push(inv)
    entry.total += parseFloat(String(inv.total_amount))
  }

  const customers = [...custMap.values()].sort((a, b) => b.total - a.total)
  const grandTotal = customers.reduce((s, c) => s + c.total, 0)

  const TYPE_LABELS: Record<string, string> = {
    a_la_carte_cycle: 'A La Carte',
    fixed_monthly:    'Fixed Monthly',
    adhoc:            'Adhoc',
  }

  return (
    <div style={{ background: 'white', minHeight: '100vh', padding: '24px 28px', maxWidth: 820, margin: '0 auto', fontFamily: 'var(--font-sans)', color: '#221A13', fontSize: 13, lineHeight: 1.5 }}>
      <BillPrintSetup />

      {/* ── Header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18, paddingBottom: 14, borderBottom: '3px solid #221A13' }}>
        <div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/Apna%20chulha%20logo%20brown.png" alt="Apna Chulha" style={{ height: 42, width: 'auto', display: 'block', marginBottom: 8 }} />
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 800, margin: '0 0 2px' }}>
            Outstanding Payments Report
          </h1>
          <p style={{ fontSize: 12, color: '#7C7063' }}>All issued invoices pending payment — as of {printedAt} (Dubai)</p>
        </div>
        <div style={{ textAlign: 'right' }}>
          <p style={{ fontSize: 11, color: '#7C7063' }}>Printed: {printedAt}</p>
          <p style={{ fontSize: 11, color: '#7C7063', marginTop: 2 }}>{settings.business_name}</p>
        </div>
      </div>

      {/* ── Summary KPIs ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 20 }}>
        {[
          { label: 'Total Outstanding', value: `${settings.currency} ${grandTotal.toFixed(2)}` },
          { label: 'Customers with Balance', value: String(customers.length) },
          { label: 'Total Invoices', value: String(allInvoices.length) },
        ].map(kpi => (
          <div key={kpi.label} style={{ background: '#FBF6EE', border: '1px solid #ECE2D3', borderRadius: 8, padding: '10px 14px' }}>
            <p style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: '#7C7063', margin: '0 0 3px' }}>
              {kpi.label}
            </p>
            <p style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 18, color: kpi.label === 'Total Outstanding' ? '#C0392B' : '#221A13', margin: 0 }}>
              {kpi.value}
            </p>
          </div>
        ))}
      </div>

      {/* ── Per-customer detail ── */}
      {customers.length === 0 ? (
        <p style={{ color: '#7C7063', fontSize: 13 }}>No outstanding invoices at this time.</p>
      ) : (
        <>
          {customers.map((cust, ci) => (
            <div key={cust.customer_code} style={{ marginBottom: 18, breakInside: 'avoid' }}>
              {/* Customer header row */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', background: '#F5EDE0', padding: '6px 10px', borderRadius: '6px 6px 0 0', borderBottom: '2px solid #D4A96A' }}>
                <span style={{ fontWeight: 700, fontSize: 13 }}>
                  {ci + 1}. {cust.full_name}
                  <span style={{ fontWeight: 400, fontSize: 11, color: '#7C7063', marginLeft: 8 }}>{cust.customer_code}</span>
                </span>
                <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 14, color: '#C0392B' }}>
                  {settings.currency} {cust.total.toFixed(2)}
                </span>
              </div>

              {/* Invoice rows for this customer */}
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={hdr}>Invoice #</th>
                    <th style={hdr}>Type</th>
                    <th style={hdr}>Billing Period</th>
                    <th style={hdr}>Invoice Date</th>
                    <th style={{ ...hdr, color: '#C0392B' }}>Due Date</th>
                    <th style={{ ...hdr, textAlign: 'right' }}>Status</th>
                    <th style={{ ...hdr, textAlign: 'right' }}>Amount ({settings.currency})</th>
                  </tr>
                </thead>
                <tbody>
                  {cust.invoices.map(inv => {
                    const isOverdue = inv.status === 'overdue' || (inv.due_date && inv.due_date < new Date().toISOString().split('T')[0])
                    return (
                      <tr key={inv.id}>
                        <td style={{ ...cell, fontWeight: 600, fontSize: 11 }}>{inv.invoice_number}</td>
                        <td style={{ ...cell, fontSize: 11, color: '#7C7063' }}>{TYPE_LABELS[inv.invoice_type] ?? inv.invoice_type}</td>
                        <td style={{ ...cell, fontSize: 11, color: '#7C7063' }}>
                          {inv.billing_period_start && inv.billing_period_end
                            ? `${fmtDate(inv.billing_period_start)} – ${fmtDate(inv.billing_period_end)}`
                            : '—'}
                        </td>
                        <td style={{ ...cell, fontSize: 11 }}>{fmtDate(inv.invoice_date)}</td>
                        <td style={{ ...cell, fontSize: 11, fontWeight: isOverdue ? 700 : 400, color: isOverdue ? '#C0392B' : '#221A13' }}>
                          {fmtDate(inv.due_date)}
                        </td>
                        <td style={{ ...cell, fontSize: 10, textAlign: 'right', textTransform: 'uppercase', letterSpacing: '.05em', color: inv.status === 'partial' ? '#D4890A' : '#7C7063' }}>
                          {inv.status}
                        </td>
                        <td style={{ ...cell, textAlign: 'right', fontWeight: 700 }}>
                          {parseFloat(String(inv.total_amount)).toFixed(2)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ))}

          {/* ── Grand total ── */}
          <div style={{ borderTop: '3px solid #221A13', marginTop: 8, paddingTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontWeight: 700, fontSize: 14 }}>
              Grand Total Outstanding — {customers.length} customer{customers.length !== 1 ? 's' : ''}, {allInvoices.length} invoice{allInvoices.length !== 1 ? 's' : ''}
            </span>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 18, color: '#C0392B' }}>
              {settings.currency} {grandTotal.toFixed(2)}
            </span>
          </div>
        </>
      )}

      {/* ── Signature ── */}
      <div style={{ marginTop: 40, display: 'flex', justifyContent: 'space-between', paddingTop: 20, borderTop: '1px solid #ECE2D3' }}>
        <div>
          <div style={{ borderTop: '1px solid #221A13', width: 180, paddingTop: 4 }}>
            <p style={{ fontSize: 11, color: '#7C7063' }}>Authorized Signature</p>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <p style={{ fontSize: 11, color: '#7C7063' }}>{settings.business_name} · Dubai</p>
        </div>
      </div>
    </div>
  )
}
