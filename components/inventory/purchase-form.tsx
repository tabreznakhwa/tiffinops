'use client'

import { useState, useTransition, useMemo, useCallback } from 'react'
import Link from 'next/link'
import { Check, Search, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { recordPurchase } from '@/lib/inventory/actions'
import { useAppSettings } from '@/components/settings/settings-context'
import type { Tables, Enums } from '@/lib/supabase/types'

type Supplier = Tables<'suppliers'>
type InventoryItem = Tables<'inventory_items'>
type PaymentMode = Enums<'payment_mode'>

const inputBase =
  'w-full rounded-[11px] px-3 py-2.5 text-sm bg-surface text-ink focus:outline-none focus:ring-1 focus:ring-saffron'
const inputStyle = { border: '1px solid var(--color-border)' } as const

const PAYMENT_STATUSES: { value: 'unpaid' | 'partial' | 'paid'; label: string }[] = [
  { value: 'unpaid', label: 'Unpaid' },
  { value: 'partial', label: 'Partial' },
  { value: 'paid', label: 'Paid' },
]

const PAYMENT_METHODS: { value: PaymentMode; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'online', label: 'Online' },
  { value: 'wallet', label: 'Wallet' },
  { value: 'other', label: 'Other' },
]

// ── Supplier selector ─────────────────────────────────────────────────────────

function SupplierSelector({
  suppliers,
  selected,
  onSelect,
}: {
  suppliers: Supplier[]
  selected: Supplier | null
  onSelect: (s: Supplier | null) => void
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(!selected)

  const filtered = useMemo(() => {
    const q = query.toLowerCase()
    return suppliers
      .filter((s) => s.is_active)
      .filter(
        (s) =>
          !q ||
          s.name.toLowerCase().includes(q) ||
          s.supplier_code.toLowerCase().includes(q) ||
          (s.phone ?? '').toLowerCase().includes(q)
      )
      .slice(0, 8)
  }, [suppliers, query])

  if (selected && !open) {
    return (
      <div className="flex items-center justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm" style={{ color: 'var(--color-ink)' }}>
            {selected.name}
          </p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
            {selected.supplier_code}
            {selected.phone ? ` · ${selected.phone}` : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            onSelect(null)
            setOpen(true)
            setQuery('')
          }}
          className="flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-pill transition-colors hover:bg-cream flex-shrink-0"
          style={{ color: 'var(--color-muted)', border: '1px solid var(--color-border)' }}
        >
          <X size={11} />
          Change
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
          placeholder="Search by name, code or phone…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
          className={`${inputBase} pl-8`}
          style={inputStyle}
        />
      </div>
      {filtered.length > 0 ? (
        <div className="mt-1.5 rounded-[11px] overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
          {filtered.map((s, idx) => (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                onSelect(s)
                setOpen(false)
                setQuery('')
              }}
              className="w-full text-left px-3 py-2.5 transition-colors hover:bg-cream"
              style={{ borderTop: idx > 0 ? '1px solid var(--color-border)' : undefined, background: 'var(--color-surface)' }}
            >
              <p className="text-sm font-semibold" style={{ color: 'var(--color-ink)' }}>{s.name}</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
                {s.supplier_code}{s.phone ? ` · ${s.phone}` : ''}
              </p>
            </button>
          ))}
        </div>
      ) : query ? (
        <p className="mt-2 text-xs text-center py-3" style={{ color: 'var(--color-muted)' }}>No matching suppliers</p>
      ) : suppliers.filter(s => s.is_active).length === 0 ? (
        <p className="mt-2 text-xs text-center py-3" style={{ color: 'var(--color-muted)' }}>
          No suppliers yet.{' '}
          <Link href="/inventory/suppliers" className="font-semibold underline" style={{ color: 'var(--color-saffron)' }}>
            Add one
          </Link>
        </p>
      ) : (
        <p className="mt-2 text-xs text-center py-3" style={{ color: 'var(--color-muted)' }}>Type to search suppliers</p>
      )}
    </div>
  )
}

