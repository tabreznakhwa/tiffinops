'use client'

import { useState, useTransition, useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { createMenuItem, updateMenuItem } from '@/lib/menu/actions'
import type { Tables, Enums } from '@/lib/supabase/types'

type MenuItem = Tables<'menu_items'>

const inputBase =
  'mt-1 w-full rounded-[11px] px-3 py-2.5 text-sm bg-surface text-ink focus:outline-none focus:ring-1 focus:ring-saffron'
const inputStyle = { border: '1px solid var(--color-border)' } as const

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
        ? await updateMenuItem(item.id, formData)
        : await createMenuItem(formData)
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
              {/* Name */}
              <div>
                <label className="block text-sm font-semibold" style={{ color: 'var(--color-ink)' }}>
                  Item Name <span style={{ color: 'var(--color-red)' }}>*</span>
                </label>
                <input
                  name="name"
                  defaultValue={item?.name ?? ''}
                  required
                  className={inputBase}
                  style={inputStyle}
                  placeholder="e.g. Chicken Biryani"
                />
              </div>

              {/* Meal period + Category */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold" style={{ color: 'var(--color-ink)' }}>
                    Meal Period <span style={{ color: 'var(--color-red)' }}>*</span>
                  </label>
                  <select
                    name="meal_period"
                    defaultValue={item?.meal_period ?? defaultMealPeriod}
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
                    Category
                  </label>
                  <input
                    name="category"
                    defaultValue={item?.category ?? ''}
                    className={inputBase}
                    style={inputStyle}
                    placeholder="e.g. Main, Starter"
                  />
                </div>
              </div>

              {/* Price + Availability */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold" style={{ color: 'var(--color-ink)' }}>
                    Price (AED) <span style={{ color: 'var(--color-red)' }}>*</span>
                  </label>
                  <input
                    name="default_price"
                    type="number"
                    min="0"
                    step="0.01"
                    defaultValue={item ? parseFloat(item.default_price).toFixed(2) : ''}
                    required
                    className={inputBase}
                    style={inputStyle}
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold mb-3" style={{ color: 'var(--color-ink)' }}>
                    Availability
                  </label>
                  <label className="flex items-center gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      name="is_available"
                      value="true"
                      defaultChecked={item ? item.is_available : true}
                      className="w-4 h-4"
                      style={{ accentColor: 'var(--color-saffron)' }}
                    />
                    <span className="text-sm" style={{ color: 'var(--color-muted)' }}>On the menu</span>
                  </label>
                </div>
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-semibold" style={{ color: 'var(--color-ink)' }}>
                  Description
                </label>
                <textarea
                  name="description"
                  defaultValue={item?.description ?? ''}
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
                disabled={isPending}
                className="w-full sm:w-auto"
              >
                {isPending ? 'Saving…' : item ? 'Save Changes' : 'Add Item'}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
