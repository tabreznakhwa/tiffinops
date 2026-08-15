'use client'

import { useState, useMemo, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Check, Search } from 'lucide-react'
import { formatInTimeZone } from 'date-fns-tz'
import { Button } from '@/components/ui/button'
import { recordOpeningStock } from '@/lib/inventory/actions'
import type { Tables } from '@/lib/supabase/types'

type InventoryItem = Tables<'inventory_items'>

function todayDubai() {
  return formatInTimeZone(new Date(), 'Asia/Dubai', 'yyyy-MM-dd')
}

export function OpeningStockModule({ items }: { items: InventoryItem[] }) {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [asOfDate, setAsOfDate] = useState(todayDubai())
  const [counts, setCounts] = useState<Record<string, string>>(
    () => Object.fromEntries(items.map((i) => [i.id, parseFloat(i.current_stock).toString()]))
  )
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [isPending, startTransition] = useTransition()

  const filtered = useMemo(() => {
    if (!search.trim()) return items
    const q = search.toLowerCase()
    return items.filter((i) => i.name.toLowerCase().includes(q) || (i.category ?? '').toLowerCase().includes(q))
  }, [items, search])

  const changedCount = useMemo(
    () => items.filter((i) => {
      const v = counts[i.id]
      return v !== undefined && v !== '' && parseFloat(v) !== parseFloat(i.current_stock)
    }).length,
    [items, counts]
  )

  function setCount(id: string, value: string) {
    setCounts((prev) => ({ ...prev, [id]: value }))
    setSuccess(false)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    const entries = items
      .map((i) => ({ inventory_item_id: i.id, quantity: parseFloat(counts[i.id]) }))
      .filter((e) => !isNaN(e.quantity))

    if (entries.some((e) => e.quantity < 0)) {
      setError('Stock counts cannot be negative')
      return
    }
    if (entries.length === 0) {
      setError('Enter at least one stock count')
      return
    }

    startTransition(async () => {
      const result = await recordOpeningStock({ as_of_date: asOfDate, entries })
      if (result?.error) {
        setError(result.error)
      } else {
        setSuccess(true)
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

      <div className="mb-5">
        <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--color-saffron)', letterSpacing: '.12em' }}>
          Inventory
        </p>
        <h1 className="font-display font-bold text-[25px] mt-0.5" style={{ color: 'var(--color-ink)' }}>
          Opening Stock / Physical Count
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--color-muted)' }}>
          Enter the actual counted stock for each item. Only items whose count differs from the current system
          value are recorded as a stock movement.
        </p>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="flex flex-col sm:flex-row sm:items-end gap-3 mb-4">
          <div>
            <label className="block text-[11px] font-semibold mb-1" style={{ color: 'var(--color-muted)' }}>As of Date</label>
            <input
              type="date"
              value={asOfDate}
              onChange={(e) => setAsOfDate(e.target.value)}
              className="rounded-[10px] px-3 py-2 text-sm bg-surface text-ink"
              style={{ border: '1px solid var(--color-border)' }}
            />
          </div>
          <div className="relative flex-1 sm:max-w-xs">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--color-muted)' }} />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search items…"
              className="w-full h-9 pl-9 pr-3 rounded-[10px] text-sm outline-none"
              style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-ink)' }}
            />
          </div>
        </div>

        {items.length === 0 ? (
          <div className="py-16 text-center" style={{ color: 'var(--color-muted)' }}>
            <p className="font-semibold text-[15px]">No inventory items yet</p>
          </div>
        ) : (
          <div className="rounded-[14px] overflow-hidden" style={{ border: '1px solid var(--color-border)', background: 'var(--color-surface)', boxShadow: 'var(--shadow-card)' }}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[520px]">
                <thead>
                  <tr style={{ background: 'var(--color-cream)', borderBottom: '1px solid var(--color-border)' }}>
                    {['Item', 'System Stock', 'Counted Stock'].map((h) => (
                      <th key={h} className="text-left px-4 py-3 text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((item, i) => {
                    const value = counts[item.id] ?? ''
                    const changed = value !== '' && parseFloat(value) !== parseFloat(item.current_stock)
                    return (
                      <tr key={item.id} style={{ borderTop: i > 0 ? '1px solid var(--color-border)' : undefined, background: changed ? 'var(--color-cream)' : undefined }}>
                        <td className="px-4 py-3">
                          <span className="font-semibold" style={{ color: 'var(--color-ink)' }}>{item.name}</span>
                          <span className="ml-1.5 text-[11px]" style={{ color: 'var(--color-muted)' }}>({item.unit_of_measure})</span>
                        </td>
                        <td className="px-4 py-3 num" style={{ color: 'var(--color-muted)' }}>
                          {parseFloat(item.current_stock).toFixed(3).replace(/\.?0+$/, '') || '0'}
                        </td>
                        <td className="px-4 py-3">
                          <input
                            type="number"
                            min="0"
                            step="0.001"
                            value={value}
                            onChange={(e) => setCount(item.id, e.target.value)}
                            className="w-28 rounded-[8px] px-2.5 py-1.5 text-sm num focus:outline-none focus:ring-1 focus:ring-saffron"
                            style={{ border: `1px solid ${changed ? 'var(--color-saffron)' : 'var(--color-border)'}`, background: 'var(--color-surface)' }}
                          />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {error && <p className="mt-4 text-sm font-semibold" style={{ color: 'var(--color-red)' }}>{error}</p>}
        {success && (
          <p className="mt-4 text-sm font-semibold inline-flex items-center gap-1.5" style={{ color: 'var(--color-green)' }}>
            <Check size={15} />
            Stock counts saved
          </p>
        )}

        <div className="mt-5 flex justify-end">
          <Button type="submit" variant="primary" disabled={isPending || items.length === 0}>
            {isPending ? 'Saving…' : changedCount > 0 ? `Save ${changedCount} Change${changedCount === 1 ? '' : 's'}` : 'Save Stock Count'}
          </Button>
        </div>
      </form>
    </div>
  )
}
