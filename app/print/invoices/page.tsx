import { notFound } from 'next/navigation'
import { formatInTimeZone } from 'date-fns-tz'
import { requireAuth } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { BillPrintSetup } from '@/components/bills/bill-print-setup'
import { getSettings, extractVAT } from '@/lib/settings/getSettings'
import type { Enums } from '@/lib/supabase/types'

type InvoiceType = Enums<'invoice_type'>
type InvoiceStatus = Enums<'invoice_status'>

const TYPE_LABELS: Record<InvoiceType, string> = {
  a_la_carte_cycle: 'A La Carte Cycle',
  fixed_monthly:    'Fixed Monthly',
  adhoc:            'Adhoc',
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function Divider({ thick = false }: { thick?: boolean }) {
  return (
    <div
      style={{
        borderTop: thick ? '2px solid #221A13' : '1px solid #ECE2D3',
        margin: thick ? '10px 0' : '6px 0',
      }}
    />
  )
}

function fmtLongDate(iso: string) {
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric',
  })
}

function fmtMonth(yyyyMM: string) {
  const [y, m] = yyyyMM.split('-')
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('en-GB', {
    month: 'long', year: 'numeric',
  })
}

const MEAL_ORDER: Record<string, number> = { breakfast: 0, lunch: 1, dinner: 2 }

// Parse date and meal from description: "2026-07-02 · dinner · item"
function parseSortKey(desc: string): { date: string; meal: number } {
  const parts = desc.split(' · ')
  const dateStr = parts[0] ?? ''
  const meal = MEAL_ORDER[parts[1]?.toLowerCase() ?? ''] ?? 99
  return { date: dateStr, meal }
}

type Customer = {
  id: string
  full_name: string
  customer_code: string
  mobile_number: string
  area: string | null
  email: string | null
  delivery_address: string | null
}

type InvoiceRow = {
  id: string
  invoice_number: string
  invoice_date: string
  due_date: string
  invoice_type: InvoiceType
  billing_period_start: string | null
  billing_period_end: string | null
  total_amount: string
  status: string
  customers: Customer | null
}

type ItemRow = {
  id: string
  invoice_id: string
  description: string | null
  quantity: string
  unit_price: string
  total_price: string
}

/**
 * Batch invoice PDF — every invoice matching the given filters, one after
 * another as full tax-invoice documents, in a single print job (so the
 * browser's "Save as PDF" produces one combined file). Mirrors
 * app/print/invoice/[id]/page.tsx's layout for each individual invoice, and
 * reuses the same query-param filters as the Invoices list page (area, date
 * range on invoice_date, status) so "Print Filtered" there matches what's on
 * screen exactly — e.g. area=Mai+Dubai&from=2026-09-26&to=2026-09-26 for a
 * single day's just-generated batch.
 */
