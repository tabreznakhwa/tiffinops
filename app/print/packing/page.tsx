import { formatInTimeZone } from 'date-fns-tz'
import { requireAuth } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { PrintPageSetup } from '@/components/packing/print-page-setup'
import type { OrderWithDetails } from '@/components/packing/packing-module'

// ── Status labels shown on the print sheet ────────────────────────────────────

const STATUS_LABELS: Record<string, { text: string; bg: string; color: string }> = {
  confirmed:        { text: 'NEW',     bg: '#FBE7D5', color: '#8B2E1F' },
  preparing:        { text: 'PACKING', bg: '#E7EEF6', color: '#2C5E8F' },
  out_for_delivery: { text: 'READY',   bg: '#E2F0E6', color: '#2E7D4F' },
  delivered:        { text: 'DONE',    bg: '#ECE2D3', color: '#7C7063' },
}

// ── Order ticket ──────────────────────────────────────────────────────────────

function OrderTicket({
  order,
  index,
}: {
  order: OrderWithDetails
  index: number
}) {
  const statusCfg = STATUS_LABELS[order.order_status] ?? STATUS_LABELS.delivered

  return (
    <div
      className="order-card"
      style={{
        padding: '14px 0 14px',
        borderBottom: '1px solid #ECE2D3',
      }}
    >
      {/* Ticket header row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 12,
          marginBottom: 10,
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
            {/* Index + name */}
            <span
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 18,
                fontWeight: 800,
                color: '#221A13',
                letterSpacing: '-0.02em',
              }}
            >
              #{index}&nbsp; {order.customers?.full_name ?? '—'}
            </span>
            {/* Status badge */}
            <span
              style={{
                fontSize: 9,
                fontWeight: 800,
                letterSpacing: '0.08em',
                padding: '2px 7px',
                borderRadius: 4,
                background: statusCfg.bg,
                color: statusCfg.color,
                whiteSpace: 'nowrap',
              }}
            >
              {statusCfg.text}
            </span>
          </div>
          {order.customers?.area && (
            <p style={{ fontSize: 11, color: '#7C7063', margin: 0, fontWeight: 500 }}>
              📍 {order.customers.area}
            </p>
          )}
          {order.customers?.delivery_address && (
            <p
              style={{
                fontSize: 11,
                color: '#7C7063',
                margin: '2px 0 0',
                maxWidth: 340,
                lineHeight: 1.4,
              }}
            >
              {order.customers.delivery_address}
            </p>
          )}
        </div>
        {/* Order number */}
        <p
          style={{
            fontSize: 10,
            color: '#7C7063',
            fontFamily: 'var(--font-display)',
            fontWeight: 600,
            margin: 0,
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
        >
          {order.order_number}
        </p>
      </div>

      {/* Items */}
      <div style={{ paddingLeft: 8 }}>
        {order.order_items.map((item) => {
          const qty = parseFloat(item.quantity)
          const displayQty = Number.isInteger(qty) ? qty : qty.toFixed(1)
          return (
            <div
              key={item.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '5px 0',
                borderBottom: '1px dotted #ECE2D3',
                gap: 8,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {/* Checkbox square */}
                <span
                  style={{
                    display: 'inline-block',
                    width: 14,
                    height: 14,
                    border: '1.5px solid #221A13',
                    borderRadius: 2,
                    flexShrink: 0,
                  }}
                />
                <span style={{ fontSize: 13, color: '#221A13', fontWeight: 500 }}>
                  {item.item_name_snapshot}
                </span>
              </div>
              <span
                style={{
                  fontSize: 14,
                  fontWeight: 800,
                  color: '#221A13',
                  fontFamily: 'var(--font-display)',
                  flexShrink: 0,
                }}
              >
                ×{displayQty}
              </span>
            </div>
          )
        })}
      </div>

      {/* Notes */}
      {order.notes && (
        <div
          style={{
            marginTop: 8,
            marginLeft: 22,
            padding: '5px 10px',
            borderRadius: 6,
            background: '#FBE7D5',
            fontSize: 12,
            color: '#8B2E1F',
            fontWeight: 600,
            border: '1px solid #E76F2A',
          }}
        >
          📌 {order.notes}
        </div>
      )}
    </div>
  )
}

// ── Period section ────────────────────────────────────────────────────────────

const PERIOD_LABELS: Record<string, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
}

