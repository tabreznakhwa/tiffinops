import { formatInTimeZone } from 'date-fns-tz'
import { requireAuth } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { BillPrintSetup } from '@/components/bills/bill-print-setup'
import type { Enums } from '@/lib/supabase/types'

type PaymentMode = Enums<'payment_mode'>

const MODE_LABELS: Record<PaymentMode, string> = {
  cash:          'Cash',
  bank_transfer: 'Bank Transfer',
  card:          'Card',
  online:        'Online',
  cheque:        'Cheque',
  wallet:        'Wallet',
  other:         'Other',
}

function fmtDate(d: string) {
  return new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  })
}

type PayRow = {
  id: string
  payment_number: string
  payment_date: string
  amount: string
  mode: PaymentMode
  reference_number: string | null
  notes: string | null
  customers: { full_name: string; customer_code: string } | null
}

export default async function PaymentReportPrintPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>
}) {
  await requireAuth()

  const { from, to } = await searchParams
  const admin = createAdminClient()

  let query = admin
    .from('payments')
    .select('id, payment_number, payment_date, amount, mode, reference_number, notes, customers(full_name, customer_code)')
    .is('voided_at', null)
    .order('payment_date', { ascending: false })
    .order('created_at', { ascending: false })

  if (from) query = query.gte('payment_date', from)
  if (to)   query = query.lte('payment_date', to)

  const { data: rawPayments } = await query
  const payments = (rawPayments ?? []) as unknown as PayRow[]

  const grandTotal = payments.reduce((s, p) => s + parseFloat(String(p.amount)), 0)

  const modeMap = new Map<PaymentMode, number>()
  for (const p of payments) {
    modeMap.set(p.mode, (modeMap.get(p.mode) ?? 0) + parseFloat(String(p.amount)))
  }
  const modeBreakdown = [...modeMap.entries()].sort((a, b) => b[1] - a[1])

  const printedAt = formatInTimeZone(new Date(), 'Asia/Dubai', 'd MMM yyyy, h:mm a')
  const dateRangeLabel = from || to
    ? `${from ? fmtDate(from) : 'Start'} — ${to ? fmtDate(to) : 'Today'}`
    : 'All Dates'

  const cell: React.CSSProperties = {
    padding: '7px 8px',
    borderBottom: '1px solid #ECE2D3',
    fontSize: 12.5,
    verticalAlign: 'top',
    color: '#221A13',
  }
  const hdr: React.CSSProperties = {
    padding: '6px 8px',
    borderBottom: '2px solid #221A13',
    fontSize: 10,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '.08em',
    color: '#7C7063',
    textAlign: 'left',
  }

  return (
    <div
      style={{
        background: 'white',
        minHeight: '100vh',
        padding: '24px 28px',
        maxWidth: 760,
        margin: '0 auto',
        fontFamily: 'var(--font-sans)',
        color: '#221A13',
        fontSize: 13,
        lineHeight: 1.5,
      }}
    >
      <BillPrintSetup />

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, paddingBottom: 14, borderBottom: '3px solid #221A13' }}>
        <div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/Apna%20chulha%20logo%20brown.png" alt="Apna Chulha" style={{ height: 44, width: 'auto', display: 'block', marginBottom: 8 }} />
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 800, margin: '0 0 2px' }}>
            Payment Report
          </h1>
          <p style={{ fontSize: 13, color: '#7C7063' }}>{dateRangeLabel}</p>
        </div>
        <div style={{ textAlign: 'right' }}>
          <p style={{ fontSize: 11, color: '#7C7063' }}>Printed: {printedAt} (Dubai)</p>
          <p style={{ fontSize: 11, color: '#7C7063', marginTop: 2 }}>
            {payments.length} payment{payments.length !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      {/* Grand total + mode breakdown */}
      <div style={{ display: 'flex', gap: 32, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: '#7C7063', marginBottom: 2 }}>
            Total Collected
          </p>
          <p style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 26, color: '#221A13' }}>
            AED {grandTotal.toFixed(2)}
          </p>
        </div>
        {modeBreakdown.length > 1 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 20px', alignItems: 'flex-start', paddingTop: 2 }}>
            {modeBreakdown.map(([mode, total]) => (
              <div key={mode}>
                <p style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: '#7C7063', marginBottom: 2 }}>
                  {MODE_LABELS[mode] ?? mode}
                </p>
                <p style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16, color: '#221A13' }}>
                  AED {total.toFixed(2)}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Payments table */}
      {payments.length === 0 ? (
        <p style={{ color: '#7C7063', textAlign: 'center', padding: '40px 0' }}>
          No payments found for the selected date range.
        </p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={hdr}>Date</th>
              <th style={hdr}>Payment #</th>
              <th style={hdr}>Customer</th>
              <th style={hdr}>Mode</th>
              <th style={hdr}>Reference</th>
              <th style={{ ...hdr, textAlign: 'right' }}>Amount (AED)</th>
            </tr>
          </thead>
          <tbody>
            {payments.map(p => (
              <tr key={p.id}>
                <td style={{ ...cell, color: '#7C7063' }}>{fmtDate(p.payment_date)}</td>
                <td style={{ ...cell, color: '#7C7063' }}>{p.payment_number}</td>
                <td style={cell}>
                  <span style={{ fontWeight: 700 }}>{p.customers?.full_name ?? 'Unknown'}</span>
                  {p.customers?.customer_code && (
                    <span style={{ color: '#7C7063' }}> · {p.customers.customer_code}</span>
                  )}
                  {p.notes && (
                    <div style={{ fontSize: 11, color: '#7C7063', fontStyle: 'italic', marginTop: 1 }}>{p.notes}</div>
                  )}
                </td>
                <td style={cell}>{MODE_LABELS[p.mode] ?? p.mode}</td>
                <td style={{ ...cell, color: '#7C7063' }}>{p.reference_number ?? '—'}</td>
                <td style={{ ...cell, textAlign: 'right', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 13 }}>
                  {parseFloat(String(p.amount)).toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={5} style={{ ...cell, borderTop: '2px solid #221A13', borderBottom: 'none', fontWeight: 700, paddingTop: 10 }}>
                Total
              </td>
              <td style={{ ...cell, borderTop: '2px solid #221A13', borderBottom: 'none', textAlign: 'right', fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 15, paddingTop: 10 }}>
                {grandTotal.toFixed(2)}
              </td>
            </tr>
          </tfoot>
        </table>
      )}

      {/* Signature */}
      <div style={{ marginTop: 48, display: 'flex', justifyContent: 'space-between' }}>
        <div>
          <div style={{ borderTop: '1px solid #221A13', width: 180, paddingTop: 4 }}>
            <p style={{ fontSize: 11, color: '#7C7063' }}>Authorized Signature</p>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <p style={{ fontSize: 11, color: '#7C7063' }}>Apna Chulha Restaurant LLC · Dubai</p>
        </div>
      </div>
    </div>
  )
}
