'use client'

import { useState, useEffect } from 'react'
import { X } from 'lucide-react'
import { changeSubscriptionPlan } from '@/lib/fixed-menu/actions'
import { useAppSettings } from '@/components/settings/settings-context'
import type { Tables } from '@/lib/supabase/types'

type Plan = Tables<'fixed_plans'>

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

// Splits a total price evenly across meals, keeping 2dp and no rounding drift
// (the last meal absorbs whatever cents are left over).
function evenSplit(mealPeriods: string[], totalPrice: number): Record<string, string> {
  if (mealPeriods.length === 0 || !Number.isFinite(totalPrice)) return {}
  const result: Record<string, string> = {}
  let allocated = 0
  mealPeriods.forEach((m, i) => {
    if (i === mealPeriods.length - 1) {
      result[m] = Math.max(0, totalPrice - allocated).toFixed(2)
    } else {
      const share = Math.round((totalPrice / mealPeriods.length) * 100) / 100
      result[m] = share.toFixed(2)
      allocated += share
    }
  })
  return result
}

/**
 * Switches a subscription to a different plan (e.g. Dinner → Lunch after a
 * duty change) as a single action. Under the hood this closes the current
 * subscription the day before the effective date and opens a new one on the
 * new plan from that date — never edits the plan on the existing row in
 * place — so past billing for the old plan is untouched and the new plan
 * only ever applies going forward. See changeSubscriptionPlan in
 * lib/fixed-menu/actions.ts.
 */
