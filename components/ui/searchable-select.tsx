'use client'

import { useState, useRef, useEffect, useMemo } from 'react'
import { ChevronDown, Search, Check } from 'lucide-react'

export type SelectOption = {
  value: string
  label: string
  /** Shown right-aligned and greyed — a price, a customer code, that sort of thing. */
  hint?: string
}

interface Props {
  options: SelectOption[]
  value: string
  onChange: (value: string) => void
  placeholder?: string
  /** Renders in the error colours — used when a required choice is still empty. */
  invalid?: boolean
  disabled?: boolean
  className?: string
  /** Width of the trigger button. The panel widens beyond it when needed. */
  width?: number | string
}

/**
 * Type-to-filter dropdown for lists a native <select> can't cope with — the
 * menu runs to ninety-odd items per meal and the customer list to nearly two
 * hundred, which is far too many to scroll past on a phone in a kitchen.
 *
 * Every whitespace-separated term must appear somewhere in the label or hint,
 * so "chicken kad" narrows to the kadhai rows and word order doesn't matter.
 * Deliberately plain substring matching rather than anything fuzzy: a filter
 * that quietly reorders or infers is worse than one you can predict.
 */
export function SearchableSelect({
  options, value, onChange, placeholder = 'Select…',
  invalid = false, disabled = false, className, width,
}: Props) {
  const [open, setOpen]     = useState(false)
  const [query, setQuery]   = useState('')
  const [cursor, setCursor] = useState(0)
  const ref      = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef  = useRef<HTMLDivElement>(null)

  const selected = options.find(o => o.value === value)

  useEffect(() => {
    function close(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  // Focus the box on open so you can start typing straight away
  useEffect(() => {
    if (open) { setQuery(''); setCursor(0); inputRef.current?.focus() }
  }, [open])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    const terms = q.split(/\s+/)
    return options.filter(o => {
      const hay = `${o.label} ${o.hint ?? ''}`.toLowerCase()
      // Every term must appear somewhere — "chk kad" needs both
      return terms.every(t => hay.includes(t))
    })
  }, [options, query])

  // Keep the highlighted row in view while arrowing through
  useEffect(() => {
    const el = listRef.current?.children[cursor] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  function commit(v: string) {
    onChange(v)
    setOpen(false)
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => Math.min(c + 1, filtered.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); if (filtered[cursor]) commit(filtered[cursor].value) }
    else if (e.key === 'Escape') { e.preventDefault(); setOpen(false) }
  }

  return (
    <div ref={ref} className={`relative ${className ?? ''}`} style={{ width }}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-1.5 rounded-[8px] px-2 py-1 text-xs font-semibold text-left"
        style={{
          background: invalid ? 'var(--color-red-soft)' : 'var(--color-cream)',
          border: `1px solid ${invalid ? 'var(--color-red)' : 'var(--color-border)'}`,
          color: selected ? 'var(--color-ink)' : 'var(--color-muted)',
          opacity: disabled ? 0.5 : 1,
        }}
      >
        <span className="flex-1 truncate">{selected?.label ?? placeholder}</span>
        <ChevronDown size={11} className="flex-shrink-0" style={{ color: 'var(--color-muted)' }} />
      </button>

      {open && (
        <div
          className="absolute left-0 top-full mt-1 z-50 rounded-[10px] overflow-hidden"
          style={{
            minWidth: '100%',
            width: 'max-content',
            maxWidth: 340,
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            boxShadow: 'var(--shadow-card)',
          }}
        >
          <div className="relative" style={{ borderBottom: '1px solid var(--color-border)' }}>
            <Search
              size={12}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
              style={{ color: 'var(--color-muted)' }}
            />
            <input
              ref={inputRef}
              value={query}
              onChange={e => { setQuery(e.target.value); setCursor(0) }}
              onKeyDown={onKeyDown}
              placeholder="Type to search…"
              className="w-full pl-7 pr-2 py-1.5 text-xs focus:outline-none"
              style={{ background: 'var(--color-cream)', color: 'var(--color-ink)' }}
            />
          </div>

          <div ref={listRef} style={{ maxHeight: 240, overflowY: 'auto' }}>
            {filtered.length === 0 ? (
              <p className="px-3 py-3 text-xs" style={{ color: 'var(--color-muted)' }}>
                Nothing matches &ldquo;{query}&rdquo;
              </p>
            ) : (
              filtered.map((o, i) => {
                const isSel = o.value === value
                return (
                  <button
                    key={o.value}
                    type="button"
                    onMouseEnter={() => setCursor(i)}
                    onClick={() => commit(o.value)}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-left"
                    style={{
                      background: i === cursor ? 'var(--color-saffron-soft)' : 'transparent',
                      color: isSel ? 'var(--color-saffron)' : 'var(--color-ink)',
                      fontWeight: isSel ? 700 : 500,
                    }}
                  >
                    <span className="flex-1 truncate">{o.label}</span>
                    {o.hint && (
                      <span className="text-[10px] flex-shrink-0" style={{ color: 'var(--color-muted)' }}>
                        {o.hint}
                      </span>
                    )}
                    {isSel && <Check size={11} className="flex-shrink-0" />}
                  </button>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
