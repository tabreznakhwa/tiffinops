import { notFound } from 'next/navigation'
import { formatInTimeZone } from 'date-fns-tz'
import { requireAuth } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { BillPrintSetup } from '@/components/bills/bill-print-setup'
import { monthToRange, formatMonthDisplay, formatLongDate, formatBillDate } from '@/lib/bills/utils'
import { getSettings, extractVAT } from '@/lib/settings/getSettings'
import type { Enums } from '@/lib/supabase/types'

type MealPeriod = Enums<'meal_period'>

const PERIOD_LABELS: Record<MealPeriod, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
}

const PLAN_LABELS: Record<string, string> = {
  a_la_carte: 'A La Carte',
  fixed_menu: 'Fixed Menu',
  hybrid: 'Hybrid',
}

// ── Divider ───────────────────────────────────────────────────────────────────

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

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function PrintBillPage({
  searchParams,
}: {
  searchParams: Promise<{ customer_id?: string; month?: string }>
}) {
  await requireAuth()

  const { customer_id, month } = await searchParams
  if (!customer_id) notFound()

  const now = new Date()
  const currentMonth = formatInTimeZone(now, 'Asia/Dubai', 'yyyy-MM')
  const activeMonth = month && /^\d{4}-\d{2}$/.test(month) ? month : currentMonth
  const printDate = formatInTimeZone(now, 'Asia/Dubai', 'yyyy-MM-dd')
  const { start, end } = monthToRange(activeMonth)

  const admin = createAdminClient()

  const [{ data: customer }, { data: rawOrders }, settings] = await Promise.all([
    admin.from('customers').select('*').eq('id', customer_id).single(),
    admin
      .from('orders')
      .select(`
        id, order_number, order_date, meal_period,
        subtotal, discount_amount, delivery_charge, total_amount, notes,
        order_items(id, item_name_snapshot, quantity, unit_price, total_price)
      `)
      .eq('customer_id', customer_id)
      .gte('order_date', start)
      .lt('order_date', end)
      .not('order_status', 'in', '(cancelled,voided,draft)')
      .eq('is_credit', true)
      .order('order_date', { ascending: true })
      .order('created_at', { ascending: true }),
    getSettings(),
  ])

  if (!customer) notFound()

  const vatRate = parseFloat(String(settings.vat_percent ?? '5'))
  const currency = settings.currency || 'AED'
  const orders = rawOrders ?? []
  const grandTotal = orders.reduce((s, o) => s + parseFloat(String(o.total_amount)), 0)
  const { exclVAT, vatAmount } = extractVAT(grandTotal, vatRate)

  // Period end date for display
  const [periodY, periodM] = activeMonth.split('-').map(Number)
  const lastDay = new Date(periodY, periodM, 0)
  const periodEndDisplay = formatLongDate(
    `${periodY}-${String(periodM).padStart(2, '0')}-${String(lastDay.getDate()).padStart(2, '0')}`
  )

  const businessName = settings.business_name

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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, paddingBottom: 16, borderBottom: '3px solid #221A13' }}>
        <div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/Apna%20chulha%20logo%20brown.png"
            alt="Apna Chulha"
            style={{ height: 50, width: 'auto', display: 'block', marginBottom: 8 }}
          />
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 800, color: '#221A13', margin: '0 0 3px', letterSpacing: '-0.02em' }}>
            A La Carte Bill
          </h1>
          <p style={{ fontSize: 13, fontWeight: 700, margin: '0 0 2px' }}>
            {formatMonthDisplay(activeMonth)}
          </p>
          {(settings.contact_phone || settings.contact_email) && (
            <p style={{ fontSize: 11, color: '#7C7063', margin: 0 }}>
              {[settings.contact_phone, settings.contact_email].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <p style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#7C7063', margin: '0 0 4px' }}>
            Bill Date
          </p>
          <p style={{ fontSize: 13, fontWeight: 700, margin: '0 0 8px' }}>
            {formatLongDate(printDate)}
          </p>
          <p style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#7C7063', margin: '0 0 4px' }}>
            Billing Period
          </p>
          <p style={{ fontSize: 12, fontWeight: 600, margin: 0 }}>
            {formatLongDate(start)} –
          </p>
          <p style={{ fontSize: 12, fontWeight: 600, margin: 0 }}>
            {periodEndDisplay}
          </p>
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
          {' · '}
          {PLAN_LABELS[customer.customer_type] ?? customer.customer_type}
          {customer.mobile_number ? ` · ${customer.mobile_number}` : ''}
          {customer.area ? ` · ${customer.area}` : ''}
        </p>
        {customer.delivery_address && (
          <p style={{ fontSize: 11, color: '#7C7063', margin: '3px 0 0' }}>
            {customer.delivery_address}
          </p>
        )}
      </div>

      {/* ── Line items ── */}
      {orders.length === 0 ? (
        <p style={{ color: '#7C7063', fontStyle: 'italic' }}>
          No orders found for this billing period.
        </p>
      ) : (
        <>
          {/* Column headers */}
          <div style={{ display: 'grid', gridTemplateColumns: '80px 90px 1fr 55px 70px 75px', gap: 4, padding: '6px 0', borderBottom: '2px solid #221A13', fontWeight: 700, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#7C7063' }}>
            <span>Date</span>
            <span>Period</span>
            <span>Item</span>
            <span style={{ textAlign: 'right' }}>Qty</span>
            <span style={{ textAlign: 'right' }}>Unit</span>
            <span style={{ textAlign: 'right' }}>Amount</span>
          </div>

          {/* Order rows — each order group */}
          {orders.map((order, oi) => {
            type OI = { id: string; item_name_snapshot: string; quantity: string; unit_price: string; total_price: string }
            const items = (order.order_items as unknown as OI[]) ?? []

            return (
              <div
                key={order.id}
                className="bill-line"
                style={{ borderBottom: '1px solid #ECE2D3' }}
              >
                {items.map((item, ii) => {
                  const qty = parseFloat(item.quantity)
                  const displayQty = Number.isInteger(qty) ? qty : qty.toFixed(1)
                  const unitPrice = parseFloat(String(item.unit_price))
                  const lineTotal = parseFloat(String(item.total_price))

                  return (
                    <div
                      key={item.id}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '80px 90px 1fr 55px 70px 75px',
                        gap: 4,
                        padding: '5px 0',
                        alignItems: 'center',
                      }}
                    >
                      {/* Date — only on first item of the order */}
                      <span style={{ fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 600, color: '#7C7063' }}>
                        {ii === 0 ? formatBillDate(order.order_date) : ''}
                      </span>
                      {/* Period — only on first item */}
                      <span style={{ fontSize: 10, fontWeight: 700, color: ii === 0 ? '#221A13' : 'transparent' }}>
                        {ii === 0 ? PERIOD_LABELS[order.meal_period as MealPeriod] : ''}
                      </span>
                      {/* Item name */}
                      <span style={{ fontSize: 12, color: '#221A13', fontWeight: 500 }}>
                        {item.item_name_snapshot}
                      </span>
                      {/* Qty */}
                      <span style={{ textAlign: 'right', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 12 }}>
                        {displayQty}
                      </span>
                      {/* Unit price */}
                      <span style={{ textAlign: 'right', fontFamily: 'var(--font-display)', fontSize: 11, color: '#7C7063' }}>
                        {unitPrice.toFixed(2)}
                      </span>
                      {/* Line total */}
                      <span style={{ textAlign: 'right', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 12 }}>
                        {lineTotal.toFixed(2)}
                      </span>
                    </div>
                  )
                })}

                {/* Order notes */}
                {order.notes && (
                  <div style={{ padding: '2px 0 5px', paddingLeft: 170, fontSize: 10, color: '#8B2E1F', fontWeight: 600 }}>
                    📌 {order.notes}
                  </div>
                )}
              </div>
            )
          })}

          {/* ── Totals ── */}
          <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
            <div style={{ width: 260 }}>
              <Divider />
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: 12 }}>
                <span style={{ color: '#7C7063' }}>
                  Subtotal ({orders.length} order{orders.length !== 1 ? 's' : ''})
                </span>
                <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600 }}>
                  {currency} {grandTotal.toFixed(2)}
                </span>
              </div>
              <Divider />

              {/* VAT breakdown */}
              <p style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#7C7063', margin: '4px 0 4px' }}>
                VAT Breakdown ({vatRate}% included in prices)
              </p>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', fontSize: 11 }}>
                <span style={{ color: '#7C7063' }}>Amount excl. VAT</span>
                <span style={{ fontFamily: 'var(--font-display)', color: '#7C7063' }}>
                  {currency} {exclVAT.toFixed(2)}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', fontSize: 11 }}>
                <span style={{ color: '#7C7063' }}>VAT ({vatRate}%)</span>
                <span style={{ fontFamily: 'var(--font-display)', color: '#7C7063' }}>
                  {currency} {vatAmount.toFixed(2)}
                </span>
              </div>

              <Divider thick />
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                <span style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 800 }}>
                  TOTAL DUE
                </span>
                <span style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 800 }}>
                  {currency} {grandTotal.toFixed(2)}
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
          Please quote <strong>{customer.customer_code}</strong> as payment reference.
        </p>
      </div>

      {/* ── Footer ── */}
      <div style={{ marginTop: 24, textAlign: 'center', fontSize: 10, color: '#7C7063', paddingTop: 12, borderTop: '1px solid #ECE2D3' }}>
        {businessName} · {formatMonthDisplay(activeMonth)} · {customer.full_name} ({customer.customer_code})
      </div>
    </div>
  )
}
