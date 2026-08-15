'use client'

import { useState, useMemo, useCallback, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Plus, Search, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { recordConsumption } from '@/lib/inventory/actions'
import type { Tables } from '@/lib/supabase/types'

type InventoryItem = Tables<'inventory_items'>

export type ConsumptionRow = {
  id: string
  quantity: string
  notes: string | null
  created_at: string
  inventory_items: { name: string; unit_of_measure: string } | null
}

type Line = { itemId: string; quantity: string; notes: string }

export function ConsumptionModule({
  items,
  entries,
  date,
  canWrite,
}: {
  items: InventoryItem[]
  entries: ConsumptionRow[]
  date: string
  canWrite: boolean
}) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [formOpen, setFormOpen] = useState(false)
  const [lines, setLines] = useState<Line[]>([])
  const [itemSearch, setItemSearch] = useState('')
  const [error, setError] = useState<string | null>(null)
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
    setLines((prev) => [...prev, { itemId: item.id, quantity: '', notes: '' }])
    setItemSearch('')
  }, [])

  const removeLine = useCallback((itemId: string) => {
    setLines((prev) => prev.filter((l) => l.itemId !== itemId))
  }, [])

  const updateLine = useCallback((itemId: string, field: 'quantity' | 'notes', value: string) => {
    setLines((prev) => prev.map((l) => (l.itemId === itemId ? { ...l, [field]: value } : l)))
  }, [])

  function changeDate(newDate: string) {
    const params = new URLSearchParams(searchParams.toString())
    params.set('date', newDate)
    router.push(`/inventory/consumption?${params.toString()}`)
  }

  function resetForm() {
    setLines([])
    setItemSearch('')
    setError(null)
    setFormOpen(false)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (lines.length === 0) {
      setError('Add at least one item')
      return
    }
    for (const l of lines) {
      const qty = parseFloat(l.quantity)
      if (!qty || qty <= 0) {
        setError('Every line needs a positive quantity')
        return
      }
    }
    startTransition(async () => {
      const result = await recordConsumption({
        consumption_date: date,
        entries: lines.map((l) => ({
          inventory_item_id: l.itemId,
          quantity: parseFloat(l.quantity),
          notes: l.notes || null,
        })),
      })
      if (result?.error) {
        setError(result.error)
      } else {
        resetForm()
        router.refresh()
      }
    })
  }

  const totalLines = entries.length

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
          <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--color-saffron)', letterSpacing: '.12em' }}>
            Inventory
          </p>
          <h1 className="font-display font-bold text-[25px] mt-0.5" style={{ color: 'var(--color-ink)' }}>
            Daily Consumption
          </h1>
        </div>
        {canWrite && !formOpen && (
          <Button variant="primary" size="sm" onClick={() => setFormOpen(true)}>
            <Plus size={15} />
            Log Consumption
          </Button>
        )}
      </div>

      <div className="mb-5">
        <label className="block text-[11px] font-semibold mb-1" style={{ color: 'var(--color-muted)' }}>Date</label>
        <input
          type="date"
          value={date}
          onChange={(e) => changeDate(e.target.value)}
          className="rounded-[10px] px-3 py-2 text-sm bg-surface text-ink"
          style={{ border: '1px solid var(--color-border)' }}
        />
      </div>

      {canWrite && formOpen && (
        <form
          onSubmit={handleSubmit}
          className="rounded-[14px] p-4 mb-6 space-y-3"
          style={{ background: 'var(--color-cream)', border: '1px solid var(--color-border)' }}
        >
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>
              New Entries for {date}
            </p>
            <button type="button" onClick={resetForm} aria-label="Cancel">
              <X size={16} style={{ color: 'var(--color-muted)' }} />
            </button>
          </div>

          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--color-muted)' }} />
            <input
              type="text"
              value={itemSearch}
              onChange={(e) => setItemSearch(e.target.value)}
              placeholder="Search inventory items to add…"
              className="w-full h-9 pl-9 pr-8 rounded-[10px] text-sm outline-none"
              style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-ink)' }}
            />
            {itemSearch && (
              <button type="button" onClick={() => setItemSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2">
                <X size={13} style={{ color: 'var(--color-muted)' }} />
              </button>
            )}
          </div>

          {availableItems.length > 0 && (
            <div className="rounded-[11px] overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
              {availableItems.map((item, idx) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => addLine(item)}
                  className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left transition-colors hover:bg-cream"
                  style={{ borderTop: idx > 0 ? '1px solid var(--color-border)' : undefined, background: 'var(--color-surface)' }}
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

          {lines.length > 0 && (
            <div className="space-y-2">
              {lines.map((line) => {
                const item = itemById.get(line.itemId)
                if (!item) return null
                return (
                  <div key={line.itemId} className="rounded-[11px] p-3" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <p className="text-sm font-semibold" style={{ color: 'var(--color-ink)' }}>{item.name}</p>
                      <button type="button" onClick={() => removeLine(line.itemId)} aria-label={`Remove ${item.name}`}>
                        <Trash2 size={14} style={{ color: 'var(--color-red)' }} />
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[10.5px] font-semibold mb-1" style={{ color: 'var(--color-muted)' }}>
                          Qty used ({item.unit_of_measure})
                        </label>
                        <input
                          type="number"
                          min="0"
                          step="0.001"
                          value={line.quantity}
                          onChange={(e) => updateLine(line.itemId, 'quantity', e.target.value)}
                          placeholder="0"
                          className="w-full rounded-[8px] px-2.5 py-1.5 text-sm num focus:outline-none focus:ring-1 focus:ring-saffron"
                          style={{ border: '1px solid var(--color-border)' }}
                        />
                      </div>
                      <div>
                        <label className="block text-[10.5px] font-semibold mb-1" style={{ color: 'var(--color-muted)' }}>Notes</label>
                        <input
                          value={line.notes}
                          onChange={(e) => updateLine(line.itemId, 'notes', e.target.value)}
                          placeholder="Optional"
                          className="w-full rounded-[8px] px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-saffron"
                          style={{ border: '1px solid var(--color-border)' }}
                        />
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {error && <p className="text-sm font-semibold" style={{ color: 'var(--color-red)' }}>{error}</p>}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={resetForm} disabled={isPending}>Cancel</Button>
            <Button type="submit" variant="primary" size="sm" disabled={isPending || lines.length === 0}>
              {isPending ? 'Saving…' : `Save ${lines.length || ''} Entr${lines.length === 1 ? 'y' : 'ies'}`}
            </Button>
          </div>
        </form>
      )}

      <h2 className="font-display font-bold text-[15px] mb-3" style={{ color: 'var(--color-ink)' }}>
        {totalLines} Entr{totalLines === 1 ? 'y' : 'ies'} on {date}
      </h2>
      {entries.length === 0 ? (
        <div className="py-12 text-center" style={{ color: 'var(--color-muted)' }}>
          <p className="font-semibold text-sm">No consumption logged for this date</p>
        </div>
      ) : (
        <div className="rounded-[14px] overflow-hidden" style={{ border: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[480px]">
              <thead>
                <tr style={{ background: 'var(--color-cream)', borderBottom: '1px solid var(--color-border)' }}>
                  {['Item', 'Quantity Used', 'Notes'].map((h) => (
                    <th key={h} className="text-left px-4 py-3 text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {entries.map((e, i) => (
                  <tr key={e.id} style={{ borderTop: i > 0 ? '1px solid var(--color-border)' : undefined }}>
                    <td className="px-4 py-3 font-semibold" style={{ color: 'var(--color-ink)' }}>{e.inventory_items?.name ?? '—'}</td>
                    <td className="px-4 py-3 num" style={{ color: 'var(--color-ember)' }}>
                      {Math.abs(parseFloat(e.quantity))} {e.inventory_items?.unit_of_measure}
                    </td>
                    <td className="px-4 py-3" style={{ color: 'var(--color-muted)' }}>{e.notes || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
