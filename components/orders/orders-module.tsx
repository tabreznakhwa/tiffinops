'use client'

import { Fragment, useState, useMemo, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Plus, Search, AlertTriangle, Pencil } from 'lucide-react'
import { voidOrder } from '@/lib/orders/voidOrder'
import { updateOrder } from '@/lib/orders/actions'
import { useAppSettings } from '@/components/settings/settings-context'

// ── Types ─────────────────────────────────────────────────────────────────────

export type OrderRow = {
  id: string
  order_number: string
  customer_id: string
  order_date: string
  meal_period: string
  subtotal: string
  discount_amount: string
  delivery_charge: string
  total_amount: string
  order_status: string
  payment_status: string
  voided_at: string | null
  void_reason: string | null
  notes: string | null
  customers: { full_name: string; customer_code: string } | null
  order_items: { item_name_snapshot: string; quantity: string }[]
}

// ── Badge configs ─────────────────────────────────────────────────────────────

const ORDER_STATUS_CONFIG: Record<string, { label: string; bg: string; color: string }> = {
  draft:              { label: 'Draft',           bg: 'var(--color-border)',      color: 'var(--color-muted)'  },
  confirmed:          { label: 'Confirmed',        bg: 'var(--color-blue-soft)',   color: 'var(--color-blue)'   },
  preparing:          { label: 'Preparing',        bg: '#FEF3C7',                  color: 'var(--color-gold)'   },
  out_for_delivery:   { label: 'Out for Delivery', bg: 'var(--color-purple-soft)', color: 'var(--color-purple)' },
  delivered:          { label: 'Delivered',        bg: 'var(--color-green-soft)',  color: 'var(--color-green)'  },
  cancelled:          { label: 'Cancelled',        bg: 'var(--color-border)',      color: 'var(--color-muted)'  },
  voided:             { label: 'Voided',           bg: 'var(--color-red-soft)',    color: 'var(--color-red)'    },
}

const PAYMENT_STATUS_CONFIG: Record<string, { label: string; bg: string; color: string }> = {
  unpaid:     { label: 'Unpaid',      bg: 'var(--color-red-soft)',    color: 'var(--color-red)'    },
  partial:    { label: 'Partial',     bg: '#FEF3C7',                  color: 'var(--color-gold)'   },
  paid:       { label: 'Paid',        bg: 'var(--color-green-soft)',  color: 'var(--color-green)'  },
  refunded:   { label: 'Refunded',    bg: 'var(--color-blue-soft)',   color: 'var(--color-blue)'   },
  written_off:{ label: 'Written Off', bg: 'var(--color-border)',      color: 'var(--color-muted)'  },
}

const MEAL_LABELS: Record<string, string> = {
  breakfast: 'Breakfast',
  lunch:     'Lunch',
  dinner:    'Dinner',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(d: string) {
  return new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  })
}

function OrderStatusBadge({ status }: { status: string }) {
  const cfg = ORDER_STATUS_CONFIG[status] ?? ORDER_STATUS_CONFIG.draft
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-[10.5px] font-bold whitespace-nowrap"
      style={{ background: cfg.bg, color: cfg.color }}
    >
      {cfg.label}
    </span>
  )
}

function PaymentStatusBadge({ status }: { status: string }) {
  const cfg = PAYMENT_STATUS_CONFIG[status] ?? PAYMENT_STATUS_CONFIG.unpaid
  return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9.5px] font-bold whitespace-nowrap"
      style={{ background: cfg.bg, color: cfg.color }}
    >
      {cfg.label}
    </span>
  )
}

// ── Quick-range helper ────────────────────────────────────────────────────────

function todayStr() {
  return new Date().toLocaleDateString('sv-SE') // 'YYYY-MM-DD' in local time
}

function nDaysAgoStr(n: number) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toLocaleDateString('sv-SE')
}

function thisMonthStart() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

// ── Tab / pill button ─────────────────────────────────────────────────────────

