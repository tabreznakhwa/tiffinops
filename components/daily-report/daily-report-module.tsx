'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight, Printer, Search, Sunrise, Sun, Moon } from 'lucide-react'
import { useAppSettings } from '@/components/settings/settings-context'

export type OrderItemRow = { id: string; item_name_snapshot: string; quantity: string; total_price: string }
export type OrderRow = {
  id: string
  meal_period: 'breakfast' | 'lunch' | 'dinner'
  order_status: string
  total_amount: string
  order_items: OrderItemRow[]
}
export type FixedMenuCounts = { breakfast: number; lunch: number; dinner: number }

const PERIODS: { value: 'breakfast' | 'lunch' | 'dinner'; label: string; icon: typeof Sunrise; color: string; bg: string }[] = [
  { value: 'breakfast', label: 'Breakfast', icon: Sunrise, color: 'var(--color-gold)',   bg: '#FEF3C7' },
  { value: 'lunch',     label: 'Lunch',     icon: Sun,     color: 'var(--color-ember)',  bg: 'var(--color-saffron-soft)' },
  { value: 'dinner',    label: 'Dinner',    icon: Moon,    color: 'var(--color-purple)', bg: 'var(--color-purple-soft)' },
]

function shiftDate(dateStr: string, days: number) {
  const d = new Date(dateStr + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function formatDisplayDate(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00Z')
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
}

// Item totals for one meal period's orders — same aggregation Packing uses.
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

// Item totals across the whole day — same items, summed across all three
// meal periods, with the per-period split kept alongside so e.g. "how much
// pulao went into lunch vs dinner" is answered in the same row as the total.
function combinedItemTotals(orders: OrderRow[]) {
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
  const [query, setQuery] = useState('')
  const items = useMemo(() => combinedItemTotals(orders), [orders])
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter(it => it.name.toLowerCase().includes(q))
  }, [items, query])
  const totalPieces = items.reduce((s, i) => s + i.total, 0)

  return (
    <div
      className="rounded-[14px] overflow-hidden mb-5"
      style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}
    >
      <div className="px-4 py-3 flex items-center justify-between gap-3 flex-wrap" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <div>
          <span className="font-display font-bold text-[16px]" style={{ color: 'var(--color-ink)' }}>Item Totals — Whole Day</span>
          {items.length > 0 && (
            <span className="text-[11px] ml-2" style={{ color: 'var(--color-muted)' }}>
              {items.length} item{items.length !== 1 ? 's' : ''} · {fmtQty(totalPieces)} pc combined
            </span>
          )}
        </div>
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-muted)' }} />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Find an item…"
            className="text-sm pl-7 pr-3 py-1.5 rounded-[10px] outline-none"
            style={{ border: '1px solid var(--color-border)', color: 'var(--color-ink)', width: 180 }}
          />
        </div>
      </div>

      {items.length === 0 ? (
        <p className="text-sm py-6 text-center" style={{ color: 'var(--color-muted)' }}>No à la carte items today</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm py-6 text-center" style={{ color: 'var(--color-muted)' }}>No item matches &quot;{query}&quot;</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: 'var(--color-cream)' }}>
                <th className="text-left px-4 py-2 text-[10.5px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>Item</th>
                <th className="text-right px-3 py-2 text-[10.5px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>Breakfast</th>
                <th className="text-right px-3 py-2 text-[10.5px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>Lunch</th>
                <th className="text-right px-3 py-2 text-[10.5px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>Dinner</th>
                <th className="text-right px-4 py-2 text-[10.5px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((it, i) => (
                <tr key={it.name} style={{ borderTop: i === 0 ? undefined : '1px solid var(--color-border)' }}>
                  <td className="px-4 py-2" style={{ color: 'var(--color-ink)' }}>{it.name}</td>
                  <td className="text-right px-3 py-2 num" style={{ color: it.breakfast ? 'var(--color-ink)' : 'var(--color-border)' }}>{it.breakfast ? fmtQty(it.breakfast) : '—'}</td>
                  <td className="text-right px-3 py-2 num" style={{ color: it.lunch ? 'var(--color-ink)' : 'var(--color-border)' }}>{it.lunch ? fmtQty(it.lunch) : '—'}</td>
                  <td className="text-right px-3 py-2 num" style={{ color: it.dinner ? 'var(--color-ink)' : 'var(--color-border)' }}>{it.dinner ? fmtQty(it.dinner) : '—'}</td>
                  <td className="text-right px-4 py-2 num font-bold" style={{ color: 'var(--color-ember)' }}>{fmtQty(it.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function PeriodCard({
  label, color, bg, Icon, orders, fixedMenuCount, currency,
}: {
  label: string; color: string; bg: string; Icon: typeof Sunrise
  orders: OrderRow[]; fixedMenuCount: number; currency: string
}) {
  const orderCount = orders.length
  const revenue = orders.reduce((s, o) => s + (parseFloat(o.total_amount) || 0), 0)
  const items = useMemo(() => itemTotalsFor(orders), [orders])
  const itemPieces = items.reduce((s, i) => s + i.quantity, 0)

  return (
    <div
      className="rounded-[14px] overflow-hidden flex flex-col"
      style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}
    >
      {/* Header */}
      <div className="px-4 py-3 flex items-center gap-2.5" style={{ background: bg }}>
        <Icon size={17} style={{ color }} />
        <span className="font-display font-bold text-[16px]" style={{ color: 'var(--color-ink)' }}>{label}</span>
      </div>

      {/* Headline numbers */}
      <div className="px-4 py-3 grid grid-cols-2 gap-3" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>À la carte orders</p>
          <p className="font-display font-extrabold text-[20px] num" style={{ color: 'var(--color-ink)' }}>{orderCount}</p>
          <p className="text-[11px]" style={{ color: 'var(--color-muted)' }}>{currency} {revenue.toFixed(2)}</p>
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>Fixed-menu meals</p>
          <p className="font-display font-extrabold text-[20px] num" style={{ color }}>{fixedMenuCount}</p>
          <p className="text-[11px]" style={{ color: 'var(--color-muted)' }}>headcount, not by dish</p>
        </div>
      </div>

      {/* Item totals — the actual "what to cook" list, à la carte + hybrid extras only */}
      <div className="px-4 py-3 flex-1">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-ink)' }}>Item totals</span>
          {items.length > 0 && (
            <span className="text-[11px]" style={{ color: 'var(--color-muted)' }}>
              {items.length} item{items.length !== 1 ? 's' : ''} · {itemPieces} pc
            </span>
          )}
        </div>
        {items.length === 0 ? (
          <p className="text-sm py-4 text-center" style={{ color: 'var(--color-muted)' }}>No à la carte items this period</p>
        ) : (
          <div className="space-y-1.5">
            {items.map((it, i) => (
              <div key={it.name} className="flex items-center justify-between gap-2">
                <span className="text-sm truncate" style={{ color: 'var(--color-ink)' }}>
                  <span className="text-[10px] mr-1.5" style={{ color: 'var(--color-muted)' }}>{i + 1}</span>
                  {it.name}
                </span>
                <span className="num font-bold text-sm flex-shrink-0" style={{ color: 'var(--color-ember)' }}>
                  {Number.isInteger(it.quantity) ? it.quantity : it.quantity.toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export function DailyReportModule({
  orders, fixedMenuCounts, reportDate, todayDubai,
}: {
  orders: OrderRow[]
  fixedMenuCounts: FixedMenuCounts
  reportDate: string
  todayDubai: string
}) {
  const router = useRouter()
  const { currency } = useAppSettings()
  const isToday = reportDate === todayDubai

  const byPeriod = useMemo(() => {
    const map: Record<string, OrderRow[]> = { breakfast: [], lunch: [], dinner: [] }
    for (const o of orders) {
      if (map[o.meal_period]) map[o.meal_period].push(o)
    }
    return map
  }, [orders])

  const totalOrders = orders.length
  const totalRevenue = orders.reduce((s, o) => s + (parseFloat(o.total_amount) || 0), 0)
  const totalFixedMenu = fixedMenuCounts.breakfast + fixedMenuCounts.lunch + fixedMenuCounts.dinner

  return (
    <div>
      {/* Page header */}
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--color-saffron)', letterSpacing: '.12em' }}>
            Kitchen
          </p>
          <h1 className="font-display font-bold text-[25px] mt-0.5" style={{ color: 'var(--color-ink)' }}>
            Daily Report
          </h1>
        </div>
        <button
          onClick={() => window.open(`/print/daily-report?date=${reportDate}`, '_blank', 'noopener,noreferrer')}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] text-sm font-semibold transition-colors hover:bg-cream flex-shrink-0 mt-1"
          style={{ color: 'var(--color-muted)', border: '1px solid var(--color-border)' }}
          title="Print daily report"
        >
          <Printer size={14} />
          Print
        </button>
      </div>

      {/* Date navigation */}
      <div
        className="flex items-center justify-between gap-2 mb-5 rounded-[14px] px-3 py-2.5"
        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}
      >
        <button
          onClick={() => router.push(`/daily-report?date=${shiftDate(reportDate, -1)}`)}
          className="h-9 w-9 flex items-center justify-center rounded-full transition-colors hover:bg-cream flex-shrink-0"
          style={{ color: 'var(--color-muted)' }}
          aria-label="Previous day"
        >
          <ChevronLeft size={20} />
        </button>

        <div className="text-center flex-1">
          <p className="font-bold text-sm" style={{ color: 'var(--color-ink)' }}>{formatDisplayDate(reportDate)}</p>
          {!isToday && (
            <button onClick={() => router.push('/daily-report')} className="text-xs font-bold mt-0.5" style={{ color: 'var(--color-saffron)' }}>
              Back to Today
            </button>
          )}
          {isToday && <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>Today</p>}
        </div>

        <button
          onClick={() => router.push(`/daily-report?date=${shiftDate(reportDate, 1)}`)}
          className="h-9 w-9 flex items-center justify-center rounded-full transition-colors hover:bg-cream flex-shrink-0"
          style={{ color: 'var(--color-muted)' }}
          aria-label="Next day"
        >
          <ChevronRight size={20} />
        </button>
      </div>

      {/* Day summary strip */}
      <div className="grid gap-3 mb-5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
        <div className="rounded-[14px] px-4 py-3" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}>
          <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>À la carte orders</p>
          <p className="font-display font-extrabold text-[22px] num" style={{ color: 'var(--color-ink)' }}>{totalOrders}</p>
          <p className="text-[11px]" style={{ color: 'var(--color-muted)' }}>{currency} {totalRevenue.toFixed(2)}</p>
        </div>
        <div className="rounded-[14px] px-4 py-3" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}>
          <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>Fixed-menu meals</p>
          <p className="font-display font-extrabold text-[22px] num" style={{ color: 'var(--color-saffron)' }}>{totalFixedMenu}</p>
          <p className="text-[11px]" style={{ color: 'var(--color-muted)' }}>across all periods</p>
        </div>
      </div>

      {/* Fixed-menu note */}
      <div
        className="rounded-[12px] px-4 py-2.5 mb-5 text-xs"
        style={{ background: 'var(--color-saffron-soft)', color: 'var(--color-ember)', border: '1px solid var(--color-border)' }}
      >
        Fixed-menu counts are a headcount per period, not broken down by dish — the system doesn&apos;t record which
        dish a fixed-menu subscriber gets on a given day.
      </div>

      {/* Whole-day item totals — same items, summed across all three periods */}
      <WholeDayItemTotals orders={orders} />

      {/* Per-period cards */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {PERIODS.map(p => (
          <PeriodCard
            key={p.value}
            label={p.label}
            color={p.color}
            bg={p.bg}
            Icon={p.icon}
            orders={byPeriod[p.value] ?? []}
            fixedMenuCount={fixedMenuCounts[p.value]}
            currency={currency}
          />
        ))}
      </div>
    </div>
  )
}
