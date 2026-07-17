'use client'

import { useState, useEffect } from 'react'
import { X, Search } from 'lucide-react'
import { recordPayment } from '@/lib/payments/actions'
import type { Enums } from '@/lib/supabase/types'

type PaymentMode = Enums<'payment_mode'>

type Customer = {
  id: string
  full_name: string
  customer_code: string
  mobile_number: string
  area: string | null
}

const MODES: { value: PaymentMode; label: string; requiresRef: boolean }[] = [
  { value: 'cash',          label: 'Cash',          requiresRef: false },
  { value: 'bank_transfer', label: 'Bank Transfer',  requiresRef: true  },
  { value: 'card',          label: 'Card',           requiresRef: false },
  { value: 'online',        label: 'Online',         requiresRef: true  },
  { value: 'cheque',        label: 'Cheque',         requiresRef: true  },
  { value: 'wallet',        label: 'Wallet',         requiresRef: false },
  { value: 'other',         label: 'Other',          requiresRef: false },
]

const MODE_STYLE: Record<PaymentMode, { bg: string; color: string }> = {
  cash:          { bg: 'var(--color-green-soft)',  color: 'var(--color-green)'  },
  bank_transfer: { bg: 'var(--color-purple-soft)', color: 'var(--color-purple)' },
  card:          { bg: 'var(--color-blue-soft)',   color: 'var(--color-blue)'   },
  online:        { bg: 'var(--color-saffron-soft)',color: 'var(--color-saffron)'},
  cheque:        { bg: '#FEF3C7',                  color: 'var(--color-gold)'   },
  wallet:        { bg: 'var(--color-red-soft)',    color: 'var(--color-ember)'  },
  other:         { bg: 'var(--color-border)',      color: 'var(--color-muted)'  },
}

function todayDubai() {
  return new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString().split('T')[0]
}

