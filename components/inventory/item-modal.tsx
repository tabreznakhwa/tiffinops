'use client'

import { useState, useTransition, useEffect, useRef, useMemo } from 'react'
import { X, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { createInventoryItem, updateInventoryItem } from '@/lib/inventory/actions'
import { INVENTORY_CATALOG, INVENTORY_CATALOG_CATEGORIES, type CatalogItem } from '@/lib/inventory/catalog'
import type { Tables } from '@/lib/supabase/types'

type InventoryItem = Tables<'inventory_items'>

const inputBase =
  'mt-1 w-full rounded-[11px] px-3 py-2.5 text-sm bg-surface text-ink focus:outline-none focus:ring-1 focus:ring-saffron'
const inputStyle = { border: '1px solid var(--color-border)' } as const

const UNIT_SUGGESTIONS = ['kg', 'g', 'l', 'ml', 'pcs', 'box', 'packet', 'dozen']

// ── Item-name search dropdown ────────────────────────────────────────────────
// Searchable picker over a curated Indian/Pakistani/Indo-Chinese restaurant
// catalog (rice, oils, masalas, disposables, etc). Picking an entry pre-fills
// category + unit; typing a name that isn't in the list just adds it as-is.

function ItemNameField({
  value,
  onChange,
  onPick,
}: {
  value: string
  onChange: (v: string) => void
  onPick: (entry: CatalogItem) => void
}) {
  const [open, setOpen] = useState(false)

  const suggestions = useMemo(() => {
    const q = value.trim().toLowerCase()
    if (!q) return INVENTORY_CATALOG.slice(0, 8)
    return INVENTORY_CATALOG
      .filter(c => c.name.toLowerCase().includes(q) || c.category.toLowerCase().includes(q))
      .slice(0, 8)
  }, [value])

  return (
    <div className="relative mt-1">
      <div className="relative">
        <input
          name="name"
          value={value}
          onChange={(e) => { onChange(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          required
          autoComplete="off"
          className="w-full rounded-[11px] pl-8 pr-3 py-2.5 text-sm bg-surface text-ink focus:outline-none focus:ring-1 focus:ring-saffron"
          style={inputStyle}
          placeholder="Search or type a new item…"
        />
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--color-muted)' }} />
      </div>
      {open && suggestions.length > 0 && (
        <div
          className="absolute z-10 left-0 right-0 mt-1 rounded-[11px] overflow-hidden max-h-56 overflow-y-auto"
          style={{ border: '1px solid var(--color-border)', background: 'var(--color-surface)', boxShadow: '0 8px 24px rgba(34,26,19,.16)' }}
        >
          {suggestions.map((s, idx) => (
            <button
              key={s.name}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { onPick(s); setOpen(false) }}
              className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-cream"
              style={{ borderTop: idx > 0 ? '1px solid var(--color-border)' : undefined }}
            >
              <span style={{ color: 'var(--color-ink)' }}>{s.name}</span>
              <span className="text-[11px] flex-shrink-0" style={{ color: 'var(--color-muted)' }}>{s.category}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// Name/category/unit fields as their own subtree so they remount (and their local
// state resets) each time the modal opens — ItemModal itself stays mounted between opens.
function ItemFormFields({ item }: { item?: InventoryItem }) {
  const [name, setName] = useState(item?.name ?? '')
  const [category, setCategory] = useState(item?.category ?? '')
  const [unit, setUnit] = useState(item?.unit_of_measure ?? '')

  function handlePickCatalogItem(entry: CatalogItem) {
    setName(entry.name)
    setCategory(entry.category)
    setUnit(entry.unit_of_measure)
  }

  return (
    <>
      <div>
        <label className="block text-sm font-semibold" style={{ color: 'var(--color-ink)' }}>
          Item Name <span style={{ color: 'var(--color-red)' }}>*</span>
        </label>
        <ItemNameField value={name} onChange={setName} onPick={handlePickCatalogItem} />
        <p className="mt-1 text-[11px]" style={{ color: 'var(--color-muted)' }}>
          Search the Indian / Pakistani / Indo-Chinese catalog, or just type a new item name.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-semibold" style={{ color: 'var(--color-ink)' }}>
            Category
          </label>
          <input
            name="category"
            list="category-suggestions"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className={inputBase}
            style={inputStyle}
            placeholder="e.g. Grains, Vegetables"
          />
          <datalist id="category-suggestions">
            {INVENTORY_CATALOG_CATEGORIES.map(c => <option key={c} value={c} />)}
          </datalist>
        </div>
        <div>
          <label className="block text-sm font-semibold" style={{ color: 'var(--color-ink)' }}>
            Unit <span style={{ color: 'var(--color-red)' }}>*</span>
          </label>
          <input
            name="unit_of_measure"
            list="unit-suggestions"
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            required
            className={inputBase}
            style={inputStyle}
            placeholder="kg"
          />
          <datalist id="unit-suggestions">
            {UNIT_SUGGESTIONS.map(u => <option key={u} value={u} />)}
          </datalist>
        </div>
      </div>
    </>
  )
}

export function ItemModal({
  item,
  open,
  onClose,
  onSuccess,
}: {
  item?: InventoryItem
  open: boolean
  onClose: () => void
  onSuccess: () => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const backdropRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [open])

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const formData = new FormData(e.currentTarget)
    startTransition(async () => {
      const result = item
        ? await updateInventoryItem(item.id, formData)
        : await createInventoryItem(formData)
      if (result?.error) {
        setError(result.error)
      } else {
        onSuccess()
        onClose()
      }
    })
  }

  if (!open) return null

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4"
      style={{ background: 'rgba(34,26,19,0.5)', backdropFilter: 'blur(3px)' }}
      onMouseDown={(e) => { if (e.target === backdropRef.current) onClose() }}
    >
      <div
        className="w-full sm:max-w-lg flex flex-col rounded-t-[20px] sm:rounded-[20px] overflow-hidden"
        style={{
          background: 'var(--color-surface)',
          maxHeight: '92dvh',
          boxShadow: '0 -4px 40px rgba(34,26,19,.22)',
        }}
      >
        <div
          className="flex items-center justify-between px-5 pt-5 pb-4 flex-shrink-0"
          style={{ borderBottom: '1px solid var(--color-border)' }}
        >
          <h2 className="font-display font-bold text-[17px]" style={{ color: 'var(--color-ink)' }}>
            {item ? 'Edit Item' : 'Add Inventory Item'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="h-8 w-8 rounded-full flex items-center justify-center transition-colors hover:bg-cream"
            style={{ color: 'var(--color-muted)' }}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-5">
          <form onSubmit={handleSubmit}>
            <div className="space-y-4">
              <ItemFormFields item={item} />

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold" style={{ color: 'var(--color-ink)' }}>
                    Min Stock Level
                  </label>
                  <input
                    name="min_stock_level"
                    type="number"
                    min="0"
                    step="0.001"
                    defaultValue={item ? parseFloat(item.min_stock_level).toString() : '0'}
                    className={inputBase}
                    style={inputStyle}
                    placeholder="0"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold" style={{ color: 'var(--color-ink)' }}>
                    Purchase Price
                  </label>
                  <input
                    name="purchase_price"
                    type="number"
                    min="0"
                    step="0.01"
                    defaultValue={item ? parseFloat(item.purchase_price).toFixed(2) : ''}
                    className={inputBase}
                    style={inputStyle}
                    placeholder="0.00"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold" style={{ color: 'var(--color-ink)' }}>
                  Storage Location
                </label>
                <input
                  name="storage_location"
                  defaultValue={item?.storage_location ?? ''}
                  className={inputBase}
                  style={inputStyle}
                  placeholder="e.g. Dry store, Freezer 1"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold" style={{ color: 'var(--color-ink)' }}>
                  Notes
                </label>
                <textarea
                  name="notes"
                  defaultValue={item?.notes ?? ''}
                  rows={2}
                  className={`${inputBase} resize-none`}
                  style={inputStyle}
                />
              </div>
            </div>

            {error && (
              <p className="mt-4 text-sm font-semibold" style={{ color: 'var(--color-red)' }}>
                {error}
              </p>
            )}

            <div className="mt-5 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
              <Button type="button" variant="ghost" onClick={onClose} disabled={isPending} className="w-full sm:w-auto">
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={isPending} className="w-full sm:w-auto">
                {isPending ? 'Saving…' : item ? 'Save Changes' : 'Add Item'}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
