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

export default async function PrintInvoicePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireAuth()

  const { id } = await params
  if (!id) notFound()

  const admin = createAdminClient()

  const [settings, [{ data: invoice }, { data: items }]] = await Promise.all([
    getSettings(),
    Promise.all([
    admin
      .from('invoices')
      .select(`
        id, invoice_number, invoice_date, due_date,
        invoice_type, billing_period_start, billing_period_end,
        subtotal, discount_amount, tax_amount, total_amount,
        status, notes,
        customers(
          id, full_name, customer_code, mobile_number, area, email, delivery_address
        )
      `)
      .eq('id', id)
      .single(),
    admin
      .from('invoice_items')
      .select('id, description, quantity, unit_price, total_price, order_id')
      .eq('invoice_id', id)
      .order('id'),
    ]),
  ])

  if (!invoice) notFound()

  type Customer = {
    id: string
    full_name: string
    customer_code: string
    mobile_number: string
    area: string | null
    email: string | null
    delivery_address: string | null
  }

  const customer = invoice.customers as unknown as Customer | null
  if (!customer) notFound()

  const total = parseFloat(String(invoice.total_amount))
  const vatRate = parseFloat(String(settings.vat_percent ?? '5'))
  const currency = settings.currency || 'AED'
  const { exclVAT, vatAmount } = extractVAT(total, vatRate)

  const printDate = formatInTimeZone(new Date(), 'Asia/Dubai', 'dd MMM yyyy')

  // Billing period display
  const billingPeriodStr = (() => {
    if (invoice.billing_period_start && invoice.billing_period_end) {
      // If it spans a full month, show as month
      const start = invoice.billing_period_start.substring(0, 7)
      const end = invoice.billing_period_end.substring(0, 7)
      if (start === end) return fmtMonth(start)
      return `${fmtLongDate(invoice.billing_period_start)} – ${fmtLongDate(invoice.billing_period_end)}`
    }
    return null
  })()

  const lineItems = (items ?? []) as {
    id: string
    description: string
    quantity: string
    unit_price: string
    total_price: string
    order_id: string | null
  }[]

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

      {/* ── Document header ── */}
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
            style={{ height: 50, width: 'auto', display: 'block', marginBottom: 8 }}
          />
          <h1
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 22,
              fontWeight: 800,
              color: '#221A13',
              margin: '0 0 2px',
              letterSpacing: '-0.01em',
            }}
          >
            TAX INVOICE
          </h1>
          <p style={{ fontSize: 11, color: '#7C7063', margin: 0 }}>
            {TYPE_LABELS[invoice.invoice_type as InvoiceType]}
            {billingPeriodStr ? ` · ${billingPeriodStr}` : ''}
          </p>
        </div>

        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <p
            style={{
              fontSize: 10,
              fontWeight: 800,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: '#7C7063',
              margin: '0 0 2px',
            }}
          >
            Invoice #
          </p>
          <p style={{ fontSize: 15, fontWeight: 800, margin: '0 0 8px', fontFamily: 'var(--font-display)' }}>
            {invoice.invoice_number}
          </p>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '70px 1fr',
              columnGap: 8,
              rowGap: 3,
              fontSize: 11,
            }}
          >
            <span style={{ color: '#7C7063', fontWeight: 600 }}>Date</span>
            <span style={{ fontWeight: 700 }}>{fmtLongDate(invoice.invoice_date)}</span>
            <span style={{ color: '#7C7063', fontWeight: 600 }}>Due</span>
            <span style={{ fontWeight: 700 }}>{fmtLongDate(invoice.due_date)}</span>
            <span style={{ color: '#7C7063', fontWeight: 600 }}>Printed</span>
            <span style={{ color: '#7C7063' }}>{printDate}</span>
          </div>
        </div>
      </div>

      {/* ── Bill To ── */}
      <div
        style={{
          marginBottom: 24,
          padding: '12px 16px',
          background: '#FBF6EE',
          borderRadius: 10,
          border: '1px solid #ECE2D3',
        }}
      >
        <p
          style={{
            fontSize: 10,
            fontWeight: 800,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: '#7C7063',
            margin: '0 0 4px',
          }}
        >
          Bill To
        </p>
        <p
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 18,
            fontWeight: 800,
            margin: '0 0 2px',
            letterSpacing: '-0.01em',
          }}
        >
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
          {/* Column headers */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 60px 90px 90px',
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
            <span>Description</span>
            <span style={{ textAlign: 'right' }}>Qty</span>
            <span style={{ textAlign: 'right' }}>Unit Price ({currency})</span>
            <span style={{ textAlign: 'right' }}>Total ({currency})</span>
          </div>

          {lineItems.map((item, idx) => {
            const qty = parseFloat(String(item.quantity))
            const unitPrice = parseFloat(String(item.unit_price))
            const lineTotal = parseFloat(String(item.total_price))
            const displayQty = Number.isInteger(qty) ? qty : qty.toFixed(2)

            return (
              <div
                key={item.id}
                className="bill-line"
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 60px 90px 90px',
                  gap: 8,
                  padding: '7px 0',
                  borderBottom: '1px solid #ECE2D3',
                  alignItems: 'center',
                  fontSize: 12,
                }}
              >
                <span style={{ fontWeight: 500 }}>{item.description}</span>
                <span style={{ textAlign: 'right', fontWeight: 600, fontFamily: 'var(--font-display)' }}>
                  {displayQty}
                </span>
                <span style={{ textAlign: 'right', color: '#7C7063', fontFamily: 'var(--font-display)' }}>
                  {unitPrice.toFixed(2)}
                </span>
                <span style={{ textAlign: 'right', fontWeight: 700, fontFamily: 'var(--font-display)' }}>
                  {lineTotal.toFixed(2)}
                </span>
              </div>
            )
          })}

          {/* ── Totals ── */}
          <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
            <div style={{ width: 280 }}>
              <Divider />
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: 12 }}>
                <span style={{ color: '#7C7063' }}>Subtotal (excl. VAT)</span>
                <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600 }}>
                  {currency} {exclVAT.toFixed(2)}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: 12 }}>
                <span style={{ color: '#7C7063' }}>VAT {vatRate}% (included in prices)</span>
                <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, color: '#7C7063' }}>
                  {currency} {vatAmount.toFixed(2)}
                </span>
              </div>
              <Divider thick />
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                <span style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 800 }}>
                  TOTAL (VAT INCLUSIVE)
                </span>
                <span style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 800 }}>
                  {currency} {total.toFixed(2)}
                </span>
              </div>
              <Divider thick />
            </div>
          </div>
        </>
      )}

      {/* ── Bank payment details ── */}
      <div
        style={{
          marginTop: 28,
          padding: '14px 16px',
          borderRadius: 10,
          background: '#FBF6EE',
          border: '1px solid #ECE2D3',
        }}
      >
        <p
          style={{
            fontSize: 10,
            fontWeight: 800,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: '#7C7063',
            margin: '0 0 8px',
          }}
        >
          Payment Details
        </p>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '130px 1fr',
            rowGap: 4,
            columnGap: 12,
            fontSize: 12,
          }}
        >
          <span style={{ color: '#7C7063', fontWeight: 600 }}>Account Name</span>
          <span style={{ fontWeight: 700 }}>{settings.bank_account_name}</span>
          <span style={{ color: '#7C7063', fontWeight: 600 }}>IBAN</span>
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, letterSpacing: '0.03em' }}>
            {settings.bank_iban}
          </span>
          <span style={{ color: '#7C7063', fontWeight: 600 }}>Bank</span>
          <span style={{ fontWeight: 700 }}>{settings.bank_name}</span>
        </div>
        <p style={{ marginTop: 8, fontSize: 11, color: '#7C7063' }}>
          Please quote <strong>{customer.customer_code}</strong> and invoice{' '}
          <strong>{invoice.invoice_number}</strong> as payment reference.
        </p>
      </div>

      {/* ── Notes ── */}
      {invoice.notes && (
        <div style={{ marginTop: 20, padding: '10px 14px', borderRadius: 8, background: '#FFF8F0', border: '1px solid #ECE2D3' }}>
          <p style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#7C7063', margin: '0 0 4px' }}>
            Notes
          </p>
          <p style={{ fontSize: 12, color: '#221A13', margin: 0 }}>{invoice.notes}</p>
        </div>
      )}

      {/* ── Signature line ── */}
      <div
        style={{
          marginTop: 36,
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 32,
        }}
      >
        <div>
          <div style={{ borderBottom: '1px solid #221A13', marginBottom: 6 }} />
          <p style={{ fontSize: 10, color: '#7C7063', margin: 0 }}>Authorized Signature</p>
        </div>
        <div>
          <div style={{ borderBottom: '1px solid #221A13', marginBottom: 6 }} />
          <p style={{ fontSize: 10, color: '#7C7063', margin: 0 }}>Customer Signature / Stamp</p>
        </div>
      </div>

      {/* ── Footer ── */}
      <div
        style={{
          marginTop: 24,
          textAlign: 'center',
          fontSize: 10,
          color: '#7C7063',
          paddingTop: 12,
          borderTop: '1px solid #ECE2D3',
        }}
      >
        {settings.business_name} · {settings.country} · Thank you for your business
      </div>
    </div>
  )
}
