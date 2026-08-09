'use client'

import { useState, useRef, useEffect } from 'react'
import { ChevronDown, X, MapPin } from 'lucide-react'

interface Props {
  /** Every area present in the unfiltered data, with how many rows each covers. */
  areas: { area: string; count: number }[]
  value: string
  onChange: (area: string) => void
}

/**
 * Area dropdown, styled to match DatePresetPicker so the filter bars on
 * Outstanding / Payments / Invoices stay visually consistent.
 *
 * Areas are derived from the rows on screen rather than passed from the server,
 * so the list only ever offers values that actually match something.
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

  const active = !!value

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
          }}
        >
          <MapPin size={12} aria-hidden="true" />
          {value || 'All Areas'}
          <ChevronDown size={11} />
        </button>

        {open && (
          <div
            className="absolute left-0 top-full mt-1 z-50 rounded-[12px] overflow-hidden"
            style={{
              minWidth: 200,
              maxHeight: 280,
              overflowY: 'auto',
              background: 'var(--color-surface)',
              border:     '1px solid var(--color-border)',
              boxShadow:  'var(--shadow-card)',
            }}
          >
            <button
              type="button"
              onClick={() => { onChange(''); setOpen(false) }}
              className="w-full text-left px-3.5 py-2 text-xs font-semibold transition-colors"
              style={{
                background: value === '' ? 'var(--color-saffron-soft)' : 'transparent',
                color:      value === '' ? 'var(--color-saffron)'      : 'var(--color-ink)',
              }}
            >
              All Areas
            </button>
            {areas.map(a => (
              <button
                key={a.area}
                type="button"
                onClick={() => { onChange(a.area); setOpen(false) }}
                className="w-full flex items-center justify-between gap-3 px-3.5 py-2 text-xs font-semibold transition-colors"
                style={{
                  background: value === a.area ? 'var(--color-saffron-soft)' : 'transparent',
                  color:      value === a.area ? 'var(--color-saffron)'      : 'var(--color-ink)',
                }}
              >
                <span className="truncate">{a.area}</span>
                <span
                  className="text-[10px] font-bold rounded-full px-1.5 py-0.5 leading-none flex-shrink-0"
                  style={{ background: 'var(--color-border)', color: 'var(--color-muted)' }}
                >
                  {a.count}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {active && (
        <button
          type="button"
          onClick={() => onChange('')}
          title="Clear area filter"
          className="flex items-center justify-center w-6 h-6 rounded-full"
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
