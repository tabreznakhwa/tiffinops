'use client'

import { useState, useTransition, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight, Printer, RefreshCw } from 'lucide-react'
import { advanceOrderStatus } from '@/lib/packing/actions'
import type { Enums } from '@/lib/supabase/types'

type MealPeriod = Enums<'meal_period'>

export type OrderWithDetails = {
  id: string
  order_number: string
  meal_period: MealPeriod
  order_status: Enums<'order_status'>
  total_amount: string
  notes: string | null
  created_at: string
  customers: {
    id: string
    full_name: string
    customer_code: string
    area: string | null
    delivery_address: string | null
  } | null
  order_items: Array<{
    id: string
    item_name_snapshot: string
    quantity: string
    total_price: string
  }>
}

// ── Config ────────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<
  string,
  { label: string; bg: string; color: string; actionLabel: string | null; actionBg: string | null }
> = {
  confirmed: {
    label: 'New Order',
    bg: 'var(--color-saffron-soft)',
    color: 'var(--color-ember)',
    actionLabel: 'Start Packing',
    actionBg: 'var(--color-saffron)',
  },
  preparing: {
    label: 'Packing',
    bg: 'var(--color-blue-soft)',
    color: 'var(--color-blue)',
    actionLabel: 'Mark Ready',
    actionBg: 'var(--color-blue)',
  },
  out_for_delivery: {
    label: 'Ready',
    bg: 'var(--color-green-soft)',
    color: 'var(--color-green)',
    actionLabel: 'Mark Delivered',
    actionBg: 'var(--color-green)',
  },
  delivered: {
    label: 'Delivered',
    bg: 'var(--color-border)',
    color: 'var(--color-muted)',
    actionLabel: null,
    actionBg: null,
  },
}

const STATUS_SORT: Record<string, number> = {
  confirmed: 0,
  preparing: 1,
  out_for_delivery: 2,
  delivered: 3,
}

const PERIODS: { value: MealPeriod; label: string }[] = [
  { value: 'breakfast', label: 'Breakfast' },
  { value: 'lunch', label: 'Lunch' },
  { value: 'dinner', label: 'Dinner' },
]

// ── Date helpers ──────────────────────────────────────────────────────────────

