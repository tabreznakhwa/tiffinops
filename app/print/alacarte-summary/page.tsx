import { notFound } from 'next/navigation'
import { formatInTimeZone } from 'date-fns-tz'
import { requireAuth } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { BillPrintSetup } from '@/components/bills/bill-print-setup'
import { getSettings } from '@/lib/settings/getSettings'

function fmtLongDate(iso: string) {
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric',
  })
}

function Divider({ thick = false }: { thick?: boolean }) {
  return (
    <div style={{
      borderTop: thick ? '2px solid #221A13' : '1px solid #ECE2D3',
      margin: thick ? '10px 0' : '0',
    }} />
  )
}

export default async function AlaCarteSummaryPage({
  searchParams,
}: {
  searchParams: Promise<{ period_start?: string; period_end?: string }>
}) {
  await requireAuth()

  const { period_start, period_end } = await searchParams
  const admin = createAdminClient()

  // If no params, find the most recent a_la_carte_cycle period
  let periodStart = period_start
  let periodEnd   = period_end

  if (!periodStart || !periodEnd) {
    const { data: latest } = await admin
      .from('invoices')
      .select('billing_period_start, billing_period_end')
      .eq('invoice_type', 'a_la_carte_cycle')
      .not('status', 'eq', 'cancelled')
      .order('billing_period_end', { ascending: false })
      .limit(1)
      .single()

    if (!latest) notFound()
    periodStart = latest.billing_period_start!
    periodEnd   = latest.billing_period_end!
  }

  const [settings, { data: invoices }] = await Promise.all([
    getSettings(),
    admin
      .from('invoices')
      .select(`
        id, invoice_number, total_amount, discount_amount, status,
        customers(full_name, customer_code, mobile_number, area)
      `)
      .eq('invoice_type', 'a_la_carte_cycle')
      .eq('billing_period_start', periodStart)
      .eq('billing_period_end', periodEnd)
      .not('status', 'eq', 'cancelled')
      .order('invoice_number'),
  ])

  if (!invoices || invoices.length === 0) notFound()

  type Customer = { full_name: string; customer_code: string; mobile_number: string | null; area: string | null }
  type Row = { id: string; invoice_number: string; total_amount: string; discount_amount: string | null; status: string; customers: Customer | null }

  const rows = (invoices as unknown as Row[]).slice().sort((a, b) => {
    const na = a.customers?.full_name ?? ''
    const nb = b.customers?.full_name ?? ''
    return na.localeCompare(nb)
  })

  const currency   = settings.currency || 'AED'
  const grandTotal = rows.reduce((s, r) => s + parseFloat(String(r.total_amount)), 0)
  const printDate  = formatInTimeZone(new Date(), 'Asia/Dubai', 'dd MMM yyyy')

  const STATUS_LABEL: Record<string, string> = {
    draft:       'Draft',
    issued:      'Issued',
    paid:        'Paid',
    partial:     'Partial',
    overdue:     'Overdue',
    written_off: 'Written Off',
  }
  const STATUS_COLOR: Record<string, string> = {
    draft:       '#7C7063',
    issued:      '#1a6bb5',
    paid:        '#2d7d4e',
    partial:     '#b58a1a',
    overdue:     '#c0392b',
    written_off: '#7C7063',
  }

  return (
    <div
      style={{
        background: 'white',
        minHeight: '100vh',
        padding: '24px 28px',
        maxWidth: 820,
        margin: '0 auto',
        fontFamily: 'var(--font-sans)',
        color: '#221A13',
        fontSize: 13,
        lineHeight: 1.5,
      }}
    >
      <BillPrintSetup />

      {/* ── Header ── */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: 20,
          paddingBottom: 16,
          borderBottom: '3px solid #221A13',
        }}
      >
        <div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/Apna%20chulha%20logo%20brown.png"
            alt="Apna Chulha"
            style={{ height: 48, width: 'auto', display: 'block', marginBottom: 8 }}
          />
          <h1
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 20,
              fontWeight: 800,
              color: '#221A13',
              margin: '0 0 2px',
              letterSpacing: '-0.01em',
            }}
          >
            A LA CARTE INVOICE SUMMARY
          </h1>
          <p style={{ fontSize: 12, color: '#7C7063', margin: 0 }}>
            Billing Period: {fmtLongDate(periodStart)} – {fmtLongDate(periodEnd)}
          </p>
        </div>

        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <p style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#7C7063', margin: '0 0 4px' }}>
            Printed
          </p>
          <p style={{ fontSize: 13, fontWeight: 700, margin: '0 0 8px' }}>{printDate}</p>
          <p style={{ fontSize: 10, color: '#7C7063', margin: '0 0 2px' }}>{rows.length} invoices</p>
          <p style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 800, margin: 0 }}>
            {currency} {grandTotal.toFixed(2)}
          </p>
        </div>
      </div>

      {/* ── Table header ── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '32px 1fr 110px 130px 100px 70px',
          gap: 8,
          padding: '6px 0',
          borderBottom: '2px solid #221A13',
          fontWeight: 700,
          fontSize: 10,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: '#7C7063',
        }}
      >
        <span>#</span>
        <span>Customer</span>
        <span>Code</span>
        <span>Phone</span>
        <span style={{ textAlign: 'right' }}>Amount ({currency})</span>
        <span style={{ textAlign: 'right' }}>Status</span>
      </div>

      {/* ── Rows ── */}
      {rows.map((row, idx) => {
        const cust   = row.customers
        const amount = parseFloat(String(row.total_amount))
        const status = row.status
        return (
          <div key={row.id}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '32px 1fr 110px 130px 100px 70px',
                gap: 8,
                padding: '7px 0',
                alignItems: 'center',
                fontSize: 12,
              }}
            >
              <span style={{ color: '#7C7063', fontSize: 11 }}>{idx + 1}</span>
              <div>
                <p style={{ margin: 0, fontWeight: 700, fontSize: 12 }}>{cust?.full_name ?? '—'}</p>
                {cust?.area && <p style={{ margin: 0, fontSize: 10, color: '#7C7063' }}>{cust.area}</p>}
              </div>
              <span style={{ fontSize: 11, color: '#7C7063', fontFamily: 'var(--font-display)' }}>
                {cust?.customer_code ?? '—'}
              </span>
              <span style={{ fontSize: 12, fontFamily: 'var(--font-display)' }}>
                {cust?.mobile_number ?? '—'}
              </span>
              <span style={{ textAlign: 'right', fontWeight: 700, fontFamily: 'var(--font-display)' }}>
                {amount.toFixed(2)}
              </span>
              <span style={{ textAlign: 'right', fontSize: 11, fontWeight: 600, color: STATUS_COLOR[status] ?? '#7C7063' }}>
                {STATUS_LABEL[status] ?? status}
              </span>
            </div>
            <Divider />
          </div>
        )
      })}

      {/* ── Grand total ── */}
      <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
        <div style={{ width: 200 }}>
          <Divider thick />
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0' }}>
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 800 }}>GRAND TOTAL</span>
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 800 }}>
              {currency} {grandTotal.toFixed(2)}
            </span>
          </div>
          <Divider thick />
        </div>
      </div>

      {/* ── Footer ── */}
      <div
        style={{
          marginTop: 32,
          textAlign: 'center',
          fontSize: 10,
          color: '#7C7063',
          paddingTop: 12,
          borderTop: '1px solid #ECE2D3',
        }}
      >
        {settings.business_name} · {settings.country} · A La Carte Invoice Summary
      </div>
    </div>
  )
}
