'use client'

import { useState, useMemo, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Edit2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { MenuItemModal } from './menu-item-modal'
import { toggleMenuItemAvailability } from '@/lib/menu/actions'
import { useAppSettings } from '@/components/settings/settings-context'
import type { Tables, Enums } from '@/lib/supabase/types'

type MenuItem = Tables<'menu_items'>
type MealPeriod = Enums<'meal_period'>

const PERIODS: { value: MealPeriod; label: string; color: string; bg: string }[] = [
  { value: 'breakfast', label: 'Breakfast', color: 'var(--color-gold)',   bg: '#FEF3C7'                   },
  { value: 'lunch',     label: 'Lunch',     color: 'var(--color-ember)',  bg: 'var(--color-saffron-soft)' },
  { value: 'dinner',    label: 'Dinner',    color: 'var(--color-purple)', bg: 'var(--color-purple-soft)'  },
]

// ── Item card ─────────────────────────────────────────────────────────────────

function ItemCard({
  item,
  canWrite,
  onEdit,
  onToggle,
  isPending,
}: {
  item: MenuItem
  canWrite: boolean
  onEdit: (item: MenuItem) => void
  onToggle: (item: MenuItem) => void
  isPending: boolean
}) {
  const { currency } = useAppSettings()
  return (
    <div
      className="rounded-[14px] p-4 flex flex-col gap-3 transition-opacity"
      style={{
        background: item.is_available ? 'var(--color-surface)' : 'var(--color-cream)',
        border: '1px solid var(--color-border)',
        boxShadow: item.is_available ? 'var(--shadow-card)' : 'none',
        opacity: item.is_available ? 1 : 0.7,
      }}
    >
      {/* Name + price */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="font-semibold leading-snug" style={{ color: 'var(--color-ink)' }}>
            {item.name}
          </p>
          {item.category && (
            <p className="text-[11px] mt-0.5 font-medium" style={{ color: 'var(--color-muted)' }}>
              {item.category}
            </p>
          )}
        </div>
        <p className="num font-bold text-sm flex-shrink-0" style={{ color: 'var(--color-ink)' }}>
          {currency} {parseFloat(item.default_price).toFixed(2)}
        </p>
      </div>

      {item.description && (
        <p className="text-xs leading-relaxed -mt-1 line-clamp-2" style={{ color: 'var(--color-muted)' }}>
          {item.description}
        </p>
      )}

      {/* Actions row */}
      <div
        className="flex items-center justify-between pt-2"
        style={{ borderTop: '1px solid var(--color-border)' }}
      >
        {/* Toggle switch */}
        <label
          className="flex items-center gap-2 select-none"
          style={{ cursor: canWrite ? 'pointer' : 'default' }}
          title={canWrite ? (item.is_available ? 'Mark unavailable' : 'Mark available') : undefined}
        >
          <input
            type="checkbox"
            checked={item.is_available}
            onChange={() => { if (canWrite && !isPending) onToggle(item) }}
            disabled={!canWrite || isPending}
            className="sr-only"
          />
          {/* Track */}
          <div
            className="relative w-9 h-5 rounded-pill transition-colors duration-200 flex-shrink-0"
            style={{
              background: item.is_available ? 'var(--color-green)' : 'var(--color-border)',
            }}
          >
            {/* Thumb */}
            <div
              className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200"
              style={{ transform: item.is_available ? 'translateX(18px)' : 'translateX(2px)' }}
            />
          </div>
          <span
            className="text-xs font-semibold"
            style={{ color: item.is_available ? 'var(--color-green)' : 'var(--color-muted)' }}
          >
            {item.is_available ? 'Available' : 'Unavailable'}
          </span>
        </label>

        {canWrite && (
          <button
            onClick={() => onEdit(item)}
            className="h-7 w-7 flex items-center justify-center rounded-lg transition-colors hover:bg-cream"
            title={`Edit ${item.name}`}
          >
            <Edit2 size={13} style={{ color: 'var(--color-muted)' }} />
          </button>
        )}
      </div>
    </div>
  )
}

// ── Main module ───────────────────────────────────────────────────────────────

type TabValue = 'all' | MealPeriod

export function MenuModule({
  items,
  canWrite,
}: {
  items: MenuItem[]
  canWrite: boolean
}) {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<TabValue>('all')
  const [addOpen, setAddOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleToggle(item: MenuItem) {
    startTransition(async () => {
      await toggleMenuItemAvailability(item.id, !item.is_available)
      router.refresh()
    })
  }

  function handleDone() {
    router.refresh()
  }

  function openAdd(period?: MealPeriod) {
    if (period && period !== activeTab) setActiveTab(period)
    setAddOpen(true)
  }

  // Derive counts per period for tab labels
  const countByPeriod = useMemo(
    () =>
      PERIODS.reduce(
        (acc, p) => ({ ...acc, [p.value]: items.filter(i => i.meal_period === p.value).length }),
        {} as Record<MealPeriod, number>
      ),
    [items]
  )

  // Items to render (filtered by tab)
  const visibleItems = activeTab === 'all' ? items : items.filter(i => i.meal_period === activeTab)

  const totalAvailable = items.filter(i => i.is_available).length

  const defaultAddPeriod: MealPeriod = activeTab === 'all' ? 'lunch' : activeTab

  return (
    <div>
      {/* Page header */}
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <p
            className="text-xs font-bold uppercase tracking-widest"
            style={{ color: 'var(--color-saffron)', letterSpacing: '.12em' }}
          >
            Menu
          </p>
          <h1
            className="font-display font-bold text-[25px] mt-0.5"
            style={{ color: 'var(--color-ink)' }}
          >
            {items.length}
            <span className="text-[15px] font-semibold ml-1.5" style={{ color: 'var(--color-muted)' }}>
              items · {totalAvailable} available
            </span>
          </h1>
        </div>
        {canWrite && (
          <Button
            variant="primary"
            size="sm"
            onClick={() => openAdd()}
            className="flex-shrink-0 mt-1"
            disabled={isPending}
          >
            <Plus size={15} />
            Add Item
          </Button>
        )}
      </div>

      {/* Period tabs */}
      <div className="flex gap-1.5 mb-5 overflow-x-auto pb-0.5">
        {([
          { value: 'all' as TabValue, label: `All (${items.length})` },
          ...PERIODS.map(p => ({ value: p.value as TabValue, label: `${p.label} (${countByPeriod[p.value]})` })),
        ]).map(tab => (
          <button
            key={tab.value}
            onClick={() => setActiveTab(tab.value)}
            className="px-3.5 py-1.5 rounded-pill text-sm font-semibold flex-shrink-0 transition-colors"
            style={{
              background: activeTab === tab.value ? 'var(--color-ink)' : 'var(--color-surface)',
              color: activeTab === tab.value ? 'var(--color-cream)' : 'var(--color-muted)',
              border: '1px solid',
              borderColor: activeTab === tab.value ? 'var(--color-ink)' : 'var(--color-border)',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {items.length === 0 ? (
        <div className="py-16 text-center" style={{ color: 'var(--color-muted)' }}>
          <p className="font-semibold text-[15px]">Menu is empty</p>
          {canWrite && (
            <p className="text-sm mt-1">
              Click <strong>Add Item</strong> to add your first menu item.
            </p>
          )}
        </div>
      ) : activeTab === 'all' ? (
        /* All view — grouped by period */
        <div className="space-y-7">
          {PERIODS.map(period => {
            const periodItems = visibleItems.filter(i => i.meal_period === period.value)
            if (periodItems.length === 0) return null
            return (
              <div key={period.value}>
                <div className="flex items-center gap-3 mb-3">
                  <span
                    className="px-2.5 py-0.5 rounded-pill text-xs font-bold"
                    style={{ background: period.bg, color: period.color }}
                  >
                    {period.label}
                  </span>
                  <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
                    {periodItems.length} item{periodItems.length !== 1 ? 's' : ''}
                  </span>
                  {canWrite && (
                    <button
                      onClick={() => openAdd(period.value)}
                      className="ml-auto text-xs font-bold transition-opacity hover:opacity-70"
                      style={{ color: 'var(--color-saffron)' }}
                    >
                      + Add
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {periodItems.map(item => (
                    <ItemCard
                      key={item.id}
                      item={item}
                      canWrite={canWrite}
                      onEdit={setEditingItem}
                      onToggle={handleToggle}
                      isPending={isPending}
                    />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        /* Single period view */
        (() => {
          const period = PERIODS.find(p => p.value === activeTab)!
          return visibleItems.length === 0 ? (
            <div
              className="rounded-[14px] py-14 text-center"
              style={{ border: '1px dashed var(--color-border)' }}
            >
              <p className="text-sm font-semibold" style={{ color: 'var(--color-muted)' }}>
                No {period.label.toLowerCase()} items yet
              </p>
              {canWrite && (
                <button
                  onClick={() => setAddOpen(true)}
                  className="text-sm font-bold mt-2 transition-opacity hover:opacity-70"
                  style={{ color: 'var(--color-saffron)' }}
                >
                  + Add {period.label} item
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {visibleItems.map(item => (
                <ItemCard
                  key={item.id}
                  item={item}
                  canWrite={canWrite}
                  onEdit={setEditingItem}
                  onToggle={handleToggle}
                  isPending={isPending}
                />
              ))}
            </div>
          )
        })()
      )}

      {/* Add modal */}
      <MenuItemModal
        open={addOpen}
        defaultMealPeriod={defaultAddPeriod}
        onClose={() => setAddOpen(false)}
        onSuccess={handleDone}
      />

      {/* Edit modal */}
      {editingItem && (
        <MenuItemModal
          item={editingItem}
          open
          onClose={() => setEditingItem(null)}
          onSuccess={() => {
            handleDone()
            setEditingItem(null)
          }}
        />
      )}
    </div>
  )
}