// ── Success card ──────────────────────────────────────────────────────────────

function SuccessCard({ total, onNew }: { total: string; onNew: () => void }) {
  const { currency } = useAppSettings()
  return (
    <div className="py-8 flex flex-col items-center text-center gap-4">
      <div className="h-14 w-14 rounded-full flex items-center justify-center" style={{ background: 'var(--color-green-soft)' }}>
        <Check size={24} style={{ color: 'var(--color-green)' }} strokeWidth={2.5} />
      </div>
      <div>
        <p className="font-display font-bold text-[20px]" style={{ color: 'var(--color-ink)' }}>Purchase Recorded</p>
        <p className="text-sm mt-0.5" style={{ color: 'var(--color-muted)' }}>{currency} {total} · stock updated</p>
      </div>
      <div className="flex flex-col sm:flex-row gap-2 w-full max-w-xs mt-2">
        <Button variant="primary" onClick={onNew} className="flex-1">Record Another</Button>
        <Link href="/inventory/purchases" className="flex-1">
          <Button variant="outline" className="w-full">View Purchases</Button>
        </Link>
      </div>
    </div>
  )
}

// ── Main form ─────────────────────────────────────────────────────────────────

type Line = { itemId: string; quantity: string; unitPrice: string }

export function PurchaseForm({
  suppliers,
  items,
  todayDubai,
}: {
  suppliers: Supplier[]
  items: InventoryItem[]
  todayDubai: string
}) {
  const { currency } = useAppSettings()
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null)
  const [purchaseDate, setPurchaseDate] = useState(todayDubai)
  const [lines, setLines] = useState<Line[]>([])
  const [itemSearch, setItemSearch] = useState('')
  const [paymentStatus, setPaymentStatus] = useState<'unpaid' | 'partial' | 'paid'>('unpaid')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMode | ''>('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])

  const availableItems = useMemo(() => {
    const chosen = new Set(lines.map((l) => l.itemId))
    const base = items.filter((i) => i.is_active && !chosen.has(i.id))
    if (!itemSearch.trim()) return base.slice(0, 8)
    const q = itemSearch.toLowerCase()
    return base.filter((i) => i.name.toLowerCase().includes(q) || (i.category ?? '').toLowerCase().includes(q)).slice(0, 8)
  }, [items, lines, itemSearch])

  const addLine = useCallback((item: InventoryItem) => {
    setLines((prev) => [...prev, { itemId: item.id, quantity: '', unitPrice: parseFloat(item.purchase_price).toFixed(2) }])
    setItemSearch('')
  }, [])

  const removeLine = useCallback((itemId: string) => {
    setLines((prev) => prev.filter((l) => l.itemId !== itemId))
  }, [])

  const updateLine = useCallback((itemId: string, field: 'quantity' | 'unitPrice', value: string) => {
    setLines((prev) => prev.map((l) => (l.itemId === itemId ? { ...l, [field]: value } : l)))
  }, [])

  const subtotal = lines.reduce((s, l) => s + (parseFloat(l.quantity) || 0) * (parseFloat(l.unitPrice) || 0), 0)

  function handleReset() {
    setSelectedSupplier(null)
    setPurchaseDate(todayDubai)
    setLines([])
    setItemSearch('')
    setPaymentStatus('unpaid')
    setPaymentMethod('')
    setNotes('')
    setError(null)
    setSuccess(null)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!selectedSupplier) {
      setError('Please select a supplier')
      return
    }
    if (lines.length === 0) {
      setError('Add at least one item')
      return
    }
    for (const l of lines) {
      const qty = parseFloat(l.quantity)
      const price = parseFloat(l.unitPrice)
      if (!qty || qty <= 0 || isNaN(price) || price < 0) {
        setError('Every line needs a positive quantity and a valid price')
        return
      }
    }

    startTransition(async () => {
      const result = await recordPurchase({
        supplier_id: selectedSupplier.id,
        purchase_date: purchaseDate,
        payment_status: paymentStatus,
        payment_method: paymentMethod || null,
        notes: notes || null,
        items: lines.map((l) => ({
          inventory_item_id: l.itemId,
          quantity: parseFloat(l.quantity),
          unit_price: parseFloat(l.unitPrice),
        })),
      })

      if (result?.error) {
        setError(result.error)
      } else {
        setSuccess(subtotal.toFixed(2))
      }
    })
  }

  if (success) {
    return <SuccessCard total={success} onNew={handleReset} />
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Supplier card */}
      <div className="rounded-[14px] p-4" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}>
        <p className="text-[11px] font-bold uppercase tracking-wide mb-2" style={{ color: 'var(--color-muted)' }}>Supplier</p>
        <SupplierSelector suppliers={suppliers} selected={selectedSupplier} onSelect={setSelectedSupplier} />
      </div>

      {/* Date */}
      <div className="rounded-[14px] p-4" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}>
        <p className="text-[11px] font-bold uppercase tracking-wide mb-2" style={{ color: 'var(--color-muted)' }}>Purchase Date</p>
        <input type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} className={`${inputBase} sm:w-44`} style={inputStyle} />
      </div>

      {/* Item picker */}
      <div className="rounded-[14px] overflow-hidden" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}>
        <div className="px-4 pt-4 pb-3">
          <p className="text-[11px] font-bold uppercase tracking-wide mb-2.5" style={{ color: 'var(--color-muted)' }}>Add Items</p>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--color-muted)' }} />
            <input
              type="text"
              value={itemSearch}
              onChange={(e) => setItemSearch(e.target.value)}
              placeholder="Search inventory items…"
              className="w-full h-9 pl-9 pr-8 rounded-[10px] text-sm outline-none"
              style={{ background: 'var(--color-cream)', border: '1px solid var(--color-border)', color: 'var(--color-ink)' }}
            />
            {itemSearch && (
              <button type="button" onClick={() => setItemSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2">
                <X size={13} style={{ color: 'var(--color-muted)' }} />
              </button>
            )}
          </div>
        </div>

        {availableItems.length === 0 ? (
          <p className="px-4 pb-4 text-sm" style={{ color: 'var(--color-muted)' }}>
            {items.length === 0 ? (
              <>No inventory items yet. <Link href="/inventory" className="font-semibold underline" style={{ color: 'var(--color-saffron)' }}>Add items</Link></>
            ) : itemSearch ? (
              'No items match your search.'
            ) : (
              'All active items already added.'
            )}
          </p>
        ) : (
          <div>
            {availableItems.map((item, idx) => (
              <button
                key={item.id}
                type="button"
                onClick={() => addLine(item)}
                className="w-full flex items-center justify-between gap-3 px-4 py-2.5 text-left transition-colors hover:bg-cream"
                style={{ borderTop: idx > 0 ? '1px solid var(--color-border)' : undefined }}
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold" style={{ color: 'var(--color-ink)' }}>{item.name}</p>
                  <p className="text-[11px]" style={{ color: 'var(--color-muted)' }}>
                    {item.unit_of_measure} · Stock {parseFloat(item.current_stock).toFixed(2)}
                  </p>
                </div>
                <span className="text-xs font-bold flex-shrink-0" style={{ color: 'var(--color-saffron)' }}>+ Add</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Line items */}
      {lines.length > 0 && (
        <div className="rounded-[14px] p-4 space-y-3" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}>
          <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>Line Items</p>
          {lines.map((line) => {
            const item = itemById.get(line.itemId)
            if (!item) return null
            const lineTotal = (parseFloat(line.quantity) || 0) * (parseFloat(line.unitPrice) || 0)
            return (
              <div key={line.itemId} className="rounded-[11px] p-3" style={{ background: 'var(--color-cream)' }}>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <p className="text-sm font-semibold" style={{ color: 'var(--color-ink)' }}>{item.name}</p>
                  <button type="button" onClick={() => removeLine(line.itemId)} aria-label={`Remove ${item.name}`}>
                    <Trash2 size={14} style={{ color: 'var(--color-red)' }} />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10.5px] font-semibold mb-1" style={{ color: 'var(--color-muted)' }}>
                      Qty ({item.unit_of_measure})
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.001"
                      value={line.quantity}
                      onChange={(e) => updateLine(line.itemId, 'quantity', e.target.value)}
                      placeholder="0"
                      className="w-full rounded-[8px] px-2.5 py-1.5 text-sm num focus:outline-none focus:ring-1 focus:ring-saffron"
                      style={{ border: '1px solid var(--color-border)', background: 'var(--color-surface)' }}
                    />
                  </div>
                  <div>
                    <label className="block text-[10.5px] font-semibold mb-1" style={{ color: 'var(--color-muted)' }}>
                      Unit Price ({currency})
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={line.unitPrice}
                      onChange={(e) => updateLine(line.itemId, 'unitPrice', e.target.value)}
                      placeholder="0.00"
                      className="w-full rounded-[8px] px-2.5 py-1.5 text-sm num focus:outline-none focus:ring-1 focus:ring-saffron"
                      style={{ border: '1px solid var(--color-border)', background: 'var(--color-surface)' }}
                    />
                  </div>
                </div>
                <p className="text-right text-xs font-bold num mt-1.5" style={{ color: 'var(--color-ember)' }}>
                  {currency} {lineTotal.toFixed(2)}
                </p>
              </div>
            )
          })}
          <div className="flex justify-between pt-2" style={{ borderTop: '1px solid var(--color-border)' }}>
            <span className="font-bold text-sm" style={{ color: 'var(--color-ink)' }}>Subtotal</span>
            <span className="num font-extrabold text-[17px]" style={{ color: 'var(--color-ink)' }}>{currency} {subtotal.toFixed(2)}</span>
          </div>
        </div>
      )}

      {/* Payment */}
      <div className="rounded-[14px] p-4 space-y-3" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}>
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide mb-2" style={{ color: 'var(--color-muted)' }}>Payment Status</p>
          <div className="flex gap-1.5">
            {PAYMENT_STATUSES.map((s) => (
              <button
                key={s.value}
                type="button"
                onClick={() => setPaymentStatus(s.value)}
                className="px-3.5 py-1.5 rounded-pill text-sm font-semibold flex-shrink-0 transition-colors"
                style={{
                  background: paymentStatus === s.value ? 'var(--color-ink)' : 'var(--color-cream)',
                  color: paymentStatus === s.value ? 'var(--color-cream)' : 'var(--color-muted)',
                  border: '1px solid',
                  borderColor: paymentStatus === s.value ? 'var(--color-ink)' : 'var(--color-border)',
                }}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
        {paymentStatus !== 'unpaid' && (
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wide mb-2" style={{ color: 'var(--color-muted)' }}>Payment Method</label>
            <select
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value as PaymentMode)}
              className={inputBase}
              style={inputStyle}
            >
              <option value="">Select method</option>
              {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
        )}
      </div>

      {/* Notes */}
      <div className="rounded-[14px] p-4" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}>
        <label className="block text-[11px] font-bold uppercase tracking-wide mb-2" style={{ color: 'var(--color-muted)' }}>Notes (optional)</label>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Invoice number, delivery notes…" className={`${inputBase} resize-none`} style={inputStyle} />
      </div>

      {error && <p className="text-sm font-semibold" style={{ color: 'var(--color-red)' }}>{error}</p>}

      <Button type="submit" variant="primary" disabled={isPending || !selectedSupplier || lines.length === 0} className="w-full">
        {isPending ? 'Recording…' : lines.length > 0 ? `Record Purchase · ${currency} ${subtotal.toFixed(2)}` : 'Record Purchase'}
      </Button>
    </form>
  )
}
