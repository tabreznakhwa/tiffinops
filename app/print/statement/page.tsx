import { notFound } from 'next/navigation'
import { formatInTimeZone } from 'date-fns-tz'
import { requireAuth } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { BillPrintSetup } from '@/components/bills/bill-print-setup'
import { getSettings } from '@/lib/settings/getSettings'
import type { Enums } from '@/lib/supabase/types'

type InvoiceStatus = Enums<'invoice_status'>

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function Divider({ thick = false }: { thick?: boolean }) {
  return (
    <div style={{ borderTop: thick ? '2px solid #221A13' : '1px solid #ECE2D3', margin: thick ? '10px 0' : '0' }} />
  )
}

function fmtLongDate(iso: string) {
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric',
  })
}

type Customer = { full_name: string; customer_code: string; area: string | null }
type InvoiceRow = { id: string; customer_id: string; invoice_number: string; invoice_date: string; total_amount: string; status: string; customers: Customer | null }

/**
 * Customer statement — one row per customer, with every one of their
 * matching invoices' total_amount summed into a single figure. Unlike
 * /print/alacarte-summary (a_la_carte_cycle only) or /print/invoices (one
 * full tax invoice per row), this covers every invoice type and is meant to
 * answer "who owes/was billed what" for a filtered slice, e.g. Area =
 * Mai Dubai + a date range = the full Mai Dubai cycle statement regardless
 * of whether a customer is fixed-monthly, a-la-carte or hybrid.
 * Reuses the same query params as the Invoices list's on-screen filters
 * (area / from / to on invoice_date / status) so "Print Statement" there
 * matches what's on screen exactly.
 */
