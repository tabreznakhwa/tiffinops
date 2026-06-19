'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Search, AlertTriangle, FileSpreadsheet, Printer, X } from 'lucide-react'
import { voidPayment } from '@/lib/payments/actions'
import { requestApproval } from '@/lib/approvals/actions'
import { RecordPaymentModal } from './record-payment-modal'
import { useAppSettings } from '@/components/settings/settings-context'
import type { Enums } from '@/lib/supabase/types'

type PaymentMode = Enums<'payment_mode'>

export type PaymentRow = {
  id: string
  payment_number: string
  customer_id: string
  payment_date: string
  amount: string
  mode: PaymentMode
  reference_number: string | null
  notes: string | null
  voided_at: string | null
  void_reason: string | null
  customers: {
    id: string
    full_name: string
    customer_code: string
    mobile_number: string
    area: string | null
  } | null
}

export type CustomerForModal = {
  id: string
  full_name: string
  customer_code: string
  mobile_number: string
  area: string | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const MODE_CONFIG: Record<PaymentMode, { label: string; bg: string; color: string }> = {
  cash:          { label: 'Cash',          bg: 'var(--color-green-soft)',  color: 'var(--color-green)'  },
  bank_transfer: { label: 'Bank Transfer', bg: 'var(--color-purple-soft)', color: 'var(--color-purple)' },
  card:          { label: 'Card',          bg: 'var(--color-blue-soft)',   color: 'var(--color-blue)'   },
  online:        { label: 'Online',        bg: 'var(--color-saffron-soft)',color: 'var(--color-saffron)'},
  cheque:        { label: 'Cheque',        bg: '#FEF3C7',                  color: 'var(--color-gold)'   },
  wallet:        { label: 'Wallet',        bg: 'var(--color-red-soft)',    color: 'var(--color-ember)'  },
  other:         { label: 'Other',         bg: 'var(--color-border)',      color: 'var(--color-muted)'  },
}

function fmtDate(d: string) {
  return new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  })
}

