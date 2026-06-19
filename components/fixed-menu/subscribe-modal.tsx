'use client'

import { useState, useEffect } from 'react'
import { X, Search } from 'lucide-react'
import { createSubscription } from '@/lib/fixed-menu/actions'
import { useAppSettings } from '@/components/settings/settings-context'
import type { Tables } from '@/lib/supabase/types'

type Plan = Tables<'fixed_plans'>
type Customer = {
  id: string
  full_name: string
  customer_code: string
  mobile_number: string
  customer_type: string
}

const PERIOD_ICONS: Record<string, string> = {
  breakfast: '🌅', lunch: '☀️', dinner: '🌙',
}

function todayDubai() {
  const now = new Date()
  const offset = 4 * 60 * 60 * 1000 // UTC+4
  return new Date(now.getTime() + offset).toISOString().split('T')[0]
}

export function SubscribeModal({
  plans,
  customers,
  onClose,
}: {
  plans: Plan[]
  customers: Customer[]
  onClose: () => void
}) {
  const { currency } = useAppSettings()
  const activePlans = plans.filter(p => p.is_active)

  const [query, setQuery]                       = useState('')
  const [showList, setShowList]                 = useState(false)
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)
  const [selectedPlan, setSelectedPlan]         = useState<Plan | null>(null)
  const [startDate, setStartDate]               = useState(todayDubai)
  const [price, setPrice]                       = useState('')
  const [notes, setNotes]                       = useState('')
  const [loading, setLoading]                   = useState(false)
  const [error, setError]                       = useState('')

  // Pre-fill price when plan changes
  useEffect(() => {
    if (selectedPlan) {
      setPrice(parseFloat(String(selectedPlan.default_monthly_price)).toFixed(2))
    }
  }, [selectedPlan])

  const filteredCustomers = customers.filter(c => {
    if (!query.trim()) return true
    const q = query.toLowerCase()
    return (
      c.full_name.toLowerCase().includes(q) ||
      c.customer_code.toLowerCase().includes(q) ||
      c.mobile_number.includes(q)
    )
  })

  function selectCustomer(c: Customer) {
    setSelectedCustomer(c)
    setQuery('')
    setShowList(false)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedCustomer || !selectedPlan) return
    setError('')
    setLoading(true)

    const result = await createSubscription({
      customer_id: selectedCustomer.id,
      fixed_plan_id: selectedPlan.id,
      start_date: startDate,
      agreed_monthly_price: parseFloat(price),
      notes: notes.trim() || undefined,
    })

    setLoading(false)
    if (result.error) { setError(result.error); return }
    onClose()
  }

  const canSubmit = !!selectedCustomer && !!selectedPlan && startDate !== '' && price !== '' && !loading

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
          New Subscription
        </p>
        <h2 className="font-display font-bold text-[20px] mb-5" style={{ color: 'var(--color-ink)' }}>
          Subscribe Customer
        </h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Customer picker */}
          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--color-muted)' }}>
              Customer *
            </label>

            {selectedCustomer ? (
              <div
                className="flex items-center justify-between rounded-[10px] px-3 py-2.5"
                style={{ background: 'var(--color-saffron-soft)', border: '1.5px solid var(--color-saffron)' }}
              >
                <div>
                  <p className="text-sm font-semibold" style={{ color: 'var(--color-ink)' }}>
                    {selectedCustomer.full_name}
                  </p>
                  <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                    {selectedCustomer.customer_code} · {selectedCustomer.mobile_number}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedCustomer(null)}
                  className="text-xs font-bold"
                  style={{ color: 'var(--color-ember)' }}
                >
                  Change
                </button>
              </div>
            ) : (
              <div className="relative">
                <Search
                  size={13}
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
                  style={{ color: 'var(--color-muted)' }}
                />
                <input
                  type="text"
                  value={query}
                  onChange={e => { setQuery(e.target.value); setShowList(true) }}
                  onFocus={() => setShowList(true)}
                  placeholder="Search by name, code or phone…"
                  className="w-full rounded-[10px] pl-8 pr-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-saffron"
                  style={{ background: 'var(--color-cream)', border: '1px solid var(--color-border)', color: 'var(--color-ink)' }}
                />
                {showList && filteredCustomers.length > 0 && (
                  <div
                    className="absolute z-10 w-full mt-1 rounded-[10px] overflow-auto shadow-lg"
                    style={{
                      background: 'var(--color-surface)',
                      border: '1px solid var(--color-border)',
                      maxHeight: 200,
                    }}
                  >
                    {filteredCustomers.slice(0, 8).map((c, i) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => selectCustomer(c)}
                        className="w-full flex flex-col px-3 py-2.5 text-left hover:bg-cream"
                        style={{ borderTop: i > 0 ? '1px solid var(--color-border)' : undefined }}
                      >
                        <span className="text-sm font-semibold" style={{ color: 'var(--color-ink)' }}>
                          {c.full_name}
                        </span>
                        <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
                          {c.customer_code} · {c.mobile_number}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Plan picker */}
          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--color-muted)' }}>
              Plan *
            </label>
            {activePlans.length === 0 ? (
              <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
                No active plans available. Create a plan first.
              </p>
            ) : (
              <div className="space-y-2">
                {activePlans.map(p => {
                  const on = selectedPlan?.id === p.id
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setSelectedPlan(p)}
                      className="w-full flex items-center justify-between rounded-[10px] px-3 py-2.5 text-left"
                      style={{
                        background: on ? 'var(--color-saffron-soft)' : 'var(--color-cream)',
                        border: `1.5px solid ${on ? 'var(--color-saffron)' : 'var(--color-border)'}`,
                      }}
                    >
                      <div>
                        <p className="text-sm font-semibold" style={{ color: 'var(--color-ink)' }}>
                          {p.plan_name}
                        </p>
                        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                          {p.meal_periods.map(mp => PERIOD_ICONS[mp] + ' ' + mp.charAt(0).toUpperCase() + mp.slice(1)).join(' · ')}
                        </p>
                      </div>
                      <span
                        className="text-sm font-bold num flex-shrink-0 ml-3"
                        style={{ color: on ? 'var(--color-ember)' : 'var(--color-muted)' }}
                      >
                        {currency} {parseFloat(String(p.default_monthly_price)).toFixed(0)}/mo
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* Start date + Agreed price */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--color-muted)' }}>
                Start Date *
              </label>
              <input
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                className="w-full rounded-[10px] px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-saffron"
                style={{ background: 'var(--color-cream)', border: '1px solid var(--color-border)', color: 'var(--color-ink)' }}
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--color-muted)' }}>
                Agreed Price ({currency}/mo) *
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

          {/* Notes */}
          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--color-muted)' }}>
              Notes
            </label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              placeholder="Optional notes (e.g. dietary preferences)"
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
              {loading ? 'Subscribing…' : 'Subscribe'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