export default async function PrintStatementPage({
  searchParams,
}: {
  searchParams: Promise<{ area?: string; from?: string; to?: string; status?: string }>
}) {
  await requireAuth()

  const { area, from, to, status } = await searchParams

  const areaFilter = area ? area.split(',').map(a => a.trim()).filter(Boolean) : []
  const fromDate = from && DATE_RE.test(from) ? from : ''
  const toDate   = to   && DATE_RE.test(to)   ? to   : ''
  const statusFilter = (status ? status.split(',').map(s => s.trim()).filter(Boolean) : []) as InvoiceStatus[]

  const admin    = createAdminClient()
  const settings = await getSettings()

  let query = admin
    .from('invoices')
    .select(`
      id, customer_id, invoice_number, invoice_date, total_amount, status,
      customers(full_name, customer_code, area)
    `)
  if (fromDate) query = query.gte('invoice_date', fromDate)
  if (toDate)   query = query.lte('invoice_date', toDate)
  if (statusFilter.length) query = query.in('status', statusFilter)
  else query = query.neq('status', 'cancelled')

  const allInvoices: InvoiceRow[] = []
  {
    const PAGE = 1000
    let offset = 0
    while (true) {
      const { data } = await query.order('invoice_date', { ascending: true }).range(offset, offset + PAGE - 1)
      const batch = (data ?? []) as unknown as InvoiceRow[]
      allInvoices.push(...batch)
      if (batch.length < PAGE) break
      offset += PAGE
    }
  }

  const invoices = areaFilter.length
    ? allInvoices.filter(inv => !!inv.customers?.area && areaFilter.includes(inv.customers.area))
    : allInvoices

  if (invoices.length === 0) notFound()

  type StatementRow = { customerId: string; name: string; code: string; area: string | null; amount: number; count: number }
  const byCustomer = new Map<string, StatementRow>()
  for (const inv of invoices) {
    const cust = inv.customers
    if (!cust) continue
    const prev = byCustomer.get(inv.customer_id) ?? {
      customerId: inv.customer_id, name: cust.full_name, code: cust.customer_code, area: cust.area, amount: 0, count: 0,
    }
    prev.amount += parseFloat(String(inv.total_amount))
    prev.count += 1
    byCustomer.set(inv.customer_id, prev)
  }

  const rows = [...byCustomer.values()].sort((a, b) => a.name.localeCompare(b.name))
  const currency   = settings.currency || 'AED'
  const grandTotal = rows.reduce((s, r) => s + r.amount, 0)
  const printDate  = formatInTimeZone(new Date(), 'Asia/Dubai', 'dd MMM yyyy')

  const filterLabel = [
    areaFilter.length ? areaFilter.join(', ') : null,
    fromDate && toDate ? (fromDate === toDate ? fmtLongDate(fromDate) : `${fmtLongDate(fromDate)} – ${fmtLongDate(toDate)}`) : null,
    statusFilter.length ? statusFilter.join(', ') : null,
  ].filter(Boolean).join(' · ')

  return (
    <div
      style={{
        background: 'white', minHeight: '100vh', padding: '24px 28px', maxWidth: 820, margin: '0 auto',
        fontFamily: 'var(--font-sans)', color: '#221A13', fontSize: 13, lineHeight: 1.5,
      }}
    >
      <BillPrintSetup />

      {/* ── Header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, paddingBottom: 16, borderBottom: '3px solid #221A13' }}>
        <div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/Apna%20chulha%20logo%20brown.png" alt="Apna Chulha" style={{ height: 48, width: 'auto', display: 'block', marginBottom: 8 }} />
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 800, color: '#221A13', margin: '0 0 2px', letterSpacing: '-0.01em' }}>
            CUSTOMER STATEMENT
          </h1>
          <p style={{ fontSize: 12, color: '#7C7063', margin: 0 }}>
            {filterLabel || 'All invoices'}
          </p>
        </div>

        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <p style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#7C7063', margin: '0 0 4px' }}>
            Printed
          </p>
          <p style={{ fontSize: 13, fontWeight: 700, margin: '0 0 8px' }}>{printDate}</p>
          <p style={{ fontSize: 10, color: '#7C7063', margin: '0 0 2px' }}>{rows.length} customers</p>
          <p style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 800, margin: 0 }}>
            {currency} {grandTotal.toFixed(2)}
          </p>
        </div>
      </div>

      {/* ── Table ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '32px 1fr 100px 90px', gap: 8, padding: '6px 0', borderBottom: '2px solid #221A13', fontWeight: 700, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#7C7063' }}>
        <span>#</span>
        <span>Customer</span>
        <span>Code</span>
        <span style={{ textAlign: 'right' }}>Amount ({currency})</span>
      </div>

      {rows.map((row, idx) => (
        <div key={row.customerId}>
          <div style={{ display: 'grid', gridTemplateColumns: '32px 1fr 100px 90px', gap: 8, padding: '7px 0', alignItems: 'center', fontSize: 12 }}>
            <span style={{ color: '#7C7063', fontSize: 11 }}>{idx + 1}</span>
            <div>
              <p style={{ margin: 0, fontWeight: 700, fontSize: 12 }}>{row.name}</p>
              {row.area && <p style={{ margin: 0, fontSize: 10, color: '#7C7063' }}>{row.area}{row.count > 1 ? ` · ${row.count} invoices` : ''}</p>}
            </div>
            <span style={{ fontSize: 11, color: '#7C7063', fontFamily: 'var(--font-display)' }}>{row.code}</span>
            <span style={{ textAlign: 'right', fontWeight: 700, fontFamily: 'var(--font-display)' }}>{row.amount.toFixed(2)}</span>
          </div>
          <Divider />
        </div>
      ))}

      {/* ── Grand total ── */}
      <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
        <div style={{ width: 260 }}>
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
      <div style={{ marginTop: 32, textAlign: 'center', fontSize: 10, color: '#7C7063', paddingTop: 12, borderTop: '1px solid #ECE2D3' }}>
        {settings.business_name} · {settings.country} · Customer Statement
      </div>
    </div>
  )
}
