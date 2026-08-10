'use client'

import { useState, useRef, useEffect } from 'react'
import { ChevronDown, X, MapPin, Check } from 'lucide-react'

interface Props {
  /** Every area present in the unfiltered data, with how many rows each covers. */
  areas: { area: string; count: number }[]
  /** Currently selected areas. Empty = no filter (show everything). */
  value: string[]
  onChange: (areas: string[]) => void
}

/**
 * Multi-select area dropdown, styled to match DatePresetPicker so the filter
 * bars on Outstanding / Payments / Invoices / Fixed Menu stay consistent.
 *
 * Areas are derived from the rows on screen rather than passed from the server,
 * so the list only ever offers values that actually match something.
 *
 * An empty selection means "no filter" — the same as selecting everything —
 * so clearing and selecting-all both collapse to the same state.
 */
export function AreaFilter({ areas, value, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function close(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  if (areas.length === 0) return null

  const selected = new Set(value)
  const active   = value.length > 0

  // The dropdown stays open while toggling — multi-select would be unusable
  // if every click dismissed it.
  function toggle(area: string) {
    const next = new Set(selected)
    if (next.has(area)) next.delete(area)
    else next.add(area)
    onChange([...next])
  }

  const label =
    value.length === 0 ? 'All Areas'
    : value.length === 1 ? value[0]
    : `${value.length} Areas`

  return (
    <div className="flex items-center gap-1.5">
      <div ref={ref} className="relative">
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-xs font-semibold whitespace-nowrap"
          style={{
            background: active ? 'var(--color-ink)' : 'var(--color-surface)',
            color:      active ? '#fff'             : 'var(--color-muted)',
            border: '1px solid var(--color-border)',
            maxWidth: 200,
          }}
        >
          <MapPin size={12} aria-hidden="true" className="flex-shrink-0" />
          <span className="truncate">{label}</span>
          <ChevronDown size={11} className="flex-shrink-0" />
        </button>

        {open && (
          <div
            className="absolute left-0 top-full mt-1 z-50 rounded-[12px] overflow-hidden"
            style={{
              minWidth: 220,
              background: 'var(--color-surface)',
              border:     '1px solid var(--color-border)',
              boxShadow:  'var(--shadow-card)',
            }}
          >
            {/* Sticky actions */}
            <div
              className="flex items-center justify-between px-3 py-2"
              style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--color-cream)' }}
            >
              <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>
                {value.length === 0 ? 'All areas' : `${value.length} selected`}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onChange(areas.map(a => a.area))}
                  className="text-[10px] font-bold"
                  style={{ color: 'var(--color-saffron)' }}
                >
                  Select all
                </button>
                <button
                  type="button"
                  onClick={() => onChange([])}
                  className="text-[10px] font-bold"
                  style={{ color: 'var(--color-muted)' }}
                >
                  Clear
                </button>
              </div>
            </div>

            <div style={{ maxHeight: 260, overflowY: 'auto' }}>
              {areas.map(a => {
                const on = selected.has(a.area)
                return (
                  <button
                    key={a.area}
                    type="button"
                    onClick={() => toggle(a.area)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold transition-colors text-left"
                    style={{
                      background: on ? 'var(--color-saffron-soft)' : 'transparent',
                      color:      on ? 'var(--color-saffron)'      : 'var(--color-ink)',
                    }}
                  >
                    <span
                      className="flex items-center justify-center rounded-[4px] flex-shrink-0"
                      style={{
                        width: 14,
                        height: 14,
                        border: `1.5px solid ${on ? 'var(--color-saffron)' : 'var(--color-border)'}`,
                        background: on ? 'var(--color-saffron)' : 'transparent',
                      }}
                    >
                      {on && <Check size={10} color="#fff" strokeWidth={3} />}
                    </span>
                    <span className="truncate flex-1">{a.area}</span>
                    <span
                      className="text-[10px] font-bold rounded-full px-1.5 py-0.5 leading-none flex-shrink-0"
                      style={{ background: 'var(--color-border)', color: 'var(--color-muted)' }}
                    >
                      {a.count}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {active && (
        <button
          type="button"
          onClick={() => onChange([])}
          title="Clear area filter"
          className="flex items-center justify-center w-6 h-6 rounded-full flex-shrink-0"
          style={{ background: 'var(--color-border)', color: 'var(--color-muted)' }}
        >
          <X size={11} />
        </button>
      )}
    </div>
  )
}

/** Unique areas present in `rows`, with counts, sorted by name. */
export function collectAreas<T>(rows: T[], getArea: (row: T) => string | null | undefined) {
  const map = new Map<string, number>()
  for (const row of rows) {
    const a = getArea(row)?.trim()
    if (!a) continue
    map.set(a, (map.get(a) ?? 0) + 1)
  }
  return [...map.entries()]
    .map(([area, count]) => ({ area, count }))
    .sort((a, b) => a.area.localeCompare(b.area))
}

/** True when `area` passes the selection (empty selection = no filter). */
export function matchesArea(selected: string[], area: string | null | undefined): boolean {
  if (selected.length === 0) return true
  return !!area && selected.includes(area)
}
