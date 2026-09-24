import { formatInTimeZone } from 'date-fns-tz'
import { requireAuth } from '@/lib/auth'
import { getSettings } from '@/lib/settings/getSettings'
import { loadDailyReportData } from '@/lib/daily-report/data'
import type { OrderRow } from '@/lib/daily-report/data'
import { BillPrintSetup } from '@/components/bills/bill-print-setup'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const PERIOD_ORDER = ['breakfast', 'lunch', 'dinner'] as const
const PERIOD_LABELS: Record<string, string> = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner' }

function itemTotalsFor(orders: OrderRow[]) {
  const map = new Map<string, number>()
  for (const o of orders) {
    for (const it of o.order_items ?? []) {
      const qty = parseFloat(String(it.quantity)) || 0
      map.set(it.item_name_snapshot, (map.get(it.item_name_snapshot) ?? 0) + qty)
    }
  }
  return [...map.entries()]
    .map(([name, quantity]) => ({ name, quantity }))
    .sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name))
}

// Item totals across the whole day, with the per-period split kept alongside
// — mirrors the on-screen "Item Totals — Whole Day" table.
function combinedItemTotalsFor(orders: OrderRow[]) {
  const map = new Map<string, { breakfast: number; lunch: number; dinner: number }>()
  for (const o of orders) {
    for (const it of o.order_items ?? []) {
      const qty = parseFloat(String(it.quantity)) || 0
      const row = map.get(it.item_name_snapshot) ?? { breakfast: 0, lunch: 0, dinner: 0 }
      row[o.meal_period] += qty
      map.set(it.item_name_snapshot, row)
    }
  }
  return [...map.entries()]
    .map(([name, row]) => ({ name, ...row, total: row.breakfast + row.lunch + row.dinner }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
}

function fmtQty(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(2)
}

function WholeDayItemTotals({ orders }: { orders: OrderRow[] }) {
  const items = combinedItemTotalsFor(orders)
  if (items.length === 0) return null
  const totalPieces = items.reduce((s, i) => s + i.total, 0)

  return (
    <div style={{ marginBottom: 24, breakInside: 'avoid' }}>
      <div
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          paddingBottom: 8, borderBottom: '2.5px solid #221A13', marginBottom: 10,
        }}
      >
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 800, color: '#221A13', margin: 0, textTransform: 'uppercase', letterSpacing: '.04em' }}>
          Item Totals — Whole Day
        </h2>
        <span style={{ fontSize: 12, color: '#7C7063', fontWeight: 600 }}>
          {items.length} item{items.length !== 1 ? 's' : ''} · {fmtQty(totalPieces)} pc combined
        </span>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', border: '1.5px solid #221A13', borderRadius: 6, fontSize: 12 }}>
        <thead>
          <tr style={{ background: '#F5EDE0' }}>
            <th style={{ textAlign: 'left', padding: '5px 10px', fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.06em', color: '#221A13', borderBottom: '1.5px solid #221A13' }}>Item</th>
            <th style={{ textAlign: 'right', padding: '5px 10px', fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.06em', color: '#221A13', borderBottom: '1.5px solid #221A13' }}>Breakfast</th>
            <th style={{ textAlign: 'right', padding: '5px 10px', fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.06em', color: '#221A13', borderBottom: '1.5px solid #221A13' }}>Lunch</th>
            <th style={{ textAlign: 'right', padding: '5px 10px', fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.06em', color: '#221A13', borderBottom: '1.5px solid #221A13' }}>Dinner</th>
            <th style={{ textAlign: 'right', padding: '5px 10px', fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.06em', color: '#221A13', borderBottom: '1.5px solid #221A13' }}>Total</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) => (
            <tr key={it.name} style={{ borderTop: i === 0 ? undefined : '1px solid #ECE2D3' }}>
              <td style={{ padding: '4px 10px', color: '#221A13' }}>{it.name}</td>
              <td style={{ textAlign: 'right', padding: '4px 10px', color: it.breakfast ? '#221A13' : '#ECE2D3' }}>{it.breakfast ? fmtQty(it.breakfast) : '—'}</td>
              <td style={{ textAlign: 'right', padding: '4px 10px', color: it.lunch ? '#221A13' : '#ECE2D3' }}>{it.lunch ? fmtQty(it.lunch) : '—'}</td>
              <td style={{ textAlign: 'right', padding: '4px 10px', color: it.dinner ? '#221A13' : '#ECE2D3' }}>{it.dinner ? fmtQty(it.dinner) : '—'}</td>
              <td style={{ textAlign: 'right', padding: '4px 10px', fontWeight: 800, color: '#221A13' }}>{fmtQty(it.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function PeriodSection({
  period, orders, fixedMenuCount,
}: {
  period: string
  orders: OrderRow[]
  fixedMenuCount: number
}) {
  const items = itemTotalsFor(orders)
  const itemPieces = items.reduce((s, i) => s + i.quantity, 0)
  const revenue = orders.reduce((s, o) => s + (parseFloat(o.total_amount) || 0), 0)

  return (
    <div className="period-section" style={{ marginBottom: 24, breakInside: 'avoid' }}>
      <div
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          paddingBottom: 8, borderBottom: '2.5px solid #221A13', marginBottom: 10,
        }}
      >
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 800, color: '#221A13', margin: 0, textTransform: 'uppercase', letterSpacing: '.04em' }}>
          {PERIOD_LABELS[period] ?? period}
        </h2>
        <span style={{ fontSize: 12, color: '#7C7063', fontWeight: 600 }}>
          {orders.length} à la carte order{orders.length !== 1 ? 's' : ''} · AED {revenue.toFixed(2)} · {fixedMenuCount} fixed-menu meal{fixedMenuCount !== 1 ? 's' : ''}
        </span>
      </div>

      {items.length === 0 ? (
        <p style={{ fontSize: 12.5, color: '#7C7063', margin: '4px 0 0' }}>No à la carte items this period.</p>
      ) : (
        <div style={{ border: '1.5px solid #221A13', borderRadius: 6 }}>
          <div
            style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
              padding: '5px 10px', background: '#F5EDE0', borderBottom: '1.5px solid #221A13',
            }}
          >
            <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: '#221A13' }}>
              Item Totals
            </span>
            <span style={{ fontSize: 10.5, color: '#7C7063', fontWeight: 600 }}>
              {items.length} item{items.length !== 1 ? 's' : ''} · {itemPieces} piece{itemPieces !== 1 ? 's' : ''}
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)' }}>
            {items.map((it, i) => (
              <div
                key={it.name}
                style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8,
                  padding: '4px 10px',
                  borderRight: (i % 3) < 2 ? '1px solid #ECE2D3' : undefined,
                  borderBottom: i < items.length - (items.length % 3 || 3) ? '1px solid #ECE2D3' : undefined,
                  fontSize: 12,
                }}
              >
                <span style={{ color: '#221A13' }}>{it.name}</span>
                <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 14, color: '#221A13' }}>
                  {Number.isInteger(it.quantity) ? it.quantity : it.quantity.toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default async function PrintDailyReportPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>
}) {
  await requireAuth()

  const { date } = await searchParams
  const now = new Date()
  const todayDubai = formatInTimeZone(now, 'Asia/Dubai', 'yyyy-MM-dd')
  const reportDate = date && DATE_RE.test(date) ? date : todayDubai

  const [settings, { orders, fixedMenuCounts }] = await Promise.all([
    getSettings(),
    loadDailyReportData(reportDate),
  ])

  const byPeriod = PERIOD_ORDER.reduce((acc, p) => {
    acc[p] = orders.filter(o => o.meal_period === p)
    return acc
  }, {} as Record<string, OrderRow[]>)

  const reportDateDisplay = (() => {
    const d = new Date(reportDate + 'T00:00:00Z')
    return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  })()
  const printTime = formatInTimeZone(now, 'Asia/Dubai', 'h:mm a')

  const totalOrders = orders.length
  const totalRevenue = orders.reduce((s, o) => s + (parseFloat(o.total_amount) || 0), 0)
  const totalFixedMenu: number = fixedMenuCounts.breakfast + fixedMenuCounts.lunch + fixedMenuCounts.dinner

  return (
    <div style={{ background: 'white', minHeight: '100vh', padding: '24px 28px', maxWidth: 760, margin: '0 auto', fontFamily: 'var(--font-sans)' }}>
      <BillPrintSetup />

      <div style={{ marginBottom: 20, paddingBottom: 16, borderBottom: '3px solid #221A13' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/Apna%20chulha%20logo%20brown.png" alt="Apna Chulha" style={{ height: 46, width: 'auto', display: 'block', marginBottom: 6 }} />
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 800, color: '#221A13', margin: '0 0 4px', letterSpacing: '-0.02em' }}>
          Daily Report
        </h1>
        <p style={{ fontSize: 15, color: '#221A13', fontWeight: 700, margin: '0 0 3px' }}>{reportDateDisplay}</p>
        <p style={{ fontSize: 12, color: '#7C7063', margin: 0 }}>
          {totalOrders} à la carte order{totalOrders !== 1 ? 's' : ''} · {settings.currency} {totalRevenue.toFixed(2)} · {totalFixedMenu} fixed-menu meal{totalFixedMenu !== 1 ? 's' : ''} · Printed at {printTime}
        </p>
        <p style={{ fontSize: 11, color: '#7C7063', margin: '6px 0 0', fontStyle: 'italic' }}>
          Fixed-menu counts are a headcount per period, not broken down by dish.
        </p>
      </div>

      <WholeDayItemTotals orders={orders} />

      {PERIOD_ORDER.map(period => (
        <PeriodSection key={period} period={period} orders={byPeriod[period]} fixedMenuCount={fixedMenuCounts[period]} />
      ))}

      <div style={{ marginTop: 28, paddingTop: 12, borderTop: '1px solid #ECE2D3', textAlign: 'center', fontSize: 11, color: '#7C7063' }}>
        End of daily report · {reportDateDisplay}
      </div>
    </div>
  )
}
