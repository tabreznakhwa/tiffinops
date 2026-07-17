'use client'

import { useState, useRef, useEffect } from 'react'
import { ChevronDown, X, Calendar } from 'lucide-react'

// ── Dubai date helpers ─────────────────────────────────────────────────────────

function dubaiStr(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dubai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d)
}

function getDubaiDayOfWeek(d: Date): number {
  const day = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Dubai', weekday: 'short' }).format(d)
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(day)
}

export type DatePreset = '' | 'today' | 'yesterday' | 'this_week' | 'this_month' | 'last_month' | 'custom'

const PRESET_LABELS: Record<DatePreset, string> = {
  '':          'All Time',
  today:       'Today',
  yesterday:   'Yesterday',
  this_week:   'This Week',
  this_month:  'This Month',
  last_month:  'Last Month',
  custom:      'Custom Range',
}

const PRESETS: DatePreset[] = ['', 'today', 'yesterday', 'this_week', 'this_month', 'last_month', 'custom']

function computeRange(p: DatePreset): { from: string; to: string } {
  const now   = new Date()
  const today = dubaiStr(now)

  if (p === 'today') return { from: today, to: today }

  if (p === 'yesterday') {
    const yest = new Date(now.getTime() - 86_400_000)
    return { from: dubaiStr(yest), to: dubaiStr(yest) }
  }

  if (p === 'this_week') {
    // Monday = start of week
    const dow = getDubaiDayOfWeek(now)
    const daysBack = dow === 0 ? 6 : dow - 1
    const monday = new Date(now.getTime() - daysBack * 86_400_000)
    return { from: dubaiStr(monday), to: today }
  }

  if (p === 'this_month') {
    return { from: `${today.slice(0, 7)}-01`, to: today }
  }

  if (p === 'last_month') {
    const dow = getDubaiDayOfWeek(now)
    // Get Dubai year/month
    const [y, m] = today.split('-').map(Number)
    const prevM = m === 1 ? 12 : m - 1
    const prevY = m === 1 ? y - 1 : y
    const lastDay = new Date(prevY, prevM, 0).getDate()
    const ms = String(prevM).padStart(2, '0')
    const ld = String(lastDay).padStart(2, '0')
    void dow
    return { from: `${prevY}-${ms}-01`, to: `${prevY}-${ms}-${ld}` }
  }

  return { from: '', to: '' }
}

// ── Component ──────────────────────────────────────────────────────────────────

interface Props {
  fromDate: string
  toDate:   string
  onChange: (from: string, to: string) => void
}

export function DatePresetPicker({ fromDate, toDate, onChange }: Props) {
  const [preset, setPreset] = useState<DatePreset>('')
  const [open,   setOpen]   = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function close(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  function pick(p: DatePreset) {
    setPreset(p)
    setOpen(false)
    if (p === '' ) { onChange('', ''); return }
    if (p === 'custom') return           // leave dates as-is; user fills inputs
    const { from, to } = computeRange(p)
    onChange(from, to)
  }

  function clear() {
    setPreset('')
    onChange('', '')
  }

  const active = !!(fromDate || toDate)
  const label  = PRESET_LABELS[preset] ?? 'All Time'

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <div ref={ref} className="relative">
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-xs font-semibold whitespace-nowrap"
          style={{
            background: active ? 'var(--color-ink)' : 'var(--color-surface)',
            color:      active ? '#fff'              : 'var(--color-muted)',
            border: '1px solid var(--color-border)',
          }}
        >
          <Calendar size={12} aria-hidden="true" />
          {label}
          <ChevronDown size={11} />
        </button>

        {open && (
          <div
            className="absolute left-0 top-full mt-1 z-50 rounded-[12px] overflow-hidden"
            style={{
              minWidth: 168,
              background: 'var(--color-surface)',
              border:     '1px solid var(--color-border)',
              boxShadow:  'var(--shadow-card)',
            }}
          >
            {PRESETS.map(p => (
              <button
                key={p}
                type="button"
                onClick={() => pick(p)}
                className="w-full text-left px-3.5 py-2 text-xs font-semibold transition-colors"
                style={{
                  background: preset === p ? 'var(--color-saffron-soft)' : 'transparent',
                  color:      preset === p ? 'var(--color-saffron)'      : 'var(--color-ink)',
                }}
              >
                {PRESET_LABELS[p]}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Custom date inputs — shown only when custom is selected */}
      {preset === 'custom' && (
        <>
          <input
            type="date"
            value={fromDate}
            onChange={e => onChange(e.target.value, toDate)}
            className="rounded-[8px] px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-saffron"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-ink)' }}
          />
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>–</span>
          <input
            type="date"
            value={toDate}
            onChange={e => onChange(fromDate, e.target.value)}
            className="rounded-[8px] px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-saffron"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-ink)' }}
          />
        </>
      )}

      {/* Preview label for non-custom presets when active */}
      {active && preset !== 'custom' && preset !== '' && (
        <span className="text-[11px]" style={{ color: 'var(--color-muted)' }}>
          {fromDate}{fromDate !== toDate ? ` – ${toDate}` : ''}
        </span>
      )}

      {active && (
        <button
          type="button"
          onClick={clear}
          title="Clear filter"
          className="flex items-center justify-center w-6 h-6 rounded-full"
          style={{ background: 'var(--color-border)', color: 'var(--color-muted)' }}
        >
          <X size={11} />
        </button>
      )}
    </div>
  )
}