function shiftDate(dateStr: string, days: number) {
  const d = new Date(dateStr + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function formatDisplayDate(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00Z')
  return d.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

// ── Order card ────────────────────────────────────────────────────────────────

function OrderCard({ order }: { order: OrderWithDetails }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const cfg = STATUS_CONFIG[order.order_status] ?? STATUS_CONFIG.delivered
  const isDelivered = order.order_status === 'delivered'

  function handleAdvance() {
    setError(null)
    startTransition(async () => {
      const result = await advanceOrderStatus(order.id)
      if (result.error) setError(result.error)
      else router.refresh()
    })
  }

  return (
    <div
      className="rounded-[16px] overflow-hidden flex flex-col transition-opacity"
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        boxShadow: isDelivered ? 'none' : 'var(--shadow-card)',
        opacity: isDelivered ? 0.55 : 1,
      }}
    >
      {/* Status banner */}
      <div
        className="px-4 py-2 flex items-center justify-between gap-2"
        style={{ background: cfg.bg }}
      >
        <span className="text-xs font-extrabold uppercase tracking-wide" style={{ color: cfg.color }}>
          {cfg.label}
        </span>
        <span className="text-[11px] num font-semibold" style={{ color: cfg.color, opacity: 0.8 }}>
          {order.order_number}
        </span>
      </div>

      {/* Customer name */}
      <div className="px-4 pt-3 pb-3">
        <p
          className="font-display font-bold text-[20px] leading-tight"
          style={{ color: 'var(--color-ink)' }}
        >
          {order.customers?.full_name ?? '—'}
        </p>
        {order.customers?.area && (
          <p className="text-xs mt-0.5 font-semibold" style={{ color: 'var(--color-muted)' }}>
            {order.customers.area}
          </p>
        )}
      </div>

      {/* Items list */}
      <div
        className="px-4 py-3 flex-1"
        style={{ borderTop: '1px solid var(--color-border)' }}
      >
        <div className="space-y-2.5">
          {order.order_items.map((item) => {
            const qty = parseFloat(item.quantity)
            const displayQty = Number.isInteger(qty) ? qty : qty.toFixed(1)
            return (
              <div key={item.id} className="flex items-center justify-between gap-3">
                <span
                  className="text-sm leading-snug font-medium flex-1"
                  style={{ color: 'var(--color-ink)' }}
                >
                  {item.item_name_snapshot}
                </span>
                <span
                  className="num font-extrabold text-sm flex-shrink-0 rounded-[6px] px-2 py-0.5"
                  style={{ background: 'var(--color-cream)', color: 'var(--color-ink)' }}
                >
                  ×{displayQty}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Notes */}
      {order.notes && (
        <div
          className="mx-4 mb-3 px-3 py-2 rounded-[10px] text-xs font-medium"
          style={{ background: 'var(--color-saffron-soft)', color: 'var(--color-ember)' }}
        >
          📌 {order.notes}
        </div>
      )}

      {error && (
        <p className="px-4 pb-2 text-xs font-semibold" style={{ color: 'var(--color-red)' }}>
          {error}
        </p>
      )}

      {/* Action */}
      <div className="px-4 pb-4 pt-3" style={{ borderTop: '1px solid var(--color-border)' }}>
        {cfg.actionLabel ? (
          <button
            type="button"
            onClick={handleAdvance}
            disabled={isPending}
            className="w-full py-3 rounded-[12px] text-sm font-bold text-white transition-opacity disabled:opacity-60"
            style={{ background: cfg.actionBg! }}
          >
            {isPending ? 'Updating…' : cfg.actionLabel}
          </button>
        ) : (
          <div
            className="w-full py-3 rounded-[12px] text-sm font-bold text-center"
            style={{ background: 'var(--color-border)', color: 'var(--color-muted)' }}
          >
            ✓ Delivered
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main module ───────────────────────────────────────────────────────────────

export function PackingModule({
  orders,
  packDate,
  todayDubai,
  defaultPeriod,
}: {
  orders: OrderWithDetails[]
  packDate: string
  todayDubai: string
  defaultPeriod: MealPeriod
}) {
  const router = useRouter()
  const [activePeriod, setActivePeriod] = useState<MealPeriod>(defaultPeriod)
  const [isRefreshing, startRefresh] = useTransition()

  // Auto-refresh every 30 s so new orders appear without manual action
  useEffect(() => {
    const t = setInterval(() => router.refresh(), 30_000)
    return () => clearInterval(t)
  }, [router])

  const isToday = packDate === todayDubai

  // Active (non-delivered) count per period for tab badges
  const activeCounts = PERIODS.reduce(
    (acc, p) => {
      acc[p.value] = orders.filter(
        (o) => o.meal_period === p.value && o.order_status !== 'delivered'
      ).length
      return acc
    },
    {} as Record<MealPeriod, number>
  )

  // Sort: confirmed → preparing → out_for_delivery → delivered, then by time
  const periodOrders = orders
    .filter((o) => o.meal_period === activePeriod)
    .sort((a, b) => {
      const sa = STATUS_SORT[a.order_status] ?? 9
      const sb = STATUS_SORT[b.order_status] ?? 9
      if (sa !== sb) return sa - sb
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    })

  const activeCount = periodOrders.filter((o) => o.order_status !== 'delivered').length

  return (
    <div>
      {/* Page header */}
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <p
            className="text-xs font-bold uppercase tracking-widest"
            style={{ color: 'var(--color-saffron)', letterSpacing: '.12em' }}
          >
            Packing
          </p>
          <h1
            className="font-display font-bold text-[25px] mt-0.5"
            style={{ color: 'var(--color-ink)' }}
          >
            Kitchen Orders
          </h1>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 mt-1">
          {/* Print packing list */}
          <button
            onClick={() => window.open(`/print/packing?date=${packDate}`, '_blank', 'noopener,noreferrer')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] text-sm font-semibold transition-colors hover:bg-cream"
            style={{ color: 'var(--color-muted)', border: '1px solid var(--color-border)' }}
            title="Print packing list"
          >
            <Printer size={14} />
            Print
          </button>

          {/* Manual refresh */}
          <button
            onClick={() => startRefresh(() => { router.refresh() })}
            disabled={isRefreshing}
            className="h-9 w-9 flex items-center justify-center rounded-full transition-colors hover:bg-cream"
            style={{ color: 'var(--color-saffron)' }}
            title="Refresh orders"
          >
            <RefreshCw size={16} className={isRefreshing ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Date navigation */}
      <div
        className="flex items-center justify-between gap-2 mb-5 rounded-[14px] px-3 py-2.5"
        style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          boxShadow: 'var(--shadow-card)',
        }}
      >
        <button
          onClick={() => router.push(`/packing?date=${shiftDate(packDate, -1)}`)}
          className="h-9 w-9 flex items-center justify-center rounded-full transition-colors hover:bg-cream flex-shrink-0"
          style={{ color: 'var(--color-muted)' }}
          aria-label="Previous day"
        >
          <ChevronLeft size={20} />
        </button>

        <div className="text-center flex-1">
          <p className="font-bold text-sm" style={{ color: 'var(--color-ink)' }}>
            {formatDisplayDate(packDate)}
          </p>
          {!isToday && (
            <button
              onClick={() => router.push('/packing')}
              className="text-xs font-bold mt-0.5"
              style={{ color: 'var(--color-saffron)' }}
            >
              Back to Today
            </button>
          )}
          {isToday && (
            <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
              Today
            </p>
          )}
        </div>

        <button
          onClick={() => router.push(`/packing?date=${shiftDate(packDate, 1)}`)}
          className="h-9 w-9 flex items-center justify-center rounded-full transition-colors hover:bg-cream flex-shrink-0"
          style={{ color: 'var(--color-muted)' }}
          aria-label="Next day"
        >
          <ChevronRight size={20} />
        </button>
      </div>

      {/* Meal period tabs */}
      <div className="flex gap-1.5 mb-4 overflow-x-auto pb-0.5">
        {PERIODS.map((p) => {
          const count = activeCounts[p.value]
          const isActive = activePeriod === p.value
          return (
            <button
              key={p.value}
              onClick={() => setActivePeriod(p.value)}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-pill text-sm font-semibold flex-shrink-0 transition-colors"
              style={{
                background: isActive ? 'var(--color-ink)' : 'var(--color-surface)',
                color: isActive ? 'var(--color-cream)' : 'var(--color-muted)',
                border: '1px solid',
                borderColor: isActive ? 'var(--color-ink)' : 'var(--color-border)',
              }}
            >
              {p.label}
              {count > 0 && (
                <span
                  className="inline-flex items-center justify-center h-4 min-w-4 px-1 rounded-full text-[10px] font-bold"
                  style={{
                    background: isActive ? 'var(--color-saffron)' : 'var(--color-saffron-soft)',
                    color: isActive ? '#fff' : 'var(--color-ember)',
                  }}
                >
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Summary line */}
      {periodOrders.length > 0 && (
        <p className="text-xs mb-4" style={{ color: 'var(--color-muted)' }}>
          {periodOrders.length} order{periodOrders.length !== 1 ? 's' : ''}
          {activeCount > 0 && (
            <>
              {' '}·{' '}
              <span style={{ color: 'var(--color-ember)', fontWeight: 700 }}>
                {activeCount} pending
              </span>
            </>
          )}
          {activeCount === 0 && periodOrders.length > 0 && (
            <>
              {' '}·{' '}
              <span style={{ color: 'var(--color-green)', fontWeight: 700 }}>
                all done ✓
              </span>
            </>
          )}
        </p>
      )}

      {/* Order cards */}
      {periodOrders.length === 0 ? (
        <div
          className="py-16 text-center rounded-[14px]"
          style={{ border: '1px dashed var(--color-border)' }}
        >
          <p className="text-sm font-semibold" style={{ color: 'var(--color-muted)' }}>
            No {PERIODS.find((p) => p.value === activePeriod)?.label.toLowerCase()} orders for this date
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {periodOrders.map((order) => (
            <OrderCard key={order.id} order={order} />
          ))}
        </div>
      )}
    </div>
  )
}
