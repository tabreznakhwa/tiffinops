'use client'

import { useState } from 'react'
import { X } from 'lucide-react'
import { createPlan, updatePlan } from '@/lib/fixed-menu/actions'
import type { Tables } from '@/lib/supabase/types'

type Plan = Tables<'fixed_plans'>

const PERIODS = [
  { value: 'breakfast', label: 'Breakfast', icon: '🌅' },
  { value: 'lunch',     label: 'Lunch',     icon: '☀️' },
  { value: 'dinner',    label: 'Dinner',    icon: '🌙' },
] as const

export function PlanModal({ plan, onClose }: { plan?: Plan; onClose: () => void }) {
  const isEdit = !!plan

  const [name, setName]           = useState(plan?.plan_name ?? '')
  const [desc, setDesc]           = useState(plan?.description ?? '')
  const [periods, setPeriods]     = useState<string[]>(plan?.meal_periods ?? [])
  const [price, setPrice]         = useState(
    plan ? parseFloat(String(plan.default_monthly_price)).toFixed(2) : ''
  )
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState('')

  function togglePeriod(p: string) {
    setPeriods(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p])
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const input = {
      plan_name: name.trim(),
      description: desc.trim() || undefined,
      meal_periods: periods,
      default_monthly_price: parseFloat(price),
    }

    const result = isEdit ? await updatePlan(plan.id, input) : await createPlan(input)
    setLoading(false)
    if (result.error) { setError(result.error); return }
    onClose()
  }

  const canSubmit = name.trim().length > 0 && periods.length > 0 && price !== '' && !loading

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(34,26,19,.55)' }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div
        className="relative w-full max-w-md rounded-[18px] p-6 shadow-xl"
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
          {isEdit ? 'Edit Plan' : 'New Plan'}
        </p>
        <h2 className="font-display font-bold text-[20px] mb-5" style={{ color: 'var(--color-ink)' }}>
          {isEdit ? 'Edit Fixed Plan' : 'Create Fixed Plan'}
        </h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Plan name */}
          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--color-muted)' }}>
              Plan Name *
            </label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Lunch Plan, Full Day Plan"
              className="w-full rounded-[10px] px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-saffron"
              style={{ background: 'var(--color-cream)', border: '1px solid var(--color-border)', color: 'var(--color-ink)' }}
              required
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--color-muted)' }}>
              Description
            </label>
            <textarea
              value={desc}
              onChange={e => setDesc(e.target.value)}
              rows={2}
              placeholder="Optional details about this plan"
              className="w-full rounded-[10px] px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-saffron resize-none"
              style={{ background: 'var(--color-cream)', border: '1px solid var(--color-border)', color: 'var(--color-ink)' }}
            />
          </div>

          {/* Meal periods */}
          <div>
            <label className="block text-xs font-semibold mb-2" style={{ color: 'var(--color-muted)' }}>
              Meal Periods *
            </label>
            <div className="flex gap-2">
              {PERIODS.map(p => {
                const on = periods.includes(p.value)
                return (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => togglePeriod(p.value)}
                    className="flex-1 flex flex-col items-center gap-1 py-3 rounded-[10px] text-[11px] font-bold transition-colors"
                    style={{
                      background: on ? 'var(--color-saffron-soft)' : 'var(--color-cream)',
                      border: `1.5px solid ${on ? 'var(--color-saffron)' : 'var(--color-border)'}`,
                      color: on ? 'var(--color-ember)' : 'var(--color-muted)',
                    }}
                  >
                    <span className="text-[20px]">{p.icon}</span>
                    {p.label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Default price */}
          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--color-muted)' }}>
              Default Monthly Price (AED) *
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold pointer-events-none" style={{ color: 'var(--color-muted)' }}>
                AED
              </span>
              <input
                type="number"
                value={price}
                onChange={e => setPrice(e.target.value)}
                placeholder="0.00"
                min="0"
                step="0.01"
                className="w-full rounded-[10px] pl-12 pr-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-saffron num"
                style={{ background: 'var(--color-cream)', border: '1px solid var(--color-border)', color: 'var(--color-ink)' }}
                required
              />
            </div>
          </div>

          {error && (
            <p className="text-sm font-semibold" style={{ color: 'var(--color-red)' }}>{error}</p>
          )}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-[10px] text-sm font-semibold"
              style={{ background: 'var(--color-cream)', border: '1px solid var(--color-border)', color: 'var(--color-muted)' }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className="flex-1 py-2.5 rounded-[10px] text-sm font-semibold disabled:opacity-50"
              style={{ background: 'var(--color-saffron)', color: '#fff' }}
            >
              {loading ? 'Saving…' : isEdit ? 'Update Plan' : 'Create Plan'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
