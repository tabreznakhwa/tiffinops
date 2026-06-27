'use client'

import { useState, useTransition, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Check, Minus, Plus, Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { updateOrderFull } from '@/lib/orders/actions'
import { useAppSettings } from '@/components/settings/settings-context'
import type { Tables, Enums } from '@/lib/supabase/types'

type Customer = Tables<'customers'>
type MenuItem = Tables<'menu_items'>
type MealPeriod = Enums<'meal_period'>

export type EditableOrder = {
  id: string
  order_number: string
  customer_id: string
  order_date: string
  meal_period: string
  discount_amount: string
  delivery_charge: string
  notes: string | null
  order_status: string
  payment_status: string
  order_items: {
    menu_item_id: string
    item_name_snapshot: string
    quantity: string
    unit_price: string
  }[]
}

const PLAN_LABELS: Record<Enums<'customer_type'>, string> = {
  a_la_carte: 'A La Carte',
  fixed_menu:  'Fixed Menu',
  hybrid:      'Hybrid',
}

const PERIODS: { value: MealPeriod; label: string }[] = [
  { value: 'breakfast', label: 'Breakfast' },
  { value: 'lunch',     label: 'Lunch'     },
  { value: 'dinner',    label: 'Dinner'    },
]

const ORDER_STATUS_LABELS: Record<string, string> = {
  draft:            'Draft',
  confirmed:        'Confirmed',
  preparing:        'Preparing',
  out_for_delivery: 'Out for Delivery',
  delivered:        'Delivered',
  cancelled:        'Cancelled',
}
const PAYMENT_STATUS_LABELS: Record<string, string> = {
  unpaid:      'Unpaid',
  partial:     'Partial',
  paid:        'Paid',
  refunded:    'Refunded',
  written_off: 'Written Off',
}

const inputBase =
  'w-full rounded-[11px] px-3 py-2.5 text-sm bg-surface text-ink focus:outline-none focus:ring-1 focus:ring-saffron'
const inputStyle = { border: '1px solid var(--color-border)' } as const

// ── Customer selector ─────────────────────────────────────────────────────────

function CustomerSelector({
  customers, selected, onSelect,
}: {
  customers: Customer[]
  selected: Customer | null
  onSelect: (c: Customer | null) => void
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen]   = useState(false)

  const filtered = useMemo(() => {
    const q = query.toLowerCase()
    return customers
      .filter((c) => c.status === 'active' || c.status === 'paused')
      .filter((c) =>
        !q ||
        c.full_name.toLowerCase().includes(q) ||
        c.mobile_number.includes(q) ||
        c.customer_code.toLowerCase().includes(q)
      )
      .slice(0, 8)
  }, [customers, query])

  if (selected && !open) {
    return (
      <div className="flex items-center justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm" style={{ color: 'var(--color-ink)' }}>
            {selected.full_name}
          </p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
            {selected.customer_code} ·{' '}
            <span
              className="font-semibold"
              style={{ color: selected.customer_type === 'a_la_carte' ? 'var(--color-ember)' : 'var(--color-green)' }}
            >
              {PLAN_LABELS[selected.customer_type]}
            </span>
            {' · '}{selected.mobile_number}
          </p>
        </div>
        <button
          type="button"
          onClick={() => { setOpen(true); setQuery('') }}
          className="flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-pill hover:bg-cream flex-shrink-0"
          style={{ color: 'var(--color-muted)', border: '1px solid var(--color-border)' }}
        >
          <X size={11} /> Change
        </button>
      </div>
    )
  }

  return (
    <div>
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--color-muted)' }} />
        <input
          type="search"
          placeholder="Search by name, phone, or code…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
          className={`${inputBase} pl-8`}
          style={inputStyle}
        />
      </div>
      {filtered.length > 0 ? (
        <div className="mt-1.5 rounded-[11px] overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
          {filtered.map((c, idx) => (
            <button
              key={c.id}
              type="button"
              onClick={() => { onSelect(c); setOpen(false); setQuery('') }}
              className="w-full text-left px-3 py-2.5 transition-colors hover:bg-cream"
              style={{ borderTop: idx > 0 ? '1px solid var(--color-border)' : undefined, background: 'var(--color-surface)' }}
            >
              <p className="text-sm font-semibold" style={{ color: 'var(--color-ink)' }}>{c.full_name}</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
                {c.customer_code} · {PLAN_LABELS[c.customer_type]} · {c.mobile_number}
              </p>
            </button>
          ))}
        </div>
      ) : query ? (
        <p className="mt-2 text-xs text-center py-3" style={{ color: 'var(--color-muted)' }}>No matching customers</p>
      ) : (
        <p className="mt-2 text-xs text-center py-3" style={{ color: 'var(--color-muted)' }}>Type to search customers</p>
      )}
    </div>
  )
}

