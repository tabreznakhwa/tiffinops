'use client'

// Owner-only purchase correction form. Pre-filled from the saved purchase;
// submitting calls updatePurchase which reverses the old stock lines and
// posts the new ones, so the item ledgers show the full correction.
// Non-owners and voided purchases get a read-only view instead.

import { useState, useTransition, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Ban, Paperclip, Search, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { updatePurchase } from '@/lib/inventory/actions'
import { getReceiptUrl } from '@/lib/scan/actions'
import { useAppSettings } from '@/components/settings/settings-context'
import { SupplierSelector } from './purchase-form'
import type { Tables, Enums } from '@/lib/supabase/types'

type Supplier = Tables<'suppliers'>
type InventoryItem = Tables<'inventory_items'>
type PaymentMode = Enums<'payment_mode'>

export type PurchaseHeader = {
  id: string
  purchase_number: string
  purchase_date: string
  supplier_id: string | null
  payment_status: string
  payment_method: string | null
  vat_amount: string | null
  total_amount: string
  notes: string | null
  receipt_path: string | null
  supplier_invoice_no: string | null
  voided_at: string | null
  void_reason: string | null
  voided_by_name: string | null
  edited_at: string | null
  edit_reason: string | null
  edited_by_name: string | null
  supplier_name: string | null
}

export type PurchaseLine = {
  inventory_item_id: string
  quantity: string
  unit_price: string
  pack_qty: string | null
  pack_size: string | null
  pack_unit: string | null
}

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

type Line = { itemId: string; quantity: string; unitPrice: string }

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function ReceiptButton({ path }: { path: string }) {
  const [, startTransition] = useTransition()
  return (
    <button
      type="button"
      onClick={() =>
        startTransition(async () => {
          const res = await getReceiptUrl(path)
          if (res.url) window.open(res.url, '_blank', 'noopener')
        })
      }
      className="inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1.5 rounded-pill transition-colors hover:bg-cream"
      style={{ color: 'var(--color-saffron)', border: '1px solid var(--color-border)' }}
    >
      <Paperclip size={12} />
      View scanned bill
    </button>
  )
}

export function PurchaseEditForm({
  purchase,
  purchaseLines,
  suppliers,
  items,
  isOwner,
}: {
  purchase: PurchaseHeader
  purchaseLines: PurchaseLine[]
  suppliers: Supplier[]
  items: InventoryItem[]
  isOwner: boolean
}) {
  const router = useRouter()
  const { currency } = useAppSettings()

  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(
    suppliers.find(s => s.id === purchase.supplier_id) ?? null,
  )
  const [purchaseDate, setPurchaseDate] = useState(purchase.purchase_date)
  const [lines, setLines] = useState<Line[]>(
    purchaseLines.map(l => ({
      itemId: l.inventory_item_id,
      quantity: parseFloat(l.quantity).toString(),
      unitPrice: parseFloat(l.unit_price).toFixed(2),
    })),
  )
  const [itemSearch, setItemSearch] = useState('')
  const [paymentStatus, setPaymentStatus] = useState<'unpaid' | 'partial' | 'paid'>(
    (['unpaid', 'partial', 'paid'].includes(purchase.payment_status) ? purchase.payment_status : 'unpaid') as 'unpaid' | 'partial' | 'paid',
  )
  const [paymentMethod, setPaymentMethod] = useState<PaymentMode | ''>((purchase.payment_method as PaymentMode | null) ?? '')
  const [editReason, setEditReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const itemById = useMemo(() => new Map(items.map(i => [i.id, i])), [items])

  // Pack breakdowns are audit info from the scanned bill — keep them only for
  // lines the owner did not touch, otherwise they would no longer match.
  const originalByItem = useMemo(() => new Map(purchaseLines.map(l => [l.inventory_item_id, l])), [purchaseLines])

  const availableItems = useMemo(() => {
    const chosen = new Set(lines.map(l => l.itemId))
    const base = items.filter(i => i.is_active && !chosen.has(i.id))
    if (!itemSearch.trim()) return base.slice(0, 8)
    const q = itemSearch.toLowerCase()
    return base.filter(i => i.name.toLowerCase().includes(q) || (i.category ?? '').toLowerCase().includes(q)).slice(0, 8)
  }, [items, lines, itemSearch])

  const addLine = useCallback((item: InventoryItem) => {
    setLines(prev => [...prev, { itemId: item.id, quantity: '', unitPrice: parseFloat(item.purchase_price).toFixed(2) }])
    setItemSearch('')
  }, [])

  const removeLine = useCallback((itemId: string) => {
    setLines(prev => prev.filter(l => l.itemId !== itemId))
  }, [])

  const updateLine = useCallback((itemId: string, field: 'quantity' | 'unitPrice', value: string) => {
    setLines(prev => prev.map(l => (l.itemId === itemId ? { ...l, [field]: value } : l)))
  }, [])

  const subtotal = lines.reduce((s, l) => s + (parseFloat(l.quantity) || 0) * (parseFloat(l.unitPrice) || 0), 0)
  const vat = purchase.vat_amount != null ? parseFloat(purchase.vat_amount) : 0
  const newTotal = subtotal + vat
  const originalTotal = parseFloat(purchase.total_amount)
  const totalChanged = Math.abs(newTotal - originalTotal) >= 0.005

  const voided = !!purchase.voided_at
  const readOnly = voided || !isOwner

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!selectedSupplier) return setError('Please select a supplier')
    if (lines.length === 0) return setError('Add at least one item')
    for (const l of lines) {
      const qty = parseFloat(l.quantity)
      const price = parseFloat(l.unitPrice)
      if (!qty || qty <= 0 || isNaN(price) || price < 0) {
        return setError('Every line needs a positive quantity and a valid price')
      }
    }
    if (editReason.trim().length < 3) return setError('Please give a reason for this edit (at least 3 characters)')

    startTransition(async () => {
      const result = await updatePurchase(
        purchase.id,
        {
          supplier_id: selectedSupplier.id,
          purchase_date: purchaseDate,
          payment_status: paymentStatus,
          payment_method: paymentMethod || null,
          vat_amount: purchase.vat_amount != null ? parseFloat(purchase.vat_amount) : null,
          items: lines.map(l => {
            const orig = originalByItem.get(l.itemId)
            const untouched =
              orig != null &&
              parseFloat(orig.quantity) === parseFloat(l.quantity) &&
              parseFloat(orig.unit_price) === parseFloat(l.unitPrice)
            return {
              inventory_item_id: l.itemId,
              quantity: parseFloat(l.quantity),
              unit_price: parseFloat(l.unitPrice),
              pack_qty: untouched && orig.pack_qty != null ? parseFloat(orig.pack_qty) : null,
              pack_size: untouched && orig.pack_size != null ? parseFloat(orig.pack_size) : null,
              pack_unit: untouched ? orig.pack_unit : null,
            }
          }),
        },
        editReason.trim(),
      )
      if (result?.error) {
        setError(result.error)
      } else {
        router.push('/inventory/purchases')
        router.refresh()
      }
    })
  }

  // ── Read-only view (voided, or viewer is not the owner) ────────────────────
  if (readOnly) {
    return (
      <div className="space-y-4">
        {voided && (
          <div className="rounded-[14px] p-4 flex items-start gap-2.5" style={{ background: 'var(--color-red-soft)', border: '1px solid var(--color-red)' }}>
            <Ban size={17} className="mt-0.5 flex-shrink-0" style={{ color: 'var(--color-red)' }} />
            <div>
              <p className="font-bold text-sm" style={{ color: 'var(--color-red)' }}>
                Voided{purchase.voided_by_name ? ` by ${purchase.voided_by_name}` : ''}{purchase.voided_at ? ` · ${fmtDateTime(purchase.voided_at)}` : ''}
              </p>
              <p className="text-sm mt-0.5" style={{ color: 'var(--color-ink)' }}>{purchase.void_reason}</p>
              <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>Stock from this purchase was reversed. The record is kept for the audit trail.</p>
            </div>
          </div>
        )}

        <div className="rounded-[14px] p-4 space-y-2" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}>
          {[
            ['Supplier', purchase.supplier_name ?? '—'],
            ['Date', purchase.purchase_date],
            ['Invoice no.', purchase.supplier_invoice_no ?? '—'],
            ['Payment', purchase.payment_status],
            ['Total', `${currency} ${originalTotal.toFixed(2)}`],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between text-sm">
              <span style={{ color: 'var(--color-muted)' }}>{k}</span>
              <span className="font-semibold" style={{ color: 'var(--color-ink)', textDecoration: voided && k === 'Total' ? 'line-through' : undefined }}>{v}</span>
            </div>
          ))}
          {purchase.receipt_path && <div className="pt-1"><ReceiptButton path={purchase.receipt_path} /></div>}
        </div>

        <div className="rounded-[14px] overflow-hidden" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}>
          {purchaseLines.map((l, idx) => {
            const item = itemById.get(l.inventory_item_id)
            return (
              <div key={idx} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm" style={{ borderTop: idx > 0 ? '1px solid var(--color-border)' : undefined }}>
                <span className="font-semibold" style={{ color: 'var(--color-ink)' }}>{item?.name ?? 'Unknown item'}</span>
                <span className="num" style={{ color: 'var(--color-muted)' }}>
                  {parseFloat(l.quantity)} × {currency} {parseFloat(l.unit_price).toFixed(2)}
                </span>
              </div>
            )
          })}
        </div>

        {!voided && !isOwner && (
          <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Only the owner can edit or void a purchase.</p>
        )}
      </div>
    )
  }

  // ── Owner edit form ─────────────────────────────────────────────────────────
  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {purchase.edited_at && (
        <div className="rounded-[14px] p-3.5 text-sm" style={{ background: 'var(--color-cream)', border: '1px solid var(--color-border)' }}>
          <span className="font-bold" style={{ color: 'var(--color-ink)' }}>
            Last edited{purchase.edited_by_name ? ` by ${purchase.edited_by_name}` : ''} · {fmtDateTime(purchase.edited_at)}
          </span>
          {purchase.edit_reason && <span style={{ color: 'var(--color-muted)' }}> — {purchase.edit_reason}</span>}
        </div>
      )}

      {/* Supplier card */}
      <div className="rounded-[14px] p-4" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}>
        <div className="flex items-center justify-between mb-2">
          <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>Supplier</p>
          {purchase.receipt_path && <ReceiptButton path={purchase.receipt_path} />}
        </div>
        <SupplierSelector suppliers={suppliers} selected={selectedSupplier} onSelect={setSelectedSupplier} />
      </div>

      {/* Date */}
      <div className="rounded-[14px] p-4" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}>
        <p className="text-[11px] font-bold uppercase tracking-wide mb-2" style={{ color: 'var(--color-muted)' }}>Purchase Date</p>
        <input type="date" value={purchaseDate} onChange={e => setPurchaseDate(e.target.value)} className={`${inputBase} sm:w-44`} style={inputStyle} />
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
              onChange={e => setItemSearch(e.target.value)}
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
        {availableItems.length > 0 && (
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
          {lines.map(line => {
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
                      onChange={e => updateLine(line.itemId, 'quantity', e.target.value)}
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
                      onChange={e => updateLine(line.itemId, 'unitPrice', e.target.value)}
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
            <div>
              <span className="font-bold text-sm" style={{ color: 'var(--color-ink)' }}>New total</span>
              {totalChanged && (
                <span className="text-xs ml-2 num line-through" style={{ color: 'var(--color-muted)' }}>
                  was {currency} {originalTotal.toFixed(2)}
                </span>
              )}
            </div>
            <span className="num font-extrabold text-[17px]" style={{ color: totalChanged ? 'var(--color-ember)' : 'var(--color-ink)' }}>
              {currency} {newTotal.toFixed(2)}
            </span>
          </div>
        </div>
      )}

      {/* Payment */}
      <div className="rounded-[14px] p-4 space-y-3" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}>
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide mb-2" style={{ color: 'var(--color-muted)' }}>Payment Status</p>
          <div className="flex gap-1.5">
            {PAYMENT_STATUSES.map(s => (
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
            <select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value as PaymentMode)} className={inputBase} style={inputStyle}>
              <option value="">Select method</option>
              {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
        )}
      </div>

      {/* Mandatory edit reason */}
      <div className="rounded-[14px] p-4" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-saffron)', boxShadow: 'var(--shadow-card)' }}>
        <label className="block text-[11px] font-bold uppercase tracking-wide mb-2" style={{ color: 'var(--color-ember)' }}>
          Reason for edit (required)
        </label>
        <textarea
          value={editReason}
          onChange={e => setEditReason(e.target.value)}
          rows={2}
          placeholder="e.g. Scanner read 5 kg instead of 3 kg"
          className={`${inputBase} resize-none`}
          style={inputStyle}
        />
        <p className="text-xs mt-1.5" style={{ color: 'var(--color-muted)' }}>
          Saving reverses the old stock lines and posts the corrected ones — the item ledger keeps both for the audit trail.
        </p>
      </div>

      {error && <p className="text-sm font-semibold" style={{ color: 'var(--color-red)' }}>{error}</p>}

      <div className="flex gap-2">
        <Link href="/inventory/purchases" className="flex-1">
          <Button type="button" variant="outline" className="w-full">Cancel</Button>
        </Link>
        <Button
          type="submit"
          variant="primary"
          disabled={isPending || !selectedSupplier || lines.length === 0 || editReason.trim().length < 3}
          className="flex-1"
        >
          {isPending ? 'Saving…' : `Save Changes · ${currency} ${newTotal.toFixed(2)}`}
        </Button>
      </div>
    </form>
  )
}