function exportCSV(rows: PaymentRow[], from: string, to: string, currency: string) {
  const header = ['Payment #', 'Date', 'Customer', 'Code', 'Mode', 'Reference', `Amount (${currency})`, 'Notes']
  const data = rows.map(p => [
    p.payment_number,
    p.payment_date,
    p.customers?.full_name ?? '',
    p.customers?.customer_code ?? '',
    MODE_CONFIG[p.mode]?.label ?? p.mode,
    p.reference_number ?? '',
    parseFloat(String(p.amount)).toFixed(2),
    p.notes ?? '',
  ])
  const csv = [header, ...data]
    .map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
    .join('\r\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url
  a.download = `payments_${from || 'all'}_to_${to || 'all'}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// ── Component ─────────────────────────────────────────────────────────────────

export function PaymentsModule({
  payments,
  customers,
  todayTotal,
  monthTotal,
  isOwner,
}: {
  payments: PaymentRow[]
  customers: CustomerForModal[]
  todayTotal: number
  monthTotal: number
  isOwner: boolean
}) {
  const router = useRouter()
  const { currency } = useAppSettings()

  const [search, setSearch]           = useState('')
  const [fromDate, setFromDate]       = useState('')
  const [toDate, setToDate]           = useState('')
  const [showVoided, setShowVoided]   = useState(false)
  const [showModal, setShowModal]     = useState(false)
  const [voidingId, setVoidingId]         = useState<string | null>(null)
  const [voidReason, setVoidReason]       = useState('')
  const [voidError, setVoidError]         = useState('')
  const [voidLoading, setVoidLoading]     = useState(false)
  const [reqVoidId, setReqVoidId]         = useState<string | null>(null)
  const [reqVoidReason, setReqVoidReason] = useState('')
  const [reqVoidError, setReqVoidError]   = useState('')
  const [reqVoidLoading, setReqVoidLoading] = useState(false)

  // Derived
  const nonVoided = payments.filter(p => !p.voided_at)
  const voided    = payments.filter(p => !!p.voided_at)
  const hasDateFilter = !!(fromDate || toDate)

  const filtered = useMemo(() => {
    let list = showVoided ? payments : nonVoided
    if (fromDate) list = list.filter(p => p.payment_date >= fromDate)
    if (toDate)   list = list.filter(p => p.payment_date <= toDate)
    if (!search.trim()) return list
    const q = search.toLowerCase()
    return list.filter(p =>
      p.customers?.full_name.toLowerCase().includes(q) ||
      p.customers?.customer_code.toLowerCase().includes(q) ||
      p.payment_number.toLowerCase().includes(q) ||
      p.reference_number?.toLowerCase().includes(q)
    )
  }, [payments, nonVoided, showVoided, search, fromDate, toDate])

  // For report export: non-voided within date range only
  const reportRows = useMemo(() => {
    let list = nonVoided
    if (fromDate) list = list.filter(p => p.payment_date >= fromDate)
    if (toDate)   list = list.filter(p => p.payment_date <= toDate)
    return list
  }, [nonVoided, fromDate, toDate])

  // Mode breakdown for report toolbar
  const modeBreakdown = useMemo(() => {
    const map = new Map<PaymentMode, number>()
    for (const p of reportRows) {
      map.set(p.mode, (map.get(p.mode) ?? 0) + parseFloat(String(p.amount)))
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1])
  }, [reportRows])

  const reportTotal = reportRows.reduce((s, p) => s + parseFloat(String(p.amount)), 0)

  async function handleVoid() {
    if (!voidingId) return
    setVoidError('')
    setVoidLoading(true)
    const result = await voidPayment(voidingId, voidReason)
    setVoidLoading(false)
    if (result.error) { setVoidError(result.error); return }
    setVoidingId(null)
    setVoidReason('')
    router.refresh()
  }

  async function handleRequestVoid() {
    if (!reqVoidId) return
    setReqVoidError('')
    setReqVoidLoading(true)
    const result = await requestApproval({
      request_type: 'delete',
      target_table: 'payment',
      target_id: reqVoidId,
      reason: reqVoidReason,
    })
    setReqVoidLoading(false)
    if (result.error) { setReqVoidError(result.error); return }
    setReqVoidId(null)
    setReqVoidReason('')
    router.refresh()
  }

  return (
    <div>
      {/* Page header */}
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--color-saffron)', letterSpacing: '.12em' }}>
            Payments
          </p>
          <h1 className="font-display font-bold text-[25px] mt-0.5" style={{ color: 'var(--color-ink)' }}>
            Payment History
          </h1>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-[10px] text-sm font-semibold flex-shrink-0 mt-1"
          style={{ background: 'var(--color-saffron)', color: '#fff' }}
        >
          <Plus size={15} />
          Record Payment
        </button>
      </div>

      {/* Summary strip */}
      <div
        className="flex flex-wrap items-center gap-4 px-4 py-3 rounded-[12px] mb-5"
        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
      >
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>
            Today
          </p>
          <p className="font-display font-bold text-[20px] num" style={{ color: 'var(--color-ink)' }}>
            {currency} {todayTotal.toFixed(2)}
          </p>
        </div>
        <div className="w-px self-stretch" style={{ background: 'var(--color-border)' }} />
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>
            This Month
          </p>
          <p className="font-display font-bold text-[20px] num" style={{ color: 'var(--color-ink)' }}>
            {currency} {monthTotal.toFixed(2)}
          </p>
        </div>
        <div className="w-px self-stretch" style={{ background: 'var(--color-border)' }} />
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>
            Total Payments
          </p>
          <p className="font-display font-bold text-[20px] num" style={{ color: 'var(--color-green)' }}>
            {nonVoided.length}
          </p>
        </div>
        {voided.length > 0 && (
          <>
            <div className="w-px self-stretch" style={{ background: 'var(--color-border)' }} />
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>
                Voided
              </p>
              <p className="font-display font-bold text-[20px] num" style={{ color: 'var(--color-red)' }}>
                {voided.length}
              </p>
            </div>
          </>
        )}
      </div>

      {/* Search + filter row */}
      <div className="flex flex-wrap gap-2 mb-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--color-muted)' }} />
          <input
            type="search"
            placeholder="Search customer, payment# or reference…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full rounded-[8px] pl-7 pr-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-saffron"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-ink)' }}
          />
        </div>
        <div className="flex items-center gap-1.5">
          <input
            type="date"
            value={fromDate}
            onChange={e => setFromDate(e.target.value)}
            className="rounded-[8px] px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-saffron"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-ink)' }}
          />
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>to</span>
          <input
            type="date"
            value={toDate}
            onChange={e => setToDate(e.target.value)}
            className="rounded-[8px] px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-saffron"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-ink)' }}
          />
          {hasDateFilter && (
            <button
              onClick={() => { setFromDate(''); setToDate('') }}
              className="flex items-center gap-0.5 px-2 py-1.5 rounded-[8px] text-xs font-bold"
              style={{ background: 'var(--color-border)', color: 'var(--color-muted)' }}
              title="Clear date filter"
            >
              <X size={11} /> Clear
            </button>
          )}
        </div>
        {voided.length > 0 && (
          <button
            onClick={() => setShowVoided(v => !v)}
            className="px-3 py-1.5 rounded-[8px] text-xs font-bold"
            style={{
              background: showVoided ? 'var(--color-red-soft)' : 'var(--color-surface)',
              color: showVoided ? 'var(--color-red)' : 'var(--color-muted)',
              border: '1px solid var(--color-border)',
            }}
          >
            {showVoided ? 'Hide Voided' : `Show Voided (${voided.length})`}
          </button>
        )}
      </div>

      {/* Report toolbar — visible when date range is set */}
      {hasDateFilter && (
        <div
          className="rounded-[12px] px-4 py-3 mb-4"
          style={{ background: 'var(--color-purple-soft)', border: '1px solid #C4A7E0' }}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-purple)' }}>
                  Report Total
                </p>
                <p className="font-display font-bold text-[20px] num" style={{ color: 'var(--color-purple)' }}>
                  {currency} {reportTotal.toFixed(2)}
                </p>
                <p className="text-[11px]" style={{ color: 'var(--color-purple)' }}>
                  {reportRows.length} payment{reportRows.length !== 1 ? 's' : ''}
                </p>
              </div>
              {modeBreakdown.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {modeBreakdown.map(([mode, total]) => (
                    <div key={mode} className="text-xs">
                      <span className="font-semibold" style={{ color: 'var(--color-purple)' }}>
                        {MODE_CONFIG[mode]?.label ?? mode}:
                      </span>{' '}
                      <span className="num" style={{ color: 'var(--color-ink)' }}>
                        {currency} {total.toFixed(2)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => exportCSV(reportRows, fromDate, toDate, currency)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-xs font-bold"
                style={{ background: '#fff', color: 'var(--color-purple)', border: '1.5px solid var(--color-purple)' }}
              >
                <FileSpreadsheet size={13} />
                Export CSV
              </button>
              <button
                onClick={() => {
                  const params = new URLSearchParams()
                  if (fromDate) params.set('from', fromDate)
                  if (toDate)   params.set('to', toDate)
                  window.open(`/print/payment-report?${params.toString()}`, '_blank')
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-xs font-bold"
                style={{ background: 'var(--color-purple)', color: '#fff' }}
              >
                <Printer size={13} />
                Print PDF
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Payment list */}
      {filtered.length === 0 ? (
        <div className="py-16 text-center rounded-[14px]" style={{ border: '1px dashed var(--color-border)' }}>
          <p className="font-semibold text-sm mb-3" style={{ color: 'var(--color-muted)' }}>
            {payments.length === 0 ? 'No payments recorded yet' : 'No payments match your search'}
          </p>
          {payments.length === 0 && (
            <button
              onClick={() => setShowModal(true)}
              className="px-4 py-2 rounded-[8px] text-sm font-semibold"
              style={{ background: 'var(--color-saffron)', color: '#fff' }}
            >
              + Record First Payment
            </button>
          )}
        </div>
      ) : (
        <div
          className="rounded-[14px] overflow-hidden"
          style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}
        >
          {filtered.map((pay, idx) => {
            const mCfg    = MODE_CONFIG[pay.mode] ?? MODE_CONFIG.other
            const isVoided = !!pay.voided_at
            const isVoiding = voidingId === pay.id

            return (
              <div
                key={pay.id}
                style={{
                  borderTop: idx > 0 ? '1px solid var(--color-border)' : undefined,
                  opacity: isVoided ? 0.55 : 1,
                }}
              >
                {/* Main row */}
                <div className="px-4 py-3.5 flex items-start gap-3">
                  {/* Mode badge (left column) */}
                  <div
                    className="flex-shrink-0 px-2 py-1 rounded-[7px] text-[10.5px] font-bold mt-0.5"
                    style={{ background: mCfg.bg, color: mCfg.color, minWidth: 72, textAlign: 'center' }}
                  >
                    {mCfg.label}
                  </div>

                  {/* Main info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-semibold text-sm" style={{ color: isVoided ? 'var(--color-muted)' : 'var(--color-ink)', textDecoration: isVoided ? 'line-through' : 'none' }}>
                          {pay.customers?.full_name ?? 'Unknown'}
                        </p>
                        <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
                          {pay.payment_number}
                          {pay.customers?.customer_code ? ` · ${pay.customers.customer_code}` : ''}
                          {' · '}
                          {fmtDate(pay.payment_date)}
                        </p>
                        {pay.reference_number && (
                          <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
                            Ref: {pay.reference_number}
                          </p>
                        )}
                        {pay.notes && (
                          <p className="text-xs mt-0.5 italic" style={{ color: 'var(--color-muted)' }}>
                            {pay.notes}
                          </p>
                        )}
                        {isVoided && (
                          <p className="text-xs mt-1 font-semibold" style={{ color: 'var(--color-red)' }}>
                            VOIDED · {pay.void_reason}
                          </p>
                        )}
                      </div>

                      {/* Amount + void button */}
                      <div className="text-right flex-shrink-0">
                        <p
                          className="font-display font-bold text-[18px] num"
                          style={{ color: isVoided ? 'var(--color-muted)' : 'var(--color-ink)', textDecoration: isVoided ? 'line-through' : 'none' }}
                        >
                          {currency} {parseFloat(String(pay.amount)).toFixed(2)}
                        </p>
                        {isOwner && !isVoided && !isVoiding && (
                          <button
                            onClick={() => { setVoidingId(pay.id); setVoidReason(''); setVoidError('') }}
                            className="text-[11px] font-semibold mt-1"
                            style={{ color: 'var(--color-red)' }}
                          >
                            Void
                          </button>
                        )}
                        {!isOwner && !isVoided && reqVoidId !== pay.id && (
                          <button
                            onClick={() => { setReqVoidId(pay.id); setReqVoidReason(''); setReqVoidError('') }}
                            className="text-[11px] font-semibold mt-1"
                            style={{ color: 'var(--color-muted)' }}
                          >
                            Request Void
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Inline request-void form (non-owner) */}
                {reqVoidId === pay.id && (
                  <div
                    className="mx-4 mb-4 rounded-[10px] p-3"
                    style={{ background: '#FFF7ED', border: '1px solid #FED7AA' }}
                  >
                    <p className="text-xs font-bold mb-2" style={{ color: '#C2410C' }}>
                      Request void approval — describe the reason:
                    </p>
                    <textarea
                      value={reqVoidReason}
                      onChange={e => setReqVoidReason(e.target.value)}
                      placeholder="Reason for void request…"
                      rows={2}
                      className="w-full rounded-[8px] px-2.5 py-2 text-xs resize-none focus:outline-none"
                      style={{ background: '#fff', border: '1px solid #FED7AA', color: 'var(--color-ink)' }}
                    />
                    {reqVoidError && (
                      <p className="text-xs font-semibold mt-1" style={{ color: 'var(--color-red)' }}>{reqVoidError}</p>
                    )}
                    <div className="flex gap-2 mt-2">
                      <button
                        onClick={() => { setReqVoidId(null); setReqVoidReason(''); setReqVoidError('') }}
                        className="flex-1 py-1.5 rounded-[7px] text-xs font-semibold"
                        style={{ background: '#fff', border: '1px solid var(--color-border)', color: 'var(--color-muted)' }}
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleRequestVoid}
                        disabled={reqVoidLoading || reqVoidReason.trim().length < 3}
                        className="flex-1 py-1.5 rounded-[7px] text-xs font-bold disabled:opacity-50"
                        style={{ background: '#C2410C', color: '#fff' }}
                      >
                        {reqVoidLoading ? 'Submitting…' : 'Submit Request'}
                      </button>
                    </div>
                  </div>
                )}

                {/* Inline void confirmation */}
                {isVoiding && (
                  <div
                    className="mx-4 mb-4 rounded-[10px] p-3"
                    style={{ background: 'var(--color-red-soft)', border: '1px solid #FECACA' }}
                  >
                    <div className="flex items-center gap-1.5 mb-2">
                      <AlertTriangle size={13} style={{ color: 'var(--color-red)' }} />
                      <p className="text-xs font-bold" style={{ color: 'var(--color-red)' }}>
                        Void this payment? This cannot be undone.
                      </p>
                    </div>
                    <textarea
                      value={voidReason}
                      onChange={e => setVoidReason(e.target.value)}
                      placeholder="Reason for voiding (required)…"
                      rows={2}
                      className="w-full rounded-[8px] px-2.5 py-2 text-xs resize-none focus:outline-none focus:ring-1 focus:ring-red"
                      style={{ background: '#fff', border: '1px solid #FECACA', color: 'var(--color-ink)' }}
                    />
                    {voidError && (
                      <p className="text-xs font-semibold mt-1" style={{ color: 'var(--color-red)' }}>{voidError}</p>
                    )}
                    <div className="flex gap-2 mt-2">
                      <button
                        onClick={() => { setVoidingId(null); setVoidReason(''); setVoidError('') }}
                        className="flex-1 py-1.5 rounded-[7px] text-xs font-semibold"
                        style={{ background: '#fff', border: '1px solid var(--color-border)', color: 'var(--color-muted)' }}
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleVoid}
                        disabled={voidLoading || voidReason.trim().length < 3}
                        className="flex-1 py-1.5 rounded-[7px] text-xs font-bold disabled:opacity-50"
                        style={{ background: 'var(--color-red)', color: '#fff' }}
                      >
                        {voidLoading ? 'Voiding…' : 'Confirm Void'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Record payment modal */}
      {showModal && (
        <RecordPaymentModal
          customers={customers}
          onClose={() => { setShowModal(false); router.refresh() }}
        />
      )}
    </div>
  )
}