// ── Qty control ───────────────────────────────────────────────────────────────

function QtyControl({ qty, onDecrement, onIncrement }: { qty: number; onDecrement: () => void; onIncrement: () => void }) {
  return (
    <div className="flex items-center gap-2 flex-shrink-0">
      <button
        type="button"
        onClick={onDecrement}
        disabled={qty === 0}
        className="h-7 w-7 rounded-full flex items-center justify-center transition-colors"
        style={{ background: qty > 0 ? 'var(--color-cream)' : 'transparent', border: '1px solid var(--color-border)', color: qty > 0 ? 'var(--color-ink)' : 'var(--color-border)' }}
      >
        <Minus size={12} />
      </button>
      <span className="w-6 text-center text-sm font-bold num" style={{ color: qty > 0 ? 'var(--color-ink)' : 'var(--color-border)' }}>
        {qty}
      </span>
      <button
        type="button"
        onClick={onIncrement}
        className="h-7 w-7 rounded-full flex items-center justify-center"
        style={{ background: 'var(--color-saffron)', color: '#fff' }}
      >
        <Plus size={12} />
      </button>
    </div>
  )
}

// ── Main form ─────────────────────────────────────────────────────────────────

export function EditOrderForm({
  order, customers, menuItems,
}: {
  order: EditableOrder
  customers: Customer[]
  menuItems: MenuItem[]
}) {
  const { currency } = useAppSettings()
  const router = useRouter()

  const initialCustomer = customers.find((c) => c.id === order.customer_id) ?? null
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(initialCustomer)
  const [mealPeriod, setMealPeriod]             = useState<MealPeriod>(order.meal_period as MealPeriod)
  const [orderDate, setOrderDate]               = useState(order.order_date)
  const [menuSearch, setMenuSearch]             = useState('')
  const [discount, setDiscount]                 = useState(parseFloat(String(order.discount_amount || '0')).toFixed(2))
  const [deliveryCharge, setDeliveryCharge]     = useState(parseFloat(String(order.delivery_charge || '0')).toFixed(2))
  const [notes, setNotes]                       = useState(order.notes ?? '')
  const [orderStatus, setOrderStatus]           = useState(order.order_status)
  const [paymentStatus, setPaymentStatus]       = useState(order.payment_status)
  const [error, setError]                       = useState<string | null>(null)
  const [saved, setSaved]                       = useState(false)
  const [isPending, startTransition]            = useTransition()

  // Pre-populate cart from order_items
  const [quantities, setQuantities] = useState<Record<string, number>>(() =>
    order.order_items.reduce<Record<string, number>>((acc, item) => {
      acc[item.menu_item_id] = parseInt(item.quantity, 10) || 1
      return acc
    }, {})
  )

  const periodItems = useMemo(() => {
    const base = menuItems.filter((i) => i.meal_period === mealPeriod && i.is_available)
    if (!menuSearch.trim()) return base
    const q = menuSearch.toLowerCase()
    return base.filter((i) => i.name.toLowerCase().includes(q) || (i.category ?? '').toLowerCase().includes(q))
  }, [menuItems, mealPeriod, menuSearch])

  // Cart includes items across all meal periods (in case user switches period and has items from before)
  const cartItems = useMemo(
    () =>
      menuItems
        .filter((i) => (quantities[i.id] ?? 0) > 0)
        .map((i) => ({
          ...i,
          qty: quantities[i.id],
          lineTotal: quantities[i.id] * parseFloat(String(i.default_price)),
        })),
    [menuItems, quantities]
  )

  const subtotal    = cartItems.reduce((s, i) => s + i.lineTotal, 0)
  const discountAmt = Math.max(0, parseFloat(discount) || 0)
  const deliveryAmt = Math.max(0, parseFloat(deliveryCharge) || 0)
  const total       = subtotal - discountAmt + deliveryAmt

  const setQty = useCallback((id: string, qty: number) => {
    setQuantities((prev) => {
      if (qty <= 0) { const next = { ...prev }; delete next[id]; return next }
      return { ...prev, [id]: qty }
    })
  }, [])

  function handleChangePeriod(p: MealPeriod) {
    setMealPeriod(p)
    setMenuSearch('')
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!selectedCustomer) { setError('Please select a customer'); return }
    if (cartItems.length === 0) { setError('Add at least one item'); return }

    startTransition(async () => {
      const result = await updateOrderFull({
        order_id:        order.id,
        customer_id:     selectedCustomer.id,
        order_date:      orderDate,
        meal_period:     mealPeriod,
        items:           cartItems.map((item) => ({
          menu_item_id:        item.id,
          item_name_snapshot:  item.name,
          quantity:            item.qty,
          unit_price:          String(item.default_price),
        })),
        discount_amount: discount || '0',
        delivery_charge: deliveryCharge || '0',
        notes:           notes || null,
        order_status:    orderStatus as Parameters<typeof updateOrderFull>[0]['order_status'],
        payment_status:  paymentStatus as Parameters<typeof updateOrderFull>[0]['payment_status'],
      })

      if (result.error) {
        setError(result.error)
      } else {
        setSaved(true)
      }
    })
  }

  if (saved) {
    return (
      <div className="py-10 flex flex-col items-center text-center gap-4">
        <div className="h-14 w-14 rounded-full flex items-center justify-center" style={{ background: 'var(--color-green-soft)' }}>
          <Check size={24} style={{ color: 'var(--color-green)' }} strokeWidth={2.5} />
        </div>
        <div>
          <p className="font-display font-bold text-[20px]" style={{ color: 'var(--color-ink)' }}>Order Updated</p>
          <p className="text-sm mt-1 num font-semibold" style={{ color: 'var(--color-saffron)' }}>{order.order_number}</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 w-full max-w-xs mt-2">
          <button
            onClick={() => router.push('/orders')}
            className="flex-1 py-2 rounded-[10px] text-sm font-bold"
            style={{ background: 'var(--color-saffron)', color: '#fff' }}
          >
            Back to Orders
          </button>
          <Link href={`/customers/${selectedCustomer?.id ?? order.customer_id}`} className="flex-1">
            <button
              className="w-full py-2 rounded-[10px] text-sm font-semibold"
              style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-ink)' }}
            >
              View Customer
            </button>
          </Link>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">

      {/* Customer */}
      <div className="rounded-[14px] p-4" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}>
        <p className="text-[11px] font-bold uppercase tracking-wide mb-2" style={{ color: 'var(--color-muted)' }}>Customer</p>
        <CustomerSelector customers={customers} selected={selectedCustomer} onSelect={setSelectedCustomer} />
      </div>

      {/* Meal period + date */}
      <div className="rounded-[14px] p-4" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}>
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex-1">
            <p className="text-[11px] font-bold uppercase tracking-wide mb-2" style={{ color: 'var(--color-muted)' }}>Meal Period</p>
            <div className="flex gap-1.5">
              {PERIODS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => handleChangePeriod(p.value)}
                  className="px-3.5 py-1.5 rounded-pill text-sm font-semibold flex-shrink-0 transition-colors"
                  style={{
                    background:  mealPeriod === p.value ? 'var(--color-ink)' : 'var(--color-cream)',
                    color:       mealPeriod === p.value ? 'var(--color-cream)' : 'var(--color-muted)',
                    border:      '1px solid',
                    borderColor: mealPeriod === p.value ? 'var(--color-ink)' : 'var(--color-border)',
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <div className="sm:w-44">
            <p className="text-[11px] font-bold uppercase tracking-wide mb-2" style={{ color: 'var(--color-muted)' }}>Order Date</p>
            <input type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} className={inputBase} style={inputStyle} />
          </div>
        </div>
      </div>

      {/* Item picker */}
      <div className="rounded-[14px] overflow-hidden" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}>
        <div className="px-4 pt-4 pb-3">
          <p className="text-[11px] font-bold uppercase tracking-wide mb-2.5" style={{ color: 'var(--color-muted)' }}>
            Items ({PERIODS.find((p) => p.value === mealPeriod)?.label})
          </p>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--color-muted)' }} />
            <input
              type="text"
              value={menuSearch}
              onChange={(e) => setMenuSearch(e.target.value)}
              placeholder="Search items…"
              className="w-full h-9 pl-9 pr-8 rounded-[10px] text-sm outline-none"
              style={{ background: 'var(--color-cream)', border: '1px solid var(--color-border)', color: 'var(--color-ink)' }}
            />
            {menuSearch && (
              <button type="button" onClick={() => setMenuSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2">
                <X size={13} style={{ color: 'var(--color-muted)' }} />
              </button>
            )}
          </div>
        </div>

        {periodItems.length === 0 ? (
          <p className="px-4 pb-4 text-sm" style={{ color: 'var(--color-muted)' }}>
            {menuSearch ? `No items match "${menuSearch}".` : 'No available items for this meal period.'}
          </p>
        ) : (
          <div>
            {periodItems.map((item, idx) => {
              const qty        = quantities[item.id] ?? 0
              const isSelected = qty > 0
              return (
                <div
                  key={item.id}
                  className="flex items-center gap-3 px-4 py-3 transition-colors"
                  style={{ borderTop: idx > 0 ? '1px solid var(--color-border)' : undefined, background: isSelected ? 'var(--color-cream)' : undefined }}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold leading-snug" style={{ color: 'var(--color-ink)' }}>{item.name}</p>
                    {item.category && <p className="text-[11px]" style={{ color: 'var(--color-muted)' }}>{item.category}</p>}
                    {isSelected && (
                      <p className="text-[11px] font-semibold num mt-0.5" style={{ color: 'var(--color-ember)' }}>
                        {currency} {(qty * parseFloat(item.default_price)).toFixed(2)}
                      </p>
                    )}
                  </div>
                  <p className="num text-sm font-semibold flex-shrink-0 mr-1" style={{ color: 'var(--color-muted)' }}>
                    {parseFloat(String(item.default_price)).toFixed(0)}
                  </p>
                  <QtyControl qty={qty} onDecrement={() => setQty(item.id, qty - 1)} onIncrement={() => setQty(item.id, qty + 1)} />
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Cart summary */}
      {cartItems.length > 0 && (
        <div className="rounded-[14px] p-4 space-y-2" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}>
          <p className="text-[11px] font-bold uppercase tracking-wide mb-3" style={{ color: 'var(--color-muted)' }}>Order Summary</p>
          {cartItems.map((item) => (
            <div key={item.id} className="flex justify-between text-sm">
              <span style={{ color: 'var(--color-ink)' }}>
                {item.name}
                <span className="ml-1 font-semibold num" style={{ color: 'var(--color-muted)' }}>×{item.qty}</span>
              </span>
              <span className="num font-semibold" style={{ color: 'var(--color-ink)' }}>{currency} {item.lineTotal.toFixed(2)}</span>
            </div>
          ))}
          <div className="pt-2 mt-2 space-y-2" style={{ borderTop: '1px solid var(--color-border)' }}>
            <div className="flex justify-between text-sm">
              <span style={{ color: 'var(--color-muted)' }}>Subtotal</span>
              <span className="num font-semibold" style={{ color: 'var(--color-ink)' }}>{currency} {subtotal.toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <label className="text-sm flex-shrink-0" style={{ color: 'var(--color-muted)' }}>Discount ({currency})</label>
              <input
                type="number" min="0" step="0.01"
                value={discount} onChange={(e) => setDiscount(e.target.value)}
                placeholder="0.00"
                className="w-28 rounded-[8px] px-2.5 py-1 text-sm text-right num focus:outline-none focus:ring-1 focus:ring-saffron"
                style={{ border: '1px solid var(--color-border)', background: 'var(--color-cream)' }}
              />
            </div>
            <div className="flex items-center justify-between gap-2">
              <label className="text-sm flex-shrink-0" style={{ color: 'var(--color-muted)' }}>Delivery ({currency})</label>
              <input
                type="number" min="0" step="0.01"
                value={deliveryCharge} onChange={(e) => setDeliveryCharge(e.target.value)}
                placeholder="0.00"
                className="w-28 rounded-[8px] px-2.5 py-1 text-sm text-right num focus:outline-none focus:ring-1 focus:ring-saffron"
                style={{ border: '1px solid var(--color-border)', background: 'var(--color-cream)' }}
              />
            </div>
            <div className="flex justify-between pt-2" style={{ borderTop: '1px solid var(--color-border)' }}>
              <span className="font-bold text-sm" style={{ color: 'var(--color-ink)' }}>Total</span>
              <span className="num font-extrabold text-[17px]" style={{ color: 'var(--color-ink)' }}>{currency} {total.toFixed(2)}</span>
            </div>
          </div>
        </div>
      )}

      {/* Notes */}
      <div className="rounded-[14px] p-4" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}>
        <label className="block text-[11px] font-bold uppercase tracking-wide mb-2" style={{ color: 'var(--color-muted)' }}>Notes (optional)</label>
        <textarea
          value={notes} onChange={(e) => setNotes(e.target.value)}
          rows={2} placeholder="Spice level, packaging notes…"
          className={`${inputBase} resize-none`} style={inputStyle}
        />
      </div>

      {/* Status fields */}
      <div className="rounded-[14px] p-4" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}>
        <p className="text-[11px] font-bold uppercase tracking-wide mb-3" style={{ color: 'var(--color-muted)' }}>Status</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--color-muted)' }}>Order Status</label>
            <select
              value={orderStatus} onChange={(e) => setOrderStatus(e.target.value)}
              className={inputBase} style={inputStyle}
            >
              {Object.entries(ORDER_STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--color-muted)' }}>Payment Status</label>
            <select
              value={paymentStatus} onChange={(e) => setPaymentStatus(e.target.value)}
              className={inputBase} style={inputStyle}
            >
              {Object.entries(PAYMENT_STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
        </div>
      </div>

      {error && (
        <p className="text-sm font-semibold" style={{ color: 'var(--color-red)' }}>{error}</p>
      )}

      <div className="flex gap-3">
        <Link href="/orders" className="flex-1">
          <button
            type="button"
            className="w-full py-2.5 rounded-[11px] text-sm font-semibold"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-muted)' }}
          >
            Cancel
          </button>
        </Link>
        <Button
          type="submit"
          variant="primary"
          disabled={isPending || !selectedCustomer || cartItems.length === 0}
          className="flex-1"
        >
          {isPending ? 'Saving…' : `Save · ${currency} ${total.toFixed(2)}`}
        </Button>
      </div>
    </form>
  )
}