export function ChangePlanModal({
  subscriptionId,
  customerName,
  currentPlanName,
  plans,
  currentPlanId,
  onClose,
  onDone,
}: {
  subscriptionId: string
  customerName: string
  currentPlanName: string
  currentPlanId: string
  plans: Plan[]
  onClose: () => void
  onDone: () => void
}) {
  const { currency } = useAppSettings()
  const activePlans = plans.filter(p => p.is_active || p.id === currentPlanId)

  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null)
  const [effectiveDate, setEffectiveDate] = useState(todayDubai)
  const [price, setPrice] = useState('')
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [pendingApproval, setPendingApproval] = useState(false)

  const [mealPrices, setMealPrices] = useState<Record<string, string>>({})
  const [mealPricesTouched, setMealPricesTouched] = useState(false)

  useEffect(() => {
    if (selectedPlan) setPrice(parseFloat(String(selectedPlan.default_monthly_price)).toFixed(2))
  }, [selectedPlan])

  useEffect(() => {
    if (!selectedPlan) return
    if (selectedPlan.meal_periods.length <= 1) { setMealPrices({}); return }
    if (mealPricesTouched) return
    const p = parseFloat(price)
    if (!Number.isFinite(p) || p < 0) return
    setMealPrices(evenSplit(selectedPlan.meal_periods, p))
  }, [selectedPlan, price, mealPricesTouched])

  function handleMealPriceChange(meal: string, val: string) {
    setMealPricesTouched(true)
    setMealPrices(prev => ({ ...prev, [meal]: val }))
  }

  function resetMealSplit() {
    if (!selectedPlan) return
    const p = parseFloat(price)
    setMealPricesTouched(false)
    if (Number.isFinite(p) && p >= 0) setMealPrices(evenSplit(selectedPlan.meal_periods, p))
  }

  const mealPricesSum = Object.values(mealPrices).reduce((s, v) => s + (parseFloat(v) || 0), 0)
  const needsMealSplit = !!selectedPlan && selectedPlan.meal_periods.length > 1
  const mealSplitValid = !needsMealSplit || Math.abs(mealPricesSum - (parseFloat(price) || 0)) <= 0.02

  const isFuture = effectiveDate > todayDubai()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedPlan) return
    setError('')
    setLoading(true)

    const result = await changeSubscriptionPlan(subscriptionId, {
      fixed_plan_id: selectedPlan.id,
      agreed_monthly_price: parseFloat(price),
      meal_prices: needsMealSplit ? mealPrices : undefined,
      effective_date: effectiveDate,
      notes: notes.trim() || undefined,
    })

    setLoading(false)
    if (result.error) { setError(result.error); return }
    if (result.pendingApproval) { setPendingApproval(true); return }
    onDone()
  }

  const canSubmit = !!selectedPlan && selectedPlan.id !== currentPlanId && effectiveDate !== '' && price !== '' && mealSplitValid && !loading

  if (pendingApproval) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        style={{ background: 'rgba(34,26,19,.55)' }}
        onClick={e => e.target === e.currentTarget && onDone()}
      >
        <div
          className="relative w-full max-w-md rounded-[18px] p-6 shadow-xl text-center"
          style={{ background: 'var(--color-surface)' }}
        >
          <p className="text-xs font-bold uppercase tracking-widest mb-0.5" style={{ color: 'var(--color-saffron)', letterSpacing: '.12em' }}>
            Switch Plan
          </p>
          <h2 className="font-display font-bold text-[20px] mb-2" style={{ color: 'var(--color-ink)' }}>
            Sent for owner approval
          </h2>
          <p className="text-sm mb-5" style={{ color: 'var(--color-muted)' }}>
            This is a backdated change and can affect an already-issued invoice, so it needs the owner&apos;s approval before it applies. You&apos;ll see it on the Approvals page once resolved.
          </p>
          <button
            onClick={onDone}
            className="w-full rounded-[10px] px-4 py-2.5 text-sm font-semibold"
            style={{ background: 'var(--color-saffron)', color: '#fff' }}
          >
            Close
          </button>
        </div>
      </div>
    )
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(34,26,19,.55)' }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div
        className="relative w-full max-w-md rounded-[18px] p-6 shadow-xl overflow-y-auto"
        style={{ background: 'var(--color-surface)', maxHeight: 'calc(100vh - 48px)' }}
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
          Switch Plan
        </p>
        <h2 className="font-display font-bold text-[20px] mb-1" style={{ color: 'var(--color-ink)' }}>
          {customerName}
        </h2>
        <p className="text-xs mb-5" style={{ color: 'var(--color-muted)' }}>
          Currently on <span className="font-semibold">{currentPlanName}</span>. This ends that plan the day before
          the effective date below and starts the new one from that date — nothing before it changes.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* New plan picker */}
          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--color-muted)' }}>New Plan *</label>
            {activePlans.length === 0 ? (
              <p className="text-sm" style={{ color: 'var(--color-muted)' }}>No active plans available.</p>
            ) : (
              <div className="space-y-2">
                {activePlans.map(p => {
                  const on = selectedPlan?.id === p.id
                  const isCurrent = p.id === currentPlanId
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => !isCurrent && setSelectedPlan(p)}
                      disabled={isCurrent}
                      className="w-full flex items-center justify-between rounded-[10px] px-3 py-2.5 text-left disabled:opacity-50"
                      style={{
                        background: on ? 'var(--color-saffron-soft)' : 'var(--color-cream)',
                        border: `1.5px solid ${on ? 'var(--color-saffron)' : 'var(--color-border)'}`,
                      }}
                    >
                      <div>
                        <p className="text-sm font-semibold" style={{ color: 'var(--color-ink)' }}>
                          {p.plan_name}{isCurrent ? ' (current)' : ''}
                        </p>
                        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                          {p.meal_periods.map(mp => PERIOD_ICONS[mp] + ' ' + mp.charAt(0).toUpperCase() + mp.slice(1)).join(' · ')}
                        </p>
                      </div>
                      <span className="text-sm font-bold num flex-shrink-0 ml-3" style={{ color: on ? 'var(--color-ember)' : 'var(--color-muted)' }}>
                        {currency} {parseFloat(String(p.default_monthly_price)).toFixed(0)}/mo
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* Effective date + price */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--color-muted)' }}>Effective Date *</label>
              <input
                type="date"
                value={effectiveDate}
                onChange={e => setEffectiveDate(e.target.value)}
                className="w-full rounded-[10px] px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-saffron"
                style={{ background: 'var(--color-cream)', border: '1px solid var(--color-border)', color: 'var(--color-ink)' }}
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--color-muted)' }}>
                New Price ({currency}/mo) *
              </label>
              <input
                type="number"
                value={price}
                onChange={e => setPrice(e.target.value)}
                placeholder="0.00"
                min="0"
                step="0.01"
                className="w-full rounded-[10px] px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-saffron num"
                style={{ background: 'var(--color-cream)', border: '1px solid var(--color-border)', color: 'var(--color-ink)' }}
                required
              />
            </div>
          </div>
          {isFuture && (
            <p className="text-[11px] -mt-2" style={{ color: 'var(--color-gold)' }}>
              Future date — the old plan keeps billing until then.
            </p>
          )}

          {/* Per-meal price breakdown — required for multi-meal plans */}
          {needsMealSplit && selectedPlan && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-semibold" style={{ color: 'var(--color-muted)' }}>
                  Per-Meal Price Split *
                </label>
                <button
                  type="button"
                  onClick={resetMealSplit}
                  className="text-[11px] font-semibold"
                  style={{ color: 'var(--color-saffron)' }}
                >
                  Even split
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {selectedPlan.meal_periods.map(m => (
                  <div key={m}>
                    <label className="block text-[10.5px] font-semibold mb-1" style={{ color: 'var(--color-muted)' }}>
                      {PERIOD_ICONS[m]} {PERIOD_LABEL[m]}
                    </label>
                    <input
                      type="number"
                      value={mealPrices[m] ?? ''}
                      onChange={e => handleMealPriceChange(m, e.target.value)}
                      placeholder="0.00"
                      min="0"
                      step="0.01"
                      className="w-full rounded-[8px] px-2 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-saffron num"
                      style={{ background: 'var(--color-cream)', border: '1px solid var(--color-border)', color: 'var(--color-ink)' }}
                    />
                  </div>
                ))}
              </div>
              <p
                className="text-[11px] font-semibold mt-1.5"
                style={{ color: mealSplitValid ? 'var(--color-muted)' : 'var(--color-red)' }}
              >
                Total {currency} {mealPricesSum.toFixed(2)} of {currency} {(parseFloat(price) || 0).toFixed(2)}
                {!mealSplitValid && ' — must match the new price'}
              </p>
            </div>
          )}

          {/* Notes */}
          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--color-muted)' }}>Notes</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              placeholder="e.g. duty change to morning shift"
              className="w-full rounded-[10px] px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-saffron resize-none"
              style={{ background: 'var(--color-cream)', border: '1px solid var(--color-border)', color: 'var(--color-ink)' }}
            />
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
              {loading ? 'Switching…' : 'Switch Plan'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