export function RecordPaymentModal({
  customers,
  preselectedCustomer,
  onClose,
}: {
  customers: Customer[]
  preselectedCustomer?: Customer
  onClose: () => void
}) {
  const [query, setQuery]           = useState('')
  const [showList, setShowList]     = useState(false)
  const [customer, setCustomer]     = useState<Customer | null>(preselectedCustomer ?? null)
  const [amount, setAmount]         = useState('')
  const [mode, setMode]             = useState<PaymentMode>('cash')
  const [reference, setReference]   = useState('')
  const [date, setDate]             = useState(todayDubai)
  const [notes, setNotes]           = useState('')
  const [isAdvance, setIsAdvance]   = useState(false)
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState('')

  const requiresRef = MODES.find(m => m.value === mode)?.requiresRef ?? false

  // Clear reference when mode changes to one that doesn't need it
  useEffect(() => { if (!requiresRef) setReference('') }, [requiresRef])

  const filtered = customers.filter(c => {
    const q = query.toLowerCase()
    return !q ||
      c.full_name.toLowerCase().includes(q) ||
      c.customer_code.toLowerCase().includes(q) ||
      c.mobile_number.includes(q)
  })

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!customer) return
    setError('')
    setLoading(true)

    const result = await recordPayment({
      customer_id: customer.id,
      amount: parseFloat(amount),
      mode,
      reference_number: reference.trim() || undefined,
      payment_date: date,
      notes: notes.trim() || undefined,
      is_advance: isAdvance,
    })

    setLoading(false)
    if (result.error) { setError(result.error); return }
    onClose()
  }

  const canSubmit = !!customer && amount !== '' && parseFloat(amount) > 0 &&
    date !== '' && (!requiresRef || reference.trim().length > 0) && !loading

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
          Payments
        </p>
        <h2 className="font-display font-bold text-[20px] mb-5" style={{ color: 'var(--color-ink)' }}>
          Record Payment
        </h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Customer */}
          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--color-muted)' }}>
              Customer *
            </label>
            {customer ? (
              <div
                className="flex items-center justify-between rounded-[10px] px-3 py-2.5"
                style={{ background: 'var(--color-saffron-soft)', border: '1.5px solid var(--color-saffron)' }}
              >
                <div>
                  <p className="text-sm font-semibold" style={{ color: 'var(--color-ink)' }}>{customer.full_name}</p>
                  <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                    {customer.customer_code}{customer.area ? ` · ${customer.area}` : ''}
                  </p>
                </div>
                {!preselectedCustomer && (
                  <button
                    type="button"
                    onClick={() => { setCustomer(null); setQuery('') }}
                    className="text-xs font-bold"
                    style={{ color: 'var(--color-ember)' }}
                  >
                    Change
                  </button>
                )}
              </div>
            ) : (
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--color-muted)' }} />
                <input
                  type="text"
                  value={query}
                  onChange={e => { setQuery(e.target.value); setShowList(true) }}
                  onFocus={() => setShowList(true)}
                  placeholder="Search by name, code or phone…"
                  className="w-full rounded-[10px] pl-8 pr-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-saffron"
                  style={{ background: 'var(--color-cream)', border: '1px solid var(--color-border)', color: 'var(--color-ink)' }}
                />
                {showList && filtered.length > 0 && (
                  <div
                    className="absolute z-10 w-full mt-1 rounded-[10px] overflow-auto shadow-lg"
                    style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', maxHeight: 200 }}
                  >
                    {filtered.slice(0, 8).map((c, i) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => { setCustomer(c); setQuery(''); setShowList(false) }}
                        className="w-full flex flex-col px-3 py-2.5 text-left hover:bg-cream"
                        style={{ borderTop: i > 0 ? '1px solid var(--color-border)' : undefined }}
                      >
                        <span className="text-sm font-semibold" style={{ color: 'var(--color-ink)' }}>{c.full_name}</span>
                        <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{c.customer_code} · {c.mobile_number}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Amount + Date */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--color-muted)' }}>
                Amount (AED) *
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold pointer-events-none" style={{ color: 'var(--color-muted)' }}>
                  AED
                </span>
                <input
                  type="number"
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  placeholder="0.00"
                  min="0.01"
                  step="0.01"
                  className="w-full rounded-[10px] pl-12 pr-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-saffron num"
                  style={{ background: 'var(--color-cream)', border: '1px solid var(--color-border)', color: 'var(--color-ink)' }}
                  required
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--color-muted)' }}>
                Payment Date *
              </label>
              <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                className="w-full rounded-[10px] px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-saffron"
                style={{ background: 'var(--color-cream)', border: '1px solid var(--color-border)', color: 'var(--color-ink)' }}
                required
              />
            </div>
          </div>

          {/* Payment mode */}
          <div>
            <label className="block text-xs font-semibold mb-2" style={{ color: 'var(--color-muted)' }}>
              Payment Mode *
            </label>
            <div className="flex flex-wrap gap-1.5">
              {MODES.map(m => {
                const on = mode === m.value
                const style = MODE_STYLE[m.value]
                return (
                  <button
                    key={m.value}
                    type="button"
                    onClick={() => setMode(m.value)}
                    className="px-3 py-1.5 rounded-[8px] text-xs font-bold"
                    style={{
                      background: on ? style.bg : 'var(--color-cream)',
                      color: on ? style.color : 'var(--color-muted)',
                      border: `1.5px solid ${on ? style.color : 'var(--color-border)'}`,
                    }}
                  >
                    {m.label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Reference number (conditional) */}
          {requiresRef && (
            <div>
              <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--color-muted)' }}>
                Reference Number *{' '}
                <span style={{ color: 'var(--color-muted)', fontWeight: 400 }}>
                  (txn / cheque # / bank ref)
                </span>
              </label>
              <input
                type="text"
                value={reference}
                onChange={e => setReference(e.target.value)}
                placeholder="e.g. TXN12345678"
                className="w-full rounded-[10px] px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-saffron"
                style={{ background: 'var(--color-cream)', border: '1px solid var(--color-border)', color: 'var(--color-ink)' }}
                required
              />
            </div>
          )}

          {/* Notes */}
          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--color-muted)' }}>
              Notes
            </label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              placeholder="Optional notes"
              className="w-full rounded-[10px] px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-saffron resize-none"
              style={{ background: 'var(--color-cream)', border: '1px solid var(--color-border)', color: 'var(--color-ink)' }}
            />
          </div>

          {/* Advance toggle */}
          <button
            type="button"
            onClick={() => setIsAdvance(v => !v)}
            className="flex items-center gap-3 w-full rounded-[10px] px-3 py-2.5 text-left transition-colors"
            style={{
              background: isAdvance ? 'var(--color-purple-soft, #F5F3FF)' : 'var(--color-cream)',
              border: `1.5px solid ${isAdvance ? 'var(--color-purple, #7C3AED)' : 'var(--color-border)'}`,
            }}
          >
            <span
              className="flex-shrink-0 w-[18px] h-[18px] rounded-[5px] flex items-center justify-center transition-colors"
              style={{
                background: isAdvance ? 'var(--color-purple, #7C3AED)' : 'var(--color-border)',
              }}
            >
              {isAdvance && (
                <svg viewBox="0 0 12 12" fill="none" className="w-3 h-3">
                  <path d="M2 6l3 3 5-5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
            </span>
            <div className="flex-1">
              <p className="text-sm font-semibold" style={{ color: isAdvance ? 'var(--color-purple, #7C3AED)' : 'var(--color-ink)' }}>
                Mark as Advance Payment
              </p>
              <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                Customer paid in advance before orders are billed
              </p>
            </div>
          </button>

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
              {loading ? 'Recording…' : 'Record Payment'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
