'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Edit2 } from 'lucide-react'
import { formatInTimeZone } from 'date-fns-tz'
import { Button } from '@/components/ui/button'
import { ItemModal } from './item-modal'
import { recordAdjustment } from '@/lib/inventory/actions'
import { useAppSettings } from '@/components/settings/settings-context'
import type { Tables, Enums } from '@/lib/supabase/types'

type InventoryItem = Tables<'inventory_items'>
type InventoryTxn = Tables<'inventory_transactions'>

const TXN_LABELS: Record<Enums<'inventory_txn_type'>, { label: string; color: string }> = {
  purchase:      { label: 'Purchase',      color: 'var(--color-green)'  },
  consumption:   { label: 'Consumption',   color: 'var(--color-ember)'  },
  adjustment:    { label: 'Adjustment',    color: 'var(--color-blue)'   },
  damaged:       { label: 'Damaged',       color: 'var(--color-red)'    },
  opening_stock: { label: 'Opening Stock', color: 'var(--color-purple)' },
}

function todayDubai() {
  return formatInTimeZone(new Date(), 'Asia/Dubai', 'yyyy-MM-dd')
}

export function ItemDetail({
  item,
  transactions,
  canManageItem,
  canRecordTxns,
}: {
  item: InventoryItem
  transactions: InventoryTxn[]
  canManageItem: boolean
  canRecordTxns: boolean
}) {
  const router = useRouter()
  const { currency } = useAppSettings()
  const [editOpen, setEditOpen] = useState(false)
  const [adjustOpen, setAdjustOpen] = useState(false)
  const [adjustType, setAdjustType] = useState<'adjustment' | 'damaged'>('adjustment')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const low = parseFloat(item.current_stock) <= parseFloat(item.min_stock_level)

  function handleAdjustSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const formData = new FormData(e.currentTarget)
    const quantity = parseFloat(String(formData.get('quantity')))
    const date = String(formData.get('transaction_date'))
    const notes = String(formData.get('notes') || '')
    startTransition(async () => {
      const result = await recordAdjustment({
        inventory_item_id: item.id,
        transaction_date: date,
        transaction_type: adjustType,
        quantity,
        notes,
      })
      if (result?.error) {
        setError(result.error)
      } else {
        setAdjustOpen(false)
        router.refresh()
      }
    })
  }

  return (
    <div>
      <Link
        href="/inventory"
        className="inline-flex items-center gap-1.5 text-sm font-semibold transition-opacity hover:opacity-70 mb-4"
        style={{ color: 'var(--color-muted)' }}
      >
        <ArrowLeft size={15} />
        Inventory
      </Link>

      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <p className="text-xs font-mono" style={{ color: 'var(--color-muted)' }}>{item.item_code}</p>
          <h1 className="font-display font-bold text-[22px] mt-0.5" style={{ color: 'var(--color-ink)' }}>
            {item.name}
          </h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--color-muted)' }}>
            {item.category || 'Uncategorized'} · {item.storage_location || 'No location set'}
          </p>
        </div>
        {(canRecordTxns || canManageItem) && (
          <div className="flex gap-2 flex-shrink-0">
            {canRecordTxns && (
              <Button variant="ghost" size="sm" onClick={() => setAdjustOpen(v => !v)}>Adjust Stock</Button>
            )}
            {canManageItem && (
              <Button variant="ghost" size="sm" onClick={() => setEditOpen(true)}>
                <Edit2 size={14} />
                Edit
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="rounded-[14px] p-4" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>Current Stock</p>
          <p className="font-display font-bold text-xl mt-1 num" style={{ color: low ? 'var(--color-red)' : 'var(--color-ink)' }}>
            {parseFloat(item.current_stock).toFixed(3).replace(/\.?0+$/, '') || '0'} {item.unit_of_measure}
          </p>
          {low && <p className="text-[11px] font-semibold mt-0.5" style={{ color: 'var(--color-red)' }}>Below minimum</p>}
        </div>
        <div className="rounded-[14px] p-4" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>Min Level</p>
          <p className="font-display font-bold text-xl mt-1 num" style={{ color: 'var(--color-ink)' }}>
            {parseFloat(item.min_stock_level).toFixed(3).replace(/\.?0+$/, '') || '0'} {item.unit_of_measure}
          </p>
        </div>
        <div className="rounded-[14px] p-4" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>Purchase Price</p>
          <p className="font-display font-bold text-xl mt-1 num" style={{ color: 'var(--color-ink)' }}>
            {currency} {parseFloat(item.purchase_price).toFixed(2)}
          </p>
        </div>
      </div>

      {/* Adjust stock inline form */}
      {adjustOpen && (
        <form
          onSubmit={handleAdjustSubmit}
          className="rounded-[14px] p-4 mb-6 space-y-3"
          style={{ background: 'var(--color-cream)', border: '1px solid var(--color-border)' }}
        >
          <div className="flex gap-2">
            {(['adjustment', 'damaged'] as const).map(t => (
              <button
                key={t}
                type="button"
                onClick={() => setAdjustType(t)}
                className="px-3 py-1.5 rounded-pill text-xs font-bold transition-colors"
                style={{
                  background: adjustType === t ? 'var(--color-ink)' : 'var(--color-surface)',
                  color: adjustType === t ? 'var(--color-cream)' : 'var(--color-muted)',
                  border: '1px solid',
                  borderColor: adjustType === t ? 'var(--color-ink)' : 'var(--color-border)',
                }}
              >
                {TXN_LABELS[t].label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--color-muted)' }}>Date</label>
              <input
                name="transaction_date"
                type="date"
                defaultValue={todayDubai()}
                required
                className="w-full rounded-[10px] px-3 py-2 text-sm bg-surface text-ink"
                style={{ border: '1px solid var(--color-border)' }}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--color-muted)' }}>
                Quantity ({item.unit_of_measure}) {adjustType === 'adjustment' && <span style={{ color: 'var(--color-muted)' }}>— use minus for reduction</span>}
              </label>
              <input
                name="quantity"
                type="number"
                step="0.001"
                required
                placeholder={adjustType === 'damaged' ? 'e.g. 2' : 'e.g. -1.5 or 3'}
                className="w-full rounded-[10px] px-3 py-2 text-sm bg-surface text-ink"
                style={{ border: '1px solid var(--color-border)' }}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--color-muted)' }}>Notes</label>
              <input
                name="notes"
                className="w-full rounded-[10px] px-3 py-2 text-sm bg-surface text-ink"
                style={{ border: '1px solid var(--color-border)' }}
                placeholder="Reason"
              />
            </div>
          </div>
          {error && <p className="text-sm font-semibold" style={{ color: 'var(--color-red)' }}>{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setAdjustOpen(false)} disabled={isPending}>Cancel</Button>
            <Button type="submit" variant="primary" size="sm" disabled={isPending}>{isPending ? 'Saving…' : 'Save'}</Button>
          </div>
        </form>
      )}

      {/* Transaction history */}
      <h2 className="font-display font-bold text-[15px] mb-3" style={{ color: 'var(--color-ink)' }}>Transaction History</h2>
      {transactions.length === 0 ? (
        <div className="py-12 text-center" style={{ color: 'var(--color-muted)' }}>
          <p className="font-semibold text-sm">No stock movements yet</p>
        </div>
      ) : (
        <div className="rounded-[14px] overflow-hidden" style={{ border: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[560px]">
              <thead>
                <tr style={{ background: 'var(--color-cream)', borderBottom: '1px solid var(--color-border)' }}>
                  {['Date', 'Type', 'Qty', 'Before → After', 'Notes'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {transactions.map((t, i) => {
                  const cfg = TXN_LABELS[t.transaction_type]
                  const qty = parseFloat(t.quantity)
                  return (
                    <tr key={t.id} style={{ borderTop: i > 0 ? '1px solid var(--color-border)' : undefined }}>
                      <td className="px-4 py-3" style={{ color: 'var(--color-muted)' }}>{t.transaction_date}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-pill text-[11px] font-bold" style={{ background: 'var(--color-cream)', color: cfg.color }}>
                          {cfg.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 num font-semibold" style={{ color: qty >= 0 ? 'var(--color-green)' : 'var(--color-red)' }}>
                        {qty >= 0 ? '+' : ''}{qty}
                      </td>
                      <td className="px-4 py-3 num" style={{ color: 'var(--color-muted)' }}>
                        {parseFloat(t.stock_before).toFixed(2)} → {parseFloat(t.stock_after).toFixed(2)}
                      </td>
                      <td className="px-4 py-3" style={{ color: 'var(--color-muted)' }}>{t.notes || '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <ItemModal item={item} open={editOpen} onClose={() => setEditOpen(false)} onSuccess={() => router.refresh()} />
    </div>
  )
}