export default async function PrintInvoiceBatchPage({
  searchParams,
}: {
  searchParams: Promise<{ area?: string; from?: string; to?: string; status?: string }>
}) {
  await requireAuth()

  const { area, from, to, status } = await searchParams

  const areaFilter = area
    ? area.split(',').map(a => a.trim()).filter(Boolean)
    : []
  const fromDate = from && DATE_RE.test(from) ? from : ''
  const toDate   = to   && DATE_RE.test(to)   ? to   : ''
  // Default: every status except cancelled — matches what's billable/real.
  const statusFilter = (status
    ? status.split(',').map(s => s.trim()).filter(Boolean)
    : []) as InvoiceStatus[]

  const admin    = createAdminClient()
  const settings = await getSettings()

  let query = admin
    .from('invoices')
    .select(`
      id, invoice_number, invoice_date, due_date,
      invoice_type, billing_period_start, billing_period_end,
      total_amount, status,
      customers(
        id, full_name, customer_code, mobile_number, area, email, delivery_address
      )
    `)
  if (fromDate) query = query.gte('invoice_date', fromDate)
  if (toDate)   query = query.lte('invoice_date', toDate)
  if (statusFilter.length) query = query.in('status', statusFilter)
  else query = query.neq('status', 'cancelled')

  // Paginate in case a wide filter matches many invoices.
  const allInvoices: InvoiceRow[] = []
  {
    const PAGE = 1000
    let offset = 0
    while (true) {
      const { data } = await query
        .order('invoice_date', { ascending: true })
        .range(offset, offset + PAGE - 1)
      const batch = (data ?? []) as unknown as InvoiceRow[]
      allInvoices.push(...batch)
      if (batch.length < PAGE) break
      offset += PAGE
    }
  }

  // Area filter applied in-memory (joined column, same pattern as the
  // on-screen Invoices list's matchesArea()).
  const invoices = areaFilter.length
    ? allInvoices.filter(inv => !!inv.customers?.area && areaFilter.includes(inv.customers.area))
    : allInvoices

  // Sort by customer name for a predictable, alphabetical batch.
  invoices.sort((a, b) => (a.customers?.full_name ?? '').localeCompare(b.customers?.full_name ?? ''))

  if (invoices.length === 0) notFound()

  // Fetch all line items for these invoices in one paginated pass.
  const itemsByInvoice = new Map<string, ItemRow[]>()
  {
    const ids = invoices.map(i => i.id)
    const PAGE = 1000
    let offset = 0
    while (true) {
      const { data } = await admin
        .from('invoice_items')
        .select('id, invoice_id, description, quantity, unit_price, total_price')
        .in('invoice_id', ids)
        .order('id')
        .range(offset, offset + PAGE - 1)
      const batch = (data ?? []) as unknown as ItemRow[]
      for (const item of batch) {
        const list = itemsByInvoice.get(item.invoice_id)
        if (list) list.push(item)
        else itemsByInvoice.set(item.invoice_id, [item])
      }
      if (batch.length < PAGE) break
      offset += PAGE
    }
  }

  const vatRate  = parseFloat(String(settings.vat_percent ?? '5'))
  const currency = settings.currency || 'AED'
  const printDate = formatInTimeZone(new Date(), 'Asia/Dubai', 'dd MMM yyyy')
  const grandTotal = invoices.reduce((s, inv) => s + parseFloat(String(inv.total_amount)), 0)

  const filterLabel = [
    areaFilter.length ? areaFilter.join(', ') : null,
    fromDate && toDate ? (fromDate === toDate ? fmtLongDate(fromDate) : `${fmtLongDate(fromDate)} – ${fmtLongDate(toDate)}`) : null,
    statusFilter.length ? statusFilter.join(', ') : null,
  ].filter(Boolean).join(' · ')

  return (
    <div style={{ background: 'white', minHeight: '100vh', fontFamily: 'var(--font-sans)', color: '#221A13' }}>
      <BillPrintSetup />

      {/* ── Batch cover summary (screen + first printed page) ── */}
      <div style={{ padding: '24px 28px', maxWidth: 760, margin: '0 auto', fontSize: 13, lineHeight: 1.5 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, paddingBottom: 16, borderBottom: '3px solid #221A13' }}>
          <div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/Apna%20chulha%20logo%20brown.png" alt="Apna Chulha" style={{ height: 46, width: 'auto', display: 'block', marginBottom: 8 }} />
            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 21, fontWeight: 800, margin: '0 0 2px' }}>
              Invoice Batch
            </h1>
            <p style={{ fontSize: 11, color: '#7C7063', margin: 0 }}>
              {filterLabel || 'All invoices'}
            </p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <p style={{ fontSize: 11, color: '#7C7063' }}>Printed: {printDate}</p>
            <p style={{ fontSize: 11, color: '#7C7063', marginTop: 2 }}>{settings.business_name}</p>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
          <div style={{ background: '#FBF6EE', border: '1px solid #ECE2D3', borderRadius: 8, padding: '10px 14px' }}>
            <p style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: '#7C7063', margin: '0 0 3px' }}>
              Invoices
            </p>
            <p style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 18, margin: 0 }}>
              {invoices.length}
            </p>
          </div>
          <div style={{ background: '#FBF6EE', border: '1px solid #ECE2D3', borderRadius: 8, padding: '10px 14px' }}>
            <p style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: '#7C7063', margin: '0 0 3px' }}>
              Total Billed
            </p>
            <p style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 18, margin: 0 }}>
              {currency} {grandTotal.toFixed(2)}
            </p>
          </div>
        </div>
      </div>

      {/* ── One full tax invoice per customer, each its own printed page ── */}
      {invoices.map((invoice, idx) => {
        const customer = invoice.customers
        if (!customer) return null

        const total = parseFloat(String(invoice.total_amount))
        const { exclVAT, vatAmount } = extractVAT(total, vatRate)

        const billingPeriodStr = (() => {
          if (invoice.billing_period_start && invoice.billing_period_end) {
            const start = invoice.billing_period_start.substring(0, 7)
            const end = invoice.billing_period_end.substring(0, 7)
            if (start === end) return fmtMonth(start)
            return `${fmtLongDate(invoice.billing_period_start)} – ${fmtLongDate(invoice.billing_period_end)}`
          }
          return null
        })()

        const lineItems = (itemsByInvoice.get(invoice.id) ?? []).slice().sort((a, b) => {
          const ka = parseSortKey(a.description ?? '')
          const kb = parseSortKey(b.description ?? '')
          if (ka.date !== kb.date) return ka.date.localeCompare(kb.date)
          return ka.meal - kb.meal
        })

        return (
          <div
            key={invoice.id}
            style={{
              padding: '24px 28px',
              maxWidth: 760,
              margin: '0 auto',
              fontSize: 13,
              lineHeight: 1.5,
              breakInside: 'avoid',
              breakAfter: idx < invoices.length - 1 ? 'page' : 'auto',
            }}
          >
            {/* ── Document header ── */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, paddingBottom: 16, borderBottom: '3px solid #221A13' }}>
              <div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/Apna%20chulha%20logo%20brown.png" alt="Apna Chulha" style={{ height: 50, width: 'auto', display: 'block', marginBottom: 8 }} />
                <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 800, color: '#221A13', margin: '0 0 2px', letterSpacing: '-0.01em' }}>
                  TAX INVOICE
                </h1>
                <p style={{ fontSize: 11, color: '#7C7063', margin: 0 }}>
                  {TYPE_LABELS[invoice.invoice_type]}
                  {billingPeriodStr ? ` · ${billingPeriodStr}` : ''}
                </p>
              </div>

              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <p style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#7C7063', margin: '0 0 2px' }}>
                  Invoice #
                </p>
                <p style={{ fontSize: 15, fontWeight: 800, margin: '0 0 8px', fontFamily: 'var(--font-display)' }}>
                  {invoice.invoice_number}
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: '70px 1fr', columnGap: 8, rowGap: 3, fontSize: 11 }}>
                  <span style={{ color: '#7C7063', fontWeight: 600 }}>Date</span>
                  <span style={{ fontWeight: 700 }}>{fmtLongDate(invoice.invoice_date)}</span>
                  <span style={{ color: '#7C7063', fontWeight: 600 }}>Due</span>
                  <span style={{ fontWeight: 700 }}>{fmtLongDate(invoice.due_date)}</span>
                  <span style={{ color: '#7C7063', fontWeight: 600 }}>Status</span>
                  <span style={{ color: '#7C7063', textTransform: 'uppercase', fontSize: 10, fontWeight: 700 }}>{invoice.status}</span>
                </div>
              </div>
            </div>

            {/* ── Bill To ── */}
            <div style={{ marginBottom: 24, padding: '12px 16px', background: '#FBF6EE', borderRadius: 10, border: '1px solid #ECE2D3' }}>
              <p style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#7C7063', margin: '0 0 4px' }}>
                Bill To
              </p>
              <p style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 800, margin: '0 0 2px', letterSpacing: '-0.01em' }}>
                {customer.full_name}
              </p>
              <p style={{ fontSize: 11, color: '#7C7063', margin: 0 }}>
                {customer.customer_code}
                {customer.mobile_number ? ` · ${customer.mobile_number}` : ''}
                {customer.area ? ` · ${customer.area}` : ''}
                {customer.email ? ` · ${customer.email}` : ''}
              </p>
              {customer.delivery_address && (
                <p style={{ fontSize: 11, color: '#7C7063', margin: '3px 0 0' }}>
                  {customer.delivery_address}
                </p>
              )}
            </div>

            {/* ── Line items table ── */}
            {lineItems.length === 0 ? (
              <p style={{ color: '#7C7063', fontStyle: 'italic' }}>No line items on this invoice.</p>
            ) : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 60px 90px 90px', gap: 8, padding: '6px 0', borderBottom: '2px solid #221A13', fontWeight: 700, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#7C7063' }}>
                  <span>Description</span>
                  <span style={{ textAlign: 'right' }}>Qty</span>
                  <span style={{ textAlign: 'right' }}>Unit Price ({currency})</span>
                  <span style={{ textAlign: 'right' }}>Total ({currency})</span>
                </div>

                {lineItems.map(item => {
                  const qty = parseFloat(String(item.quantity))
                  const unitPrice = parseFloat(String(item.unit_price))
                  const lineTotal = parseFloat(String(item.total_price))
                  const displayQty = Number.isInteger(qty) ? qty : qty.toFixed(2)

                  return (
                    <div key={item.id} className="bill-line" style={{ display: 'grid', gridTemplateColumns: '1fr 60px 90px 90px', gap: 8, padding: '7px 0', borderBottom: '1px solid #ECE2D3', alignItems: 'center', fontSize: 12 }}>
                      <span style={{ fontWeight: 500 }}>{item.description}</span>
                      <span style={{ textAlign: 'right', fontWeight: 600, fontFamily: 'var(--font-display)' }}>{displayQty}</span>
                      <span style={{ textAlign: 'right', color: '#7C7063', fontFamily: 'var(--font-display)' }}>{unitPrice.toFixed(2)}</span>
                      <span style={{ textAlign: 'right', fontWeight: 700, fontFamily: 'var(--font-display)' }}>{lineTotal.toFixed(2)}</span>
                    </div>
                  )
                })}

                {/* ── Totals ── */}
                <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
                  <div style={{ width: 280 }}>
                    <Divider />
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: 12 }}>
                      <span style={{ color: '#7C7063' }}>Subtotal (excl. VAT)</span>
                      <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600 }}>{currency} {exclVAT.toFixed(2)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: 12 }}>
                      <span style={{ color: '#7C7063' }}>VAT {vatRate}% (included in prices)</span>
                      <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, color: '#7C7063' }}>{currency} {vatAmount.toFixed(2)}</span>
                    </div>
                    <Divider thick />
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                      <span style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 800 }}>TOTAL (VAT INCLUSIVE)</span>
                      <span style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 800 }}>{currency} {total.toFixed(2)}</span>
                    </div>
                    <Divider thick />
                  </div>
                </div>
              </>
            )}

            {/* ── Bank payment details ── */}
            <div style={{ marginTop: 28, padding: '14px 16px', borderRadius: 10, background: '#FBF6EE', border: '1px solid #ECE2D3' }}>
              <p style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#7C7063', margin: '0 0 8px' }}>
                Payment Details
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr', rowGap: 4, columnGap: 12, fontSize: 12 }}>
                <span style={{ color: '#7C7063', fontWeight: 600 }}>Account Name</span>
                <span style={{ fontWeight: 700 }}>{settings.bank_account_name}</span>
                <span style={{ color: '#7C7063', fontWeight: 600 }}>IBAN</span>
                <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, letterSpacing: '0.03em' }}>{settings.bank_iban}</span>
                <span style={{ color: '#7C7063', fontWeight: 600 }}>Bank</span>
                <span style={{ fontWeight: 700 }}>{settings.bank_name}</span>
              </div>
              <p style={{ marginTop: 8, fontSize: 11, color: '#7C7063' }}>
                Please quote <strong>{customer.customer_code}</strong> and invoice{' '}
                <strong>{invoice.invoice_number}</strong> as payment reference.
              </p>
            </div>

            {/* ── Footer ── */}
            <div style={{ marginTop: 24, textAlign: 'center', fontSize: 10, color: '#7C7063', paddingTop: 12, borderTop: '1px solid #ECE2D3' }}>
              {settings.business_name} · {settings.country} · Thank you for your business
            </div>
          </div>
        )
      })}
    </div>
  )
}