function PeriodSection({
  period,
  orders,
}: {
  period: string
  orders: OrderWithDetails[]
}) {
  if (orders.length === 0) return null

  // Sort: new first, then packing, ready, done
  const SORT: Record<string, number> = {
    confirmed: 0,
    preparing: 1,
    out_for_delivery: 2,
    delivered: 3,
  }
  const sorted = [...orders].sort(
    (a, b) => (SORT[a.order_status] ?? 9) - (SORT[b.order_status] ?? 9)
  )

  return (
    <div className="period-section" style={{ marginBottom: 28 }}>
      {/* Section heading */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          paddingBottom: 8,
          borderBottom: '2.5px solid #221A13',
          marginBottom: 4,
        }}
      >
        <h2
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 15,
            fontWeight: 800,
            color: '#221A13',
            margin: 0,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
          }}
        >
          {PERIOD_LABELS[period] ?? period}
        </h2>
        <span style={{ fontSize: 12, color: '#7C7063', fontWeight: 600 }}>
          {orders.length} order{orders.length !== 1 ? 's' : ''}
        </span>
      </div>

      {sorted.map((order, idx) => (
        <OrderTicket key={order.id} order={order} index={idx + 1} />
      ))}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

const PERIOD_ORDER = ['breakfast', 'lunch', 'dinner'] as const

export default async function PrintPackingPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>
}) {
  await requireAuth()

  const { date } = await searchParams
  const now = new Date()
  const todayDubai = formatInTimeZone(now, 'Asia/Dubai', 'yyyy-MM-dd')
  const packDate =
    date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : todayDubai

  const admin = createAdminClient()

  const { data: rawOrders } = await admin
    .from('orders')
    .select(`
      id, order_number, meal_period, order_status, total_amount, notes, created_at,
      customers(id, full_name, customer_code, area, delivery_address),
      order_items(id, item_name_snapshot, quantity, total_price)
    `)
    .eq('order_date', packDate)
    .in('order_status', ['confirmed', 'preparing', 'out_for_delivery', 'delivered'])
    .order('created_at', { ascending: true })

  const orders = (rawOrders ?? []) as unknown as OrderWithDetails[]

  // Format date for display
  const packDateDisplay = (() => {
    const d = new Date(packDate + 'T00:00:00Z')
    return d.toLocaleDateString('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })
  })()

  const printTime = formatInTimeZone(now, 'Asia/Dubai', 'h:mm a')

  const byPeriod = PERIOD_ORDER.reduce(
    (acc, p) => {
      acc[p] = orders.filter((o) => o.meal_period === p)
      return acc
    },
    {} as Record<string, OrderWithDetails[]>
  )

  const totalOrders = orders.length
  const periodCounts = PERIOD_ORDER.map((p) => `${PERIOD_LABELS[p]}: ${byPeriod[p].length}`)

  return (
    <div
      style={{
        background: 'white',
        minHeight: '100vh',
        padding: '24px 28px',
        maxWidth: 760,
        margin: '0 auto',
        fontFamily: 'var(--font-sans)',
      }}
    >
      <PrintPageSetup />

      {/* Document header */}
      <div
        style={{
          marginBottom: 24,
          paddingBottom: 16,
          borderBottom: '3px solid #221A13',
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/Apna%20chulha%20logo%20brown.png"
          alt="Apna Chulha"
          style={{ height: 46, width: 'auto', display: 'block', marginBottom: 6 }}
        />
        <h1
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 28,
            fontWeight: 800,
            color: '#221A13',
            margin: '0 0 4px',
            letterSpacing: '-0.02em',
          }}
        >
          Packing List
        </h1>
        <p
          style={{
            fontSize: 15,
            color: '#221A13',
            fontWeight: 700,
            margin: '0 0 3px',
          }}
        >
          {packDateDisplay}
        </p>
        <p style={{ fontSize: 12, color: '#7C7063', margin: 0 }}>
          {totalOrders} order{totalOrders !== 1 ? 's' : ''} ·{' '}
          {periodCounts.join(' · ')} · Printed at {printTime}
        </p>
      </div>

      {/* Empty state */}
      {totalOrders === 0 && (
        <p style={{ color: '#7C7063', fontSize: 14 }}>
          No orders for {packDateDisplay}.
        </p>
      )}

      {/* Period sections */}
      {PERIOD_ORDER.map((period) => (
        <PeriodSection key={period} period={period} orders={byPeriod[period]} />
      ))}

      {/* Footer */}
      {totalOrders > 0 && (
        <div
          style={{
            marginTop: 32,
            paddingTop: 12,
            borderTop: '1px solid #ECE2D3',
            textAlign: 'center',
            fontSize: 11,
            color: '#7C7063',
          }}
        >
          End of packing list · {totalOrders} order{totalOrders !== 1 ? 's' : ''} ·{' '}
          {packDateDisplay}
        </div>
      )}
    </div>
  )
}
