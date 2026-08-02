'use client'

import { useState } from 'react'
import { X } from 'lucide-react'
import { pauseSubscriptionMeal } from '@/lib/fixed-menu/actions'

const PERIOD_ICONS: Record<string, string> = {
  breakfast: '🌅', lunch: '☀️', dinner: '🌙',
}
const PERIOD_LABEL: Record<string, string> = {
  breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner',
}

function todayDubai() {
  const now = new Date()
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

export function MealPauseModal({
  subscriptionId,
  availableMeals,
  onClose,
}: {
  subscriptionId: string
  availableMeals: string[]
  onClose: () => void
}) {
  const [meal, setMeal]           = useState(availableMeals[0] ?? '')
  const [pauseStart, setPauseStart] = useState(todayDubai())
  const [pauseEnd, setPauseEnd]     = useState('')
  const [reason, setReason]         = useState('')
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const result = await pauseSubscriptionMeal({
      subscription_id: subscriptionId,
      meal_period: meal as 'breakfast' | 'lunch' | 'dinner',
      pause_start: pauseStart,
      pause_end: pauseEnd || undefined,
      reason: reason.trim() || undefined,
    })

    setLoading(false)
    if (result.error) { setError(result.error); return }
    onClose()
  }

  const canSubmit = !!meal && pauseStart !== '' && !loading

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(34,26,19,.55)' }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div
        className="relative w-full max-w-sm rounded-[18px] p-6 shadow-xl"
        style={{ background: 'var(--color-surface)' }}
      >
        <button
          onClick={onClose}
          className="absolute right-4 top-4 flex items-center justify-center w-8 h-8 rounded-full"
          style={{ color: 'var(--color-muted)' }}
          aria-label="Close"
        >
          <X size={18} />
        </button>

        <p className="text-xs font-bold uppercase tracking-widest mb-0.5" style={{ color: 'var(--color-saffron)', letterSpacing: '.12em' }}>
          Pause a Meal
        </p>
        <h2 className="font-display font-bold text-[20px] mb-5" style={{ color: 'var(--color-ink)' }}>
          Pause One Meal
        </h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Meal */}
          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--color-muted)' }}>Meal *</label>
            <div className="flex gap-2">
              {availableMeals.map(m => {
                const on = meal === m
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMeal(m)}
                    className="flex-1 rounded-[10px] px-3 py-2.5 text-sm font-semibold"
                    style={{
                      background: on ? 'var(--color-saffron-soft)' : 'var(--color-cream)',
                      border: `1.5px solid ${on ? 'var(--color-saffron)' : 'var(--color-border)'}`,
                      color: on ? 'var(--color-ember)' : 'var(--color-ink)',
                    }}
                  >
                    {PERIOD_ICONS[m]} {PERIOD_LABEL[m]}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Pause start + Resume date */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--color-muted)' }}>Pause From *</label>
              <input
                type="date"
                value={pauseStart}
                onChange={e => setPauseStart(e.target.value)}
                className="w-full rounded-[10px] px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-saffron"
                style={{ background: 'var(--color-cream)', border: '1px solid var(--color-border)', color: 'var(--color-ink)' }}
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--color-muted)' }}>Resume On</label>
              <input
                type="date"
                value={pauseEnd}
                min={pauseStart}
                onChange={e => setPauseEnd(e.target.value)}
                className="w-full rounded-[10px] px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-saffron"
                style={{ background: 'var(--color-cream)', border: '1px solid var(--color-border)', color: 'var(--color-ink)' }}
              />
            </div>
          </div>
          <p className="text-[11px] -mt-2" style={{ color: 'var(--color-muted)' }}>
            Leave Resume On blank if you don&apos;t know the date yet — resume it manually later.
          </p>

          {/* Reason */}
          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--color-muted)' }}>Reason</label>
            <input
              type="text"
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="e.g. Night shift this month"
              className="w-full rounded-[10px] px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-saffron"
              style={{ background: 'var(--color-cream)', border: '1px solid var(--color-border)', color: 'var(--color-ink)' }}
            />
          </div>

          {error && (
            <p className="text-xs font-semibold px-3 py-2 rounded-[8px]" style={{ background: 'var(--color-red-soft)', color: 'var(--color-red)' }}>
              {error}
            </p>
          )}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-[10px] px-4 py-2.5 text-sm font-semibold"
              style={{ color: 'var(--color-muted)', border: '1px solid var(--color-border)' }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className="flex-1 rounded-[10px] px-4 py-2.5 text-sm font-semibold disabled:opacity-50"
              style={{ background: 'var(--color-saffron)', color: '#fff' }}
            >
              {loading ? 'Saving…' : 'Pause Meal'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
