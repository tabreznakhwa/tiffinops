'use client'

import { useState, useTransition, useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { createMenuItems, updateMenuItem } from '@/lib/menu/actions'
import { useAppSettings } from '@/components/settings/settings-context'
import type { Tables, Enums } from '@/lib/supabase/types'

type MenuItem = Tables<'menu_items'>
type MealPeriod = Enums<'meal_period'>

const inputBase =
  'mt-1 w-full rounded-[11px] px-3 py-2.5 text-sm bg-surface text-ink focus:outline-none focus:ring-1 focus:ring-saffron'
const inputStyle = { border: '1px solid var(--color-border)' } as const

const PERIOD_DEFS: { value: MealPeriod; label: string; color: string; bg: string }[] = [
  { value: 'breakfast', label: 'Breakfast', color: 'var(--color-gold, #B45309)',   bg: '#FEF3C7'                   },
  { value: 'lunch',     label: 'Lunch',     color: 'var(--color-ember, #C2410C)',  bg: 'var(--color-saffron-soft)' },
  { value: 'dinner',    label: 'Dinner',    color: 'var(--color-purple, #7C3AED)', bg: 'var(--color-purple-soft, #F5F3FF)' },
]

type PeriodState = Record<MealPeriod, { on: boolean; price: string }>

export function MenuItemModal({
  item,
  defaultMealPeriod = 'lunch',
  open,
  onClose,
  onSuccess,
}: {
  item?: MenuItem
  defaultMealPeriod?: Enums<'meal_period'>
  open: boolean
  onClose: () => void
  onSuccess: () => void
}) {
  const { currency } = useAppSettings()
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const backdropRef = useRef<HTMLDivElement>(null)

  // Shared fields
  const [name, setName]               = useState(item?.name ?? '')
  const [category, setCategory]       = useState(item?.category ?? '')
  const [description, setDescription] = useState(item?.description ?? '')
  const [isAvailable, setIsAvailable] = useState(item ? item.is_available : true)

  // Add mode — one item across multiple meal periods, each with its own price
  const [periods, setPeriods] = useState<PeriodState>(() => ({
    breakfast: { on: defaultMealPeriod === 'breakfast', price: '' },
    lunch:     { on: defaultMealPeriod === 'lunch',     price: '' },
    dinner:    { on: defaultMealPeriod === 'dinner',    price: '' },
  }))

  // Edit mode — the existing row stays a single (period, price) pair
  const [editPeriod, setEditPeriod] = useState<MealPeriod>(item?.meal_period ?? defaultMealPeriod)
  const [editPrice, setEditPrice]   = useState(item ? parseFloat(item.default_price).toFixed(2) : '')

  // Re-seed the form each time the modal opens (state persists across opens otherwise)
  useEffect(() => {
    if (!open) return
    setError(null)
    setName(item?.name ?? '')
    setCategory(item?.category ?? '')
    setDescription(item?.description ?? '')
    setIsAvailable(item ? item.is_available : true)
    setEditPeriod(item?.meal_period ?? defaultMealPeriod)
    setEditPrice(item ? parseFloat(item.default_price).toFixed(2) : '')
    setPeriods({
      breakfast: { on: defaultMealPeriod === 'breakfast', price: '' },
      lunch:     { on: defaultMealPeriod === 'lunch',     price: '' },
      dinner:    { on: defaultMealPeriod === 'dinner',    price: '' },
    })
  }, [open, item, defaultMealPeriod])

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

  const selectedPeriods = PERIOD_DEFS.filter(p => periods[p.value].on)
  const validPrice = (v: string) => v.trim() !== '' && !isNaN(parseFloat(v)) && parseFloat(v) >= 0

  const canSubmit = !isPending && name.trim().length > 0 && (
    item
      ? validPrice(editPrice)
      : selectedPeriods.length > 0 && selectedPeriods.every(p => validPrice(periods[p.value].price))
  )

  // Convenience: copy the first selected period's price into the others
  const firstPrice = selectedPeriods.length > 0 ? periods[selectedPeriods[0].value].price : ''
  function copyPriceToAll() {
    if (!validPrice(firstPrice)) return
    setPeriods(prev => {
      const next = { ...prev }
      for (const p of PERIOD_DEFS) if (next[p.value].on) next[p.value] = { ...next[p.value], price: firstPrice }
      return next
    })
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      let result: { error?: string }
      if (item) {
        const formData = new FormData()
        formData.set('name', name)
        formData.set('meal_period', editPeriod)
        formData.set('category', category)
        formData.set('description', description)
        formData.set('default_price', editPrice)
        if (isAvailable) formData.set('is_available', 'true')
        result = await updateMenuItem(item.id, formData)
      } else {
        result = await createMenuItems({
          name,
          category: category || undefined,
          description: description || undefined,
          is_available: isAvailable,
          periods: selectedPeriods.map(p => ({
            meal_period: p.value,
            price: parseFloat(periods[p.value].price),
          })),
        })
      }
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
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 pt-5 pb-4 flex-shrink-0"
          style={{ borderBottom: '1px solid var(--color-border)' }}
        >
          <h2 className="font-display font-bold text-[17px]" style={{ color: 'var(--color-ink)' }}>
            {item ? 'Edit Item' : 'Add Menu Item'}
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

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-5 py-5">
          <form onSubmit={handleSubmit}>
            <div className="space-y-4">
              {/* Name + Category */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold" style={{ color: 'var(--color-ink)' }}>
                    Item Name <span style={{ color: 'var(--color-red)' }}>*</span>
                  </label>
                  <input
                    value={name}
                    onChange={e => setName(e.target.value)}
                    required
                    className={inputBase}
                    style={inputStyle}
                    placeholder="e.g. Chicken Biryani"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold" style={{ color: 'var(--color-ink)' }}>
                    Category
                  </label>
                  <input
                    value={category}
                    onChange={e => setCategory(e.target.value)}
                    className={inputBase}
                    style={inputStyle}
                    placeholder="e.g. Main, Starter"
                  />
                </div>
              </div>

              {item ? (
                /* ── Edit mode: single period + price ─────────────────── */
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-semibold" style={{ color: 'var(--color-ink)' }}>
                      Meal Period <span style={{ color: 'var(--color-red)' }}>*</span>
                    </label>
                    <select
                      value={editPeriod}
                      onChange={e => setEditPeriod(e.target.value as MealPeriod)}
                      required
                      className={inputBase}
                      style={{ ...inputStyle, cursor: 'pointer' }}
                    >
                      <option value="breakfast">Breakfast</option>
                      <option value="lunch">Lunch</option>
                      <option value="dinner">Dinner</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold" style={{ color: 'var(--color-ink)' }}>
                      Price ({currency}) <span style={{ color: 'var(--color-red)' }}>*</span>
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={editPrice}
                      onChange={e => setEditPrice(e.target.value)}
                      required
                      className={inputBase}
                      style={inputStyle}
                      placeholder="0.00"
                    />
                  </div>
                </div>
              ) : (
                /* ── Add mode: tick each meal period, price per period ── */
                <div>
                  <div className="flex items-center justify-between">
                    <label className="block text-sm font-semibold" style={{ color: 'var(--color-ink)' }}>
                      Meal Periods &amp; Pricing <span style={{ color: 'var(--color-red)' }}>*</span>
                    </label>
                    {selectedPeriods.length > 1 && validPrice(firstPrice) && (
                      <button
                        type="button"
                        onClick={copyPriceToAll}
                        className="text-xs font-bold transition-opacity hover:opacity-70"
                        style={{ color: 'var(--color-saffron)' }}
                      >
                        Same price for all
                      </button>
                    )}
                  </div>
                  <p className="text-xs mt-0.5 mb-2" style={{ color: 'var(--color-muted)' }}>
                    Tick where this item is served — each can have its own price. Saved in one shot.
                  </p>
                  <div className="space-y-2">
                    {PERIOD_DEFS.map(p => {
                      const st = periods[p.value]
                      return (
                        <div
                          key={p.value}
                          className="flex items-center gap-3 rounded-[11px] px-3 py-2.5 transition-colors"
                          style={{
                            border: `1.5px solid ${st.on ? p.color : 'var(--color-border)'}`,
                            background: st.on ? p.bg : 'var(--color-cream)',
                          }}
                        >
                          <label className="flex items-center gap-2.5 flex-1 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={st.on}
                              onChange={e =>
                                setPeriods(prev => ({ ...prev, [p.value]: { ...prev[p.value], on: e.target.checked } }))
                              }
                              className="w-4 h-4"
                              style={{ accentColor: p.color }}
                            />
                            <span className="text-sm font-bold" style={{ color: st.on ? p.color : 'var(--color-muted)' }}>
                              {p.label}
                            </span>
                          </label>
                          <div className="relative w-[140px] flex-shrink-0">
                            <span
                              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs font-semibold pointer-events-none"
                              style={{ color: 'var(--color-muted)' }}
                            >
                              {currency}
                            </span>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={st.price}
                              disabled={!st.on}
                              onChange={e =>
                                setPeriods(prev => ({ ...prev, [p.value]: { ...prev[p.value], price: e.target.value } }))
                              }
                              placeholder="0.00"
                              className="w-full rounded-[9px] pl-11 pr-2.5 py-2 text-sm num focus:outline-none focus:ring-1 focus:ring-saffron disabled:opacity-40"
                              style={{
                                border: '1px solid var(--color-border)',
                                background: 'var(--color-surface)',
                                color: 'var(--color-ink)',
                              }}
                            />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Availability */}
              <label className="flex items-center gap-2.5 cursor-pointer w-fit">
                <input
                  type="checkbox"
                  checked={isAvailable}
                  onChange={e => setIsAvailable(e.target.checked)}
                  className="w-4 h-4"
                  style={{ accentColor: 'var(--color-saffron)' }}
                />
                <span className="text-sm font-semibold" style={{ color: 'var(--color-ink)' }}>On the menu</span>
              </label>

              {/* Description */}
              <div>
                <label className="block text-sm font-semibold" style={{ color: 'var(--color-ink)' }}>
                  Description
                </label>
                <textarea
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  rows={2}
                  className={`${inputBase} resize-none`}
                  style={inputStyle}
                  placeholder="Ingredients, dietary info…"
                />
              </div>
            </div>

            {error && (
              <p className="mt-4 text-sm font-semibold" style={{ color: 'var(--color-red)' }}>
                {error}
              </p>
            )}

            <div className="mt-5 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={onClose}
                disabled={isPending}
                className="w-full sm:w-auto"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={!canSubmit}
                className="w-full sm:w-auto"
              >
                {isPending
                  ? 'Saving…'
                  : item
                    ? 'Save Changes'
                    : selectedPeriods.length > 1
                      ? `Add to ${selectedPeriods.length} Periods`
                      : 'Add Item'}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