function TabPill({
  active,
  onClick,
  children,
  color,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
  color?: string
}) {
  return (
    <button
      onClick={onClick}
      className="px-3 py-1.5 rounded-full text-xs font-semibold transition-colors whitespace-nowrap"
      style={{
        background: active ? (color ?? 'var(--color-saffron)') : 'var(--color-surface)',
        color: active ? '#fff' : 'var(--color-muted)',
        border: `1px solid ${active ? (color ?? 'var(--color-saffron)') : 'var(--color-border)'}`,
      }}
    >
      {children}
    </button>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function OrdersModule({
  orders,
  isOwner,
  initialFrom,
  initialTo,
}: {
  orders: OrderRow[]
  isOwner: boolean
  initialFrom: string
  initialTo: string
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { currency } = useAppSettings()

  // Date range state (driven from URL, editable locally before Apply)
  const [fromDate, setFromDate] = useState(initialFrom)
  const [toDate, setToDate]     = useState(initialTo)

  // Local client-side filters
  const [search, setSearch]         = useState(searchParams.get('search') ?? '')
  const [periodFilter, setPeriod]   = useState<string>('all')
  const [statusFilter, setStatus]   = useState<string>('all')

  // Void state
  const [voidingId, setVoidingId]     = useState<string | null>(null)
  const [voidReason, setVoidReason]   = useState('')
  const [voidError, setVoidError]     = useState('')
  const [isPending, startTransition]  = useTransition()

  // Edit state
  const [editingId, setEditingId]         = useState<string | null>(null)
  const [editStatus, setEditStatus]       = useState('')
  const [editPayStatus, setEditPayStatus] = useState('')
  const [editNotes, setEditNotes]         = useState('')
  const [editDiscount, setEditDiscount]   = useState('')
  const [editDelivery, setEditDelivery]   = useState('')
  const [editError, setEditError]         = useState('')
  const [isEditPending, startEditTrans]   = useTransition()

  // ── Filter logic ──────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    return orders.filter((o) => {
      // Period filter
      if (periodFilter !== 'all' && o.meal_period !== periodFilter) return false

      // Status filter
      if (statusFilter === 'active') {
        if (!['confirmed', 'preparing', 'out_for_delivery', 'delivered'].includes(o.order_status)) return false
      } else if (statusFilter === 'voided') {
        if (o.order_status !== 'voided') return false
      } else if (statusFilter === 'cancelled') {
        if (o.order_status !== 'cancelled') return false
      }

      // Search
      if (q) {
        return (
          o.order_number.toLowerCase().includes(q) ||
          (o.customers?.full_name.toLowerCase().includes(q) ?? false) ||
          (o.customers?.customer_code.toLowerCase().includes(q) ?? false)
        )
      }
      return true
    })
  }, [orders, periodFilter, statusFilter, search])

  const totalRevenue = useMemo(
    () =>
      filtered
        .filter((o) => !['voided', 'cancelled'].includes(o.order_status))
        .reduce((s, o) => s + parseFloat(String(o.total_amount)), 0),
    [filtered]
  )

  // ── URL navigation helpers ────────────────────────────────────────────────

  function applyDateRange() {
    const params = new URLSearchParams(searchParams.toString())
    params.set('from', fromDate)
    params.set('to', toDate)
    router.push(`/orders?${params.toString()}`)
  }

  function setQuickRange(from: string, to: string) {
    setFromDate(from)
    setToDate(to)
    const params = new URLSearchParams(searchParams.toString())
    params.set('from', from)
    params.set('to', to)
    router.push(`/orders?${params.toString()}`)
  }

  // ── Void handler ──────────────────────────────────────────────────────────

  function handleVoidClick(id: string) {
    setVoidingId(id)
    setVoidReason('')
    setVoidError('')
  }

  function handleVoidCancel() {
    setVoidingId(null)
    setVoidReason('')
    setVoidError('')
  }

  function handleVoidConfirm() {
    if (!voidingId) return
    setVoidError('')
    startTransition(async () => {
      const result = await voidOrder(voidingId, voidReason)
      if (result.error) {
        setVoidError(result.error)
        return
      }
      setVoidingId(null)
      setVoidReason('')
      router.refresh()
    })
  }

  // ── Edit handlers ─────────────────────────────────────────────────────────

  function handleEditClick(order: OrderRow) {
    setVoidingId(null)
    setEditingId(order.id)
    setEditStatus(order.order_status)
    setEditPayStatus(order.payment_status)
    setEditNotes(order.notes ?? '')
    setEditDiscount(parseFloat(String(order.discount_amount || '0')).toFixed(2))
    setEditDelivery(parseFloat(String(order.delivery_charge || '0')).toFixed(2))
    setEditError('')
  }

  function handleEditCancel() {
    setEditingId(null)
    setEditError('')
  }

  function handleEditSave(order: OrderRow) {
    setEditError('')
    startEditTrans(async () => {
      const result = await updateOrder({
        order_id:        order.id,
        order_status:    editStatus as Parameters<typeof updateOrder>[0]['order_status'],
        payment_status:  editPayStatus as Parameters<typeof updateOrder>[0]['payment_status'],
        notes:           editNotes || null,
        discount_amount: parseFloat(editDiscount) || 0,
        delivery_charge: parseFloat(editDelivery) || 0,
      })
      if (result.error) {
        setEditError(result.error)
        return
      }
      setEditingId(null)
      router.refresh()
    })
  }

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* ── Page header ── */}
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <p
            className="text-xs font-bold uppercase tracking-widest"
            style={{ color: 'var(--color-saffron)', letterSpacing: '.12em' }}
          >
            Orders
          </p>
          <h1
            className="font-display font-bold text-[25px] mt-0.5"
            style={{ color: 'var(--color-ink)' }}
          >
            {filtered.length}
            {filtered.length !== orders.length && (
              <span className="text-[16px] font-semibold ml-1.5" style={{ color: 'var(--color-muted)' }}>
                of {orders.length}
              </span>
            )}
            <span className="text-[14px] font-semibold ml-3 num" style={{ color: 'var(--color-muted)' }}>
              · {currency} {totalRevenue.toFixed(2)}
            </span>
          </h1>
        </div>
        <Link
          href="/orders/new"
          className="flex items-center gap-1.5 px-3 py-2 rounded-[10px] text-sm font-semibold flex-shrink-0 mt-1"
          style={{ background: 'var(--color-saffron)', color: '#fff' }}
        >
          <Plus size={15} />
          New Order
        </Link>
      </div>

      {/* ── Date range picker ── */}
      <div
        className="rounded-[12px] px-4 py-3 mb-4"
        style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          boxShadow: 'var(--shadow-card)',
        }}
      >
        <div className="flex flex-wrap items-center gap-2">
          {/* Quick ranges */}
          <button
            onClick={() => setQuickRange(todayStr(), todayStr())}
            className="px-2.5 py-1 rounded-[7px] text-xs font-semibold transition-colors"
            style={{ background: 'var(--color-border)', color: 'var(--color-muted)' }}
          >
            Today
          </button>
          <button
            onClick={() => setQuickRange(nDaysAgoStr(6), todayStr())}
            className="px-2.5 py-1 rounded-[7px] text-xs font-semibold transition-colors"
            style={{ background: 'var(--color-border)', color: 'var(--color-muted)' }}
          >
            Last 7d
          </button>
          <button
            onClick={() => setQuickRange(thisMonthStart(), todayStr())}
            className="px-2.5 py-1 rounded-[7px] text-xs font-semibold transition-colors"
            style={{ background: 'var(--color-border)', color: 'var(--color-muted)' }}
          >
            This Month
          </button>

          <div className="w-px self-stretch mx-1" style={{ background: 'var(--color-border)' }} />

          {/* Date inputs + Apply */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="rounded-[8px] px-2 py-1.5 text-xs focus:outline-none"
              style={{
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                color: 'var(--color-ink)',
              }}
            />
            <span className="text-xs" style={{ color: 'var(--color-muted)' }}>to</span>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="rounded-[8px] px-2 py-1.5 text-xs focus:outline-none"
              style={{
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                color: 'var(--color-ink)',
              }}
            />
            <button
              onClick={applyDateRange}
              className="px-3 py-1.5 rounded-[8px] text-xs font-bold"
              style={{ background: 'var(--color-saffron)', color: '#fff' }}
            >
              Apply
            </button>
          </div>
        </div>
      </div>

      {/* ── Search ── */}
      <div className="relative mb-3">
        <Search
          size={14}
          className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
          style={{ color: 'var(--color-muted)' }}
        />
        <input
          type="search"
          placeholder="Search order #, customer name or code…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-8 pr-4 py-2 text-sm rounded-[10px] focus:outline-none"
          style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            color: 'var(--color-ink)',
          }}
        />
      </div>

      {/* ── Meal period tabs ── */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        {(['all', 'breakfast', 'lunch', 'dinner'] as const).map((p) => (
          <TabPill
            key={p}
            active={periodFilter === p}
            onClick={() => setPeriod(p)}
          >
            {p === 'all' ? 'All Meals' : MEAL_LABELS[p]}
          </TabPill>
        ))}
      </div>

      {/* ── Status filter pills ── */}
      <div className="flex flex-wrap gap-1.5 mb-5">
        <TabPill active={statusFilter === 'all'} onClick={() => setStatus('all')}>
          All
        </TabPill>
        <TabPill
          active={statusFilter === 'active'}
          onClick={() => setStatus('active')}
          color="var(--color-green)"
        >
          Active
        </TabPill>
        <TabPill
          active={statusFilter === 'voided'}
          onClick={() => setStatus('voided')}
          color="var(--color-red)"
        >
          Voided
        </TabPill>
        <TabPill
          active={statusFilter === 'cancelled'}
          onClick={() => setStatus('cancelled')}
          color="var(--color-muted)"
        >
          Cancelled
        </TabPill>
      </div>

      {/* ── Table ── */}
      {filtered.length === 0 ? (
        <div
          className="py-16 text-center rounded-[14px]"
          style={{ border: '1px dashed var(--color-border)' }}
        >
          <p className="font-semibold text-sm" style={{ color: 'var(--color-muted)' }}>
            No orders in this period.
          </p>
          <Link
            href="/orders/new"
            className="inline-flex items-center gap-1.5 mt-4 px-4 py-2 rounded-[8px] text-sm font-semibold"
            style={{ background: 'var(--color-saffron)', color: '#fff' }}
          >
            <Plus size={14} />
            New Order
          </Link>
        </div>
      ) : (
        <div
          className="rounded-[14px] overflow-hidden"
          style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            boxShadow: 'var(--shadow-card)',
          }}
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[700px]">
              <thead>
                <tr style={{ background: 'var(--color-cream)' }}>
                  {['#', 'Date', 'Customer', 'Meal', 'Items', 'Total', 'Status', ''].map((h, i) => (
                    <th
                      key={i}
                      className="text-left px-3 py-2 text-[10px] font-bold uppercase tracking-wide"
                      style={{
                        color: 'var(--color-muted)',
                        borderBottom: '2px solid var(--color-border)',
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((order, idx) => {
                  const isVoided  = order.order_status === 'voided'
                  const isVoiding = voidingId === order.id
                  const itemSummary = order.order_items
                    .map((i) => i.item_name_snapshot)
                    .join(', ')

                  const isEditing = editingId === order.id

                  return (
                    <Fragment key={order.id}>
                      <tr
                        style={{
                          borderTop: idx > 0 ? '1px solid var(--color-border)' : undefined,
                          opacity: isVoided ? 0.6 : 1,
                          background: isVoiding || isEditing ? 'var(--color-cream)' : undefined,
                        }}
                      >
                        {/* # */}
                        <td className="px-3 py-3">
                          <span
                            className="text-[11px] font-mono font-semibold"
                            style={{ color: 'var(--color-muted)' }}
                          >
                            {order.order_number}
                          </span>
                        </td>

                        {/* Date */}
                        <td className="px-3 py-3 whitespace-nowrap" style={{ color: 'var(--color-muted)' }}>
                          <span className="text-xs">{fmtDate(order.order_date)}</span>
                        </td>

                        {/* Customer */}
                        <td className="px-3 py-3">
                          <p
                            className="font-semibold text-sm"
                            style={{
                              color: 'var(--color-ink)',
                              textDecoration: isVoided ? 'line-through' : 'none',
                            }}
                          >
                            {order.customers?.full_name ?? 'Unknown'}
                          </p>
                          {order.customers?.customer_code && (
                            <p className="text-[10px] font-mono mt-0.5" style={{ color: 'var(--color-muted)' }}>
                              {order.customers.customer_code}
                            </p>
                          )}
                        </td>

                        {/* Meal */}
                        <td className="px-3 py-3">
                          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
                            {MEAL_LABELS[order.meal_period] ?? order.meal_period}
                          </span>
                        </td>

                        {/* Items */}
                        <td className="px-3 py-3 max-w-[200px]">
                          <p
                            className="text-xs truncate"
                            style={{ color: 'var(--color-muted)' }}
                            title={itemSummary}
                          >
                            {itemSummary || '—'}
                          </p>
                        </td>

                        {/* Total */}
                        <td className="px-3 py-3 whitespace-nowrap">
                          <span
                            className="font-semibold num text-sm"
                            style={{
                              color: isVoided ? 'var(--color-muted)' : 'var(--color-ink)',
                              textDecoration: isVoided ? 'line-through' : 'none',
                            }}
                          >
                            {currency} {parseFloat(String(order.total_amount)).toFixed(2)}
                          </span>
                        </td>

                        {/* Status badges */}
                        <td className="px-3 py-3">
                          <div className="flex flex-col gap-1 items-start">
                            <OrderStatusBadge status={order.order_status} />
                            {!isVoided && (
                              <PaymentStatusBadge status={order.payment_status} />
                            )}
                          </div>
                        </td>

                        {/* Actions */}
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-1.5">
                            {!isVoided && !isVoiding && !isEditing && (
                              <button
                                onClick={() => handleEditClick(order)}
                                className="flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-[6px] transition-colors"
                                style={{
                                  color: 'var(--color-saffron)',
                                  background: 'var(--color-saffron-soft)',
                                }}
                              >
                                <Pencil size={10} />
                                Edit
                              </button>
                            )}
                            {isOwner && !isVoided && !isVoiding && !isEditing && (
                              <button
                                onClick={() => handleVoidClick(order.id)}
                                className="text-[11px] font-semibold px-2 py-1 rounded-[6px] transition-colors"
                                style={{
                                  color: 'var(--color-red)',
                                  background: 'var(--color-red-soft)',
                                }}
                              >
                                Void
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>

                      {/* Inline edit panel */}
                      {isEditing && (
                        <tr style={{ borderTop: '1px solid var(--color-border)' }}>
                          <td colSpan={8} className="px-4 pb-4 pt-2">
                            <div
                              className="rounded-[10px] p-3 space-y-3"
                              style={{
                                background: 'var(--color-surface)',
                                border: '1px solid var(--color-border)',
                              }}
                            >
                              <p className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>
                                Edit Order {order.order_number}
                              </p>

                              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                {/* Order Status */}
                                <div>
                                  <label className="block text-[10px] font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--color-muted)' }}>
                                    Order Status
                                  </label>
                                  <select
                                    value={editStatus}
                                    onChange={(e) => setEditStatus(e.target.value)}
                                    className="w-full rounded-[8px] px-2 py-1.5 text-xs focus:outline-none"
                                    style={{ border: '1px solid var(--color-border)', background: 'var(--color-cream)', color: 'var(--color-ink)' }}
                                  >
                                    {['draft','confirmed','preparing','out_for_delivery','delivered','cancelled'].map(s => (
                                      <option key={s} value={s}>{ORDER_STATUS_CONFIG[s]?.label ?? s}</option>
                                    ))}
                                  </select>
                                </div>

                                {/* Payment Status */}
                                <div>
                                  <label className="block text-[10px] font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--color-muted)' }}>
                                    Payment Status
                                  </label>
                                  <select
                                    value={editPayStatus}
                                    onChange={(e) => setEditPayStatus(e.target.value)}
                                    className="w-full rounded-[8px] px-2 py-1.5 text-xs focus:outline-none"
                                    style={{ border: '1px solid var(--color-border)', background: 'var(--color-cream)', color: 'var(--color-ink)' }}
                                  >
                                    {['unpaid','partial','paid','refunded','written_off'].map(s => (
                                      <option key={s} value={s}>{PAYMENT_STATUS_CONFIG[s]?.label ?? s}</option>
                                    ))}
                                  </select>
                                </div>

                                {/* Discount */}
                                <div>
                                  <label className="block text-[10px] font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--color-muted)' }}>
                                    Discount ({currency})
                                  </label>
                                  <input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={editDiscount}
                                    onChange={(e) => setEditDiscount(e.target.value)}
                                    className="w-full rounded-[8px] px-2 py-1.5 text-xs text-right num focus:outline-none"
                                    style={{ border: '1px solid var(--color-border)', background: 'var(--color-cream)', color: 'var(--color-ink)' }}
                                  />
                                </div>

                                {/* Delivery */}
                                <div>
                                  <label className="block text-[10px] font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--color-muted)' }}>
                                    Delivery ({currency})
                                  </label>
                                  <input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={editDelivery}
                                    onChange={(e) => setEditDelivery(e.target.value)}
                                    className="w-full rounded-[8px] px-2 py-1.5 text-xs text-right num focus:outline-none"
                                    style={{ border: '1px solid var(--color-border)', background: 'var(--color-cream)', color: 'var(--color-ink)' }}
                                  />
                                </div>
                              </div>

                              {/* New total preview */}
                              <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                                Subtotal: <span className="num font-semibold" style={{ color: 'var(--color-ink)' }}>{currency} {parseFloat(String(order.subtotal || order.total_amount)).toFixed(2)}</span>
                                {'  ·  '}New total: <span className="num font-bold" style={{ color: 'var(--color-ember)' }}>
                                  {currency} {(Math.max(0, parseFloat(String(order.subtotal || order.total_amount))) - (parseFloat(editDiscount) || 0) + (parseFloat(editDelivery) || 0)).toFixed(2)}
                                </span>
                              </p>

                              {/* Notes */}
                              <div>
                                <label className="block text-[10px] font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--color-muted)' }}>
                                  Notes
                                </label>
                                <textarea
                                  value={editNotes}
                                  onChange={(e) => setEditNotes(e.target.value)}
                                  rows={2}
                                  placeholder="Delivery instructions, spice level…"
                                  className="w-full rounded-[8px] px-2.5 py-2 text-xs resize-none focus:outline-none"
                                  style={{ border: '1px solid var(--color-border)', background: 'var(--color-cream)', color: 'var(--color-ink)' }}
                                />
                              </div>

                              {editError && (
                                <p className="text-xs font-semibold" style={{ color: 'var(--color-red)' }}>{editError}</p>
                              )}

                              <div className="flex gap-2">
                                <button
                                  onClick={handleEditCancel}
                                  disabled={isEditPending}
                                  className="flex-1 py-1.5 rounded-[7px] text-xs font-semibold"
                                  style={{ background: 'var(--color-cream)', border: '1px solid var(--color-border)', color: 'var(--color-muted)' }}
                                >
                                  Cancel
                                </button>
                                <button
                                  onClick={() => handleEditSave(order)}
                                  disabled={isEditPending}
                                  className="flex-1 py-1.5 rounded-[7px] text-xs font-bold disabled:opacity-50"
                                  style={{ background: 'var(--color-saffron)', color: '#fff' }}
                                >
                                  {isEditPending ? 'Saving…' : 'Save Changes'}
                                </button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}

                      {/* Inline void confirmation row */}
                      {isVoiding && (
                        <tr style={{ borderTop: '1px solid var(--color-border)' }}>
                          <td colSpan={8} className="px-4 pb-4 pt-2">
                            <div
                              className="rounded-[10px] p-3"
                              style={{
                                background: 'var(--color-red-soft)',
                                border: '1px solid #FECACA',
                              }}
                            >
                              <div className="flex items-center gap-1.5 mb-2">
                                <AlertTriangle size={13} style={{ color: 'var(--color-red)' }} />
                                <p className="text-xs font-bold" style={{ color: 'var(--color-red)' }}>
                                  Void order {order.order_number}? This cannot be undone.
                                </p>
                              </div>
                              <textarea
                                value={voidReason}
                                onChange={(e) => setVoidReason(e.target.value)}
                                placeholder="Reason for voiding (required)…"
                                rows={2}
                                className="w-full rounded-[8px] px-2.5 py-2 text-xs resize-none focus:outline-none focus:ring-1"
                                style={{
                                  background: '#fff',
                                  border: '1px solid #FECACA',
                                  color: 'var(--color-ink)',
                                }}
                              />
                              {voidError && (
                                <p className="text-xs font-semibold mt-1" style={{ color: 'var(--color-red)' }}>
                                  {voidError}
                                </p>
                              )}
                              <div className="flex gap-2 mt-2">
                                <button
                                  onClick={handleVoidCancel}
                                  className="flex-1 py-1.5 rounded-[7px] text-xs font-semibold"
                                  style={{
                                    background: '#fff',
                                    border: '1px solid var(--color-border)',
                                    color: 'var(--color-muted)',
                                  }}
                                  disabled={isPending}
                                >
                                  Cancel
                                </button>
                                <button
                                  onClick={handleVoidConfirm}
                                  disabled={isPending || voidReason.trim().length < 3}
                                  className="flex-1 py-1.5 rounded-[7px] text-xs font-bold disabled:opacity-50"
                                  style={{ background: 'var(--color-red)', color: '#fff' }}
                                >
                                  {isPending ? 'Voiding…' : 'Confirm Void'}
                                </button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
