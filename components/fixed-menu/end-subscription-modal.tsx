'use client'

import { useState } from 'react'
import { X } from 'lucide-react'
import { updateSubscriptionStatus } from '@/lib/fixed-menu/actions'

function todayDubai() {
  return new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString().split('T')[0]
}

type Mode = 'temporary' | 'permanent'

/**
 * Shared "end this subscription" dialog — used from both the Fixed Menu page
 * and the Outstanding page's Cancel button. Lets the owner choose whether
 * this is a Temporary (pause, resumable) or Permanent (cancel, done) stop,
 * and pick the date it actually took effect (defaults to today, but a
 * cancellation is often recorded a little after the fact).
 */
export function EndSubscriptionModal({
  subscriptionId,
  customerName,
  onClose,
  onDone,
}: {
  subscriptionId: string
  customerName: string
  onClose: () => void
  onDone: () => void
}) {
  const [mode, setMode]       = useState<Mode>('permanent')
  const [date, setDate]       = useState(todayDubai)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')

  const isFuture = date > todayDubai()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!date) return
    setLoading(true)
    setError('')
    const res = await updateSubscriptionStatus(
      subscriptionId,
      mode === 'temporary' ? 'paused' : 'cancelled',
      date,
    )
    setLoading(false)
    if (res.error) { setError(res.error); return }
    onDone()
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
          Fixed Menu
        </p>
        <h2 className="font-display font-bold text-[20px] mb-1" style={{ color: 'var(--color-ink)' }}>
          End Subscription
        </h2>
        <p className="text-xs mb-5" style={{ color: 'var(--color-muted)' }}>{customerName}</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Temporary vs Permanent */}
          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--color-muted)' }}>
              How long?
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setMode('temporary')}
                className="text-left px-3 py-2.5 rounded-[10px]"
                style={{
                  background: mode === 'temporary' ? '#FEF3C7' : 'var(--color-cream)',
                  border: `1.5px solid ${mode === 'temporary' ? 'var(--color-gold)' : 'var(--color-border)'}`,
                }}
              >
                <p className="text-sm font-bold" style={{ color: mode === 'temporary' ? 'var(--color-gold)' : 'var(--color-ink)' }}>
                  Temporary
                </p>
                <p className="text-[11px] mt-0.5" style={{ color: 'var(--color-muted)' }}>
                  Pause — can Resume later
                </p>
              </button>
              <button
                type="button"
                onClick={() => setMode('permanent')}
                className="text-left px-3 py-2.5 rounded-[10px]"
                style={{
                  background: mode === 'permanent' ? 'var(--color-red-soft)' : 'var(--color-cream)',
                  border: `1.5px solid ${mode === 'permanent' ? 'var(--color-red)' : 'var(--color-border)'}`,
                }}
              >
                <p className="text-sm font-bold" style={{ color: mode === 'permanent' ? 'var(--color-red)' : 'var(--color-ink)' }}>
                  Permanent
                </p>
                <p className="text-[11px] mt-0.5" style={{ color: 'var(--color-muted)' }}>
                  Cancel — customer is done
                </p>
              </button>
            </div>
          </div>

          {/* Effective date */}
          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--color-muted)' }}>
              Effective Date *
            </label>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              required
              className="w-full rounded-[10px] px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-saffron"
              style={{ background: 'var(--color-cream)', border: '1px solid var(--color-border)', color: 'var(--color-ink)' }}
            />
            <p className="text-[11px] mt-1" style={{ color: 'var(--color-muted)' }}>
              Billing stops from this date — pick an earlier date if the customer already stopped a few days ago.
            </p>
            {isFuture && (
              <p className="text-[11px] mt-1 font-semibold" style={{ color: 'var(--color-gold)' }}>
                Future date — this subscription stops appearing in new billing runs starting today, so any
                charges for the days before {date} will need to be added manually.
              </p>
            )}
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
              Close
            </button>
            <button
              type="submit"
              disabled={loading || !date}
              className="flex-1 py-2.5 rounded-[10px] text-sm font-semibold disabled:opacity-50"
              style={mode === 'temporary'
                ? { background: '#FEF3C7', color: 'var(--color-gold)', border: '1px solid #FDE68A' }
                : { background: 'var(--color-red)', color: '#fff' }}
            >
              {loading
                ? 'Saving…'
                : mode === 'temporary' ? 'Pause Subscription' : 'Cancel Subscription'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
