'use client'

import { useState, useMemo, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { saveDailyMenu } from '@/lib/day-wise-menu/actions'
import { useAppSettings } from '@/components/settings/settings-context'

type MenuItemRef = { id: string; name: string; meal_period: string; default_price: string }
type OverrideRow = { menu_item_id: string; is_available: boolean; price_override: string | null }
type UpcomingRow = { menu_date: string; is_published: boolean }

const PERIODS: { value: string; label: string; color: string; bg: string }[] = [
  { value: 'breakfast', label: 'Breakfast', color: 'var(--color-gold)',   bg: '#FEF3C7'                   },
  { value: 'lunch',     label: 'Lunch',     color: 'var(--color-ember)',  bg: 'var(--color-saffron-soft)' },
  { value: 'dinner',    label: 'Dinner',    color: 'var(--color-purple)', bg: 'var(--color-purple-soft)'  },
]
const CHIP_DAYS = 14

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
function weekdayShort(dateStr: string) {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Dubai', weekday: 'short' }).format(new Date(`${dateStr}T12:00:00Z`))
}
function dayNum(dateStr: string) {
  return String(parseInt(dateStr.slice(8, 10), 10))
}

// ── Per-date editor — keyed by `date` in the parent so switching dates resets
//    local state for free instead of manually re-syncing it via an effect ────

function DayEditor({
  date,
  items,
  overrides,
  canWrite,
  onSaved,
}: {
  date: string
  items: MenuItemRef[]
  overrides: OverrideRow[]
  canWrite: boolean
  onSaved: () => void
}) {
  const { currency } = useAppSettings()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const overrideMap = useMemo(() => new Map(overrides.map(o => [o.menu_item_id, o])), [overrides])
  const [available, setAvailable] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(items.map(i => [i.id, overrideMap.get(i.id)?.is_available ?? true])),
  )
  const [priceOverride, setPriceOverride] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      items.map(i => {
        const existing = overrideMap.get(i.id)?.price_override
        return [i.id, existing != null ? String(existing) : '']
      }),
    ),
  )

  const grouped = useMemo(
    () => PERIODS.map(p => ({ ...p, items: items.filter(i => i.meal_period === p.value) })).filter(g => g.items.length),
    [items],
  )

  function handleSave(publish: boolean) {
    setError(null)
    startTransition(async () => {
      const result = await saveDailyMenu({
        date,
        is_published: publish,
        overrides: items.map(i => ({
          menu_item_id: i.id,
          is_available: available[i.id] ?? true,
          price_override: priceOverride[i.id]?.trim() ? parseFloat(priceOverride[i.id]) : null,
        })),
      })
      if (result?.error) { setError(result.error); return }
      onSaved()
    })
  }

  if (items.length === 0) {
    return (
      <div className="py-16 text-center" style={{ color: 'var(--color-muted)' }}>
        <p className="font-semibold text-[15px]">No menu items yet</p>
        <p className="text-sm mt-1">
          Add items on the{' '}
          <a href="/menu" className="font-semibold" style={{ color: 'var(--color-saffron)' }}>Menu</a> page first.
        </p>
      </div>
    )
  }

  return (
    <div>
      <div className="space-y-7">
        {grouped.map(period => (
          <div key={period.value}>
            <div className="flex items-center gap-3 mb-3">
              <span className="px-2.5 py-0.5 rounded-pill text-xs font-bold" style={{ background: period.bg, color: period.color }}>
                {period.label}
              </span>
              <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
                {period.items.length} item{period.items.length !== 1 ? 's' : ''}
              </span>
            </div>
            <div
              className="rounded-[14px] overflow-hidden"
              style={{ border: '1px solid var(--color-border)', background: 'var(--color-surface)' }}
            >
              {period.items.map((item, i) => {
                const isAvail = available[item.id] ?? true
                return (
                  <div
                    key={item.id}
                    className="flex items-center gap-3 px-4 py-3"
                    style={{ borderTop: i > 0 ? '1px solid var(--color-border)' : undefined, opacity: isAvail ? 1 : 0.55 }}
                  >
                    <label
                      className="flex items-center select-none flex-shrink-0"
                      style={{ cursor: canWrite ? 'pointer' : 'default' }}
                      title={canWrite ? (isAvail ? 'Mark unavailable this day' : 'Mark available this day') : undefined}
                    >
                      <input
                        type="checkbox"
                        checked={isAvail}
                        disabled={!canWrite}
                        onChange={() => setAvailable(a => ({ ...a, [item.id]: !isAvail }))}
                        className="sr-only"
                      />
                      <div
                        className="relative w-9 h-5 rounded-pill transition-colors duration-200"
                        style={{ background: isAvail ? 'var(--color-green)' : 'var(--color-border)' }}
                      >
                        <div
                          className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200"
                          style={{ transform: isAvail ? 'translateX(18px)' : 'translateX(2px)' }}
                        />
                      </div>
                    </label>
                    <span className="font-semibold flex-1 min-w-0 truncate" style={{ color: 'var(--color-ink)' }}>
                      {item.name}
                    </span>
                    <span className="text-xs flex-shrink-0" style={{ color: 'var(--color-muted)' }}>
                      {currency} {parseFloat(item.default_price).toFixed(2)}
                    </span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="Override"
                      value={priceOverride[item.id] ?? ''}
                      disabled={!canWrite || !isAvail}
                      onChange={e => setPriceOverride(p => ({ ...p, [item.id]: e.target.value }))}
                      className="w-24 flex-shrink-0 rounded-[8px] px-2 py-1.5 text-xs text-right outline-none disabled:opacity-40"
                      style={{ border: '1px solid var(--color-border)', background: 'var(--color-cream)', color: 'var(--color-ink)' }}
                    />
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {error && (
        <p className="mt-4 text-sm font-semibold" style={{ color: 'var(--color-red)' }}>{error}</p>
      )}

      {canWrite && (
        <div className="mt-5 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <Button type="button" variant="ghost" disabled={isPending} onClick={() => handleSave(false)} className="w-full sm:w-auto">
            {isPending ? 'Saving…' : 'Save as Draft'}
          </Button>
          <Button type="button" variant="primary" disabled={isPending} onClick={() => handleSave(true)} className="w-full sm:w-auto">
            {isPending ? 'Publishing…' : 'Publish'}
          </Button>
        </div>
      )}
    </div>
  )
}

// ── Page shell — date chip strip + the editor for whichever date is selected ─

export function DayWiseMenuModule({
  date,
  today,
  items,
  isPublished,
  overrides,
  upcoming,
  canWrite,
}: {
  date: string
  today: string
  items: MenuItemRef[]
  isPublished: boolean
  overrides: OverrideRow[]
  upcoming: UpcomingRow[]
  canWrite: boolean
}) {
  const router = useRouter()

  const statusByDate = useMemo(() => {
    const map = new Map<string, boolean>()
    for (const u of upcoming) map.set(u.menu_date, u.is_published)
    if (!map.has(date)) map.set(date, isPublished)
    return map
  }, [upcoming, date, isPublished])

  const chips = useMemo(() => Array.from({ length: CHIP_DAYS }, (_, i) => addDays(today, i)), [today])

  function goTo(d: string) {
    router.push(`/day-wise-menu?date=${d}`)
  }

  return (
    <div>
      <div className="mb-5">
        <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--color-saffron)', letterSpacing: '.12em' }}>
          Menu
        </p>
        <h1 className="font-display font-bold text-[25px] mt-0.5" style={{ color: 'var(--color-ink)' }}>
          Day-wise Menu
        </h1>
        <p className="text-sm mt-1.5" style={{ color: 'var(--color-muted)' }}>
          Plan overrides for a specific date. Unpublished dates stay a draft —
          the WhatsApp agent and order matching only ever see a{' '}
          <strong style={{ color: 'var(--color-ink)' }}>published</strong> day. A date with no override shows the full menu.
        </p>
      </div>

      <div className="flex gap-1.5 mb-6 overflow-x-auto pb-1">
        {chips.map(d => {
          const active = d === date
          const configured = statusByDate.has(d)
          const published = statusByDate.get(d) === true
          return (
            <button
              key={d}
              onClick={() => goTo(d)}
              className="flex flex-col items-center gap-1 flex-shrink-0 w-12 px-1 py-2 rounded-[12px] text-xs font-semibold transition-colors"
              style={{
                background: active ? 'var(--color-ink)' : 'var(--color-surface)',
                color: active ? 'var(--color-cream)' : 'var(--color-ink)',
                border: '1px solid',
                borderColor: active ? 'var(--color-ink)' : 'var(--color-border)',
              }}
            >
              <span className="uppercase" style={{ opacity: 0.7, fontSize: '10px' }}>{weekdayShort(d)}</span>
              <span className="text-sm font-bold">{dayNum(d)}</span>
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ background: !configured ? 'var(--color-border)' : published ? 'var(--color-green)' : 'var(--color-gold)' }}
              />
            </button>
          )
        })}
      </div>

      <div className="flex items-center gap-4 mb-4 text-xs" style={{ color: 'var(--color-muted)' }}>
        <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--color-border)' }} /> No override</span>
        <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--color-gold)' }} /> Draft</span>
        <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--color-green)' }} /> Published</span>
      </div>

      <DayEditor
        key={date}
        date={date}
        items={items}
        overrides={overrides}
        canWrite={canWrite}
        onSaved={() => router.refresh()}
      />
    </div>
  )
}
