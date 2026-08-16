'use client'

import { useState, useMemo, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { applySurplusReconciliation } from '@/lib/invoices/actions'
import { useAppSettings } from '@/components/settings/settings-context'
import type { SurplusCandidate } from '@/lib/invoices/reconcileSurplus'

// ── Status badge (mirrors invoices-module.tsx's STATUS_CONFIG) ─────────────────

const STATUS_STYLE: Record<string, { label: string; bg: string; color: string }> = {
  draft:  { label: 'Draft',  bg: 'var(--color-border)',     color: 'var(--color-muted)' },
  issued: { label: 'Issued', bg: 'var(--color-blue-soft)',  color: 'var(--color-blue)'  },
  paid:   { label: 'Paid',   bg: 'var(--color-green-soft)', color: 'var(--color-green)' },
}

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_STYLE[status] ?? STATUS_STYLE.draft
  return (
    <span
      className="text-[10px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap"
      style={{ background: cfg.bg, color: cfg.color }}
    >
      {cfg.label}
    </span>
  )
}

// ── Confirm dialog (mirrors BulkIssueConfirmDialog in invoices-module.tsx) ─────

function ApplyConfirmDialog({
  count,
  totalDiscount,
  currency,
  error,
  isPending,
  onClose,
  onConfirm,
}: {
  count: number
  totalDiscount: number
  currency: string
  error: string
  isPending: boolean
  onClose: () => void
  onConfirm: () => void
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: 'rgba(34,26,19,0.5)' }}
      onClick={(e) => { if (e.target === e.currentTarget && !isPending) onClose() }}
    >
      <div
        className="w-full max-w-[420px] rounded-[18px] p-5"
        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
      >
        <h3 className="font-bold text-[16px] mb-1" style={{ color: 'var(--color-ink)' }}>
          Apply reconciliation to {count} invoice{count !== 1 ? 's' : ''}?
        </h3>
        <p className="text-xs mb-4" style={{ color: 'var(--color-muted)' }}>
          This applies a total of {currency} {totalDiscount.toFixed(2)} in discounts, updates each
          invoice&apos;s status and ledger entry, and logs one audit trail record per invoice.
        </p>
        {error && (
          <p className="text-xs font-semibold mb-3" style={{ color: 'var(--color-red)' }}>
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className="flex-1 py-2 rounded-[10px] text-sm font-bold"
            style={{ background: 'var(--color-border)', color: 'var(--color-muted)' }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isPending}
            className="flex-1 py-2 rounded-[10px] text-sm font-bold transition-opacity"
            style={{ background: '#1A6B6B', color: '#fff', opacity: isPending ? 0.6 : 1 }}
          >
            {isPending ? 'Applying…' : `Apply to ${count}`}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main module ──────────────────────────────────────────────────────────────

export function ReconciliationModule({ candidates }: { candidates: SurplusCandidate[] }) {
  const router = useRouter()
  const { currency } = useAppSettings()
  const [selected, setSelected] = useState<Set<string>>(new Set(candidates.map(c => c.id)))
  const [showConfirm, setShowConfirm] = useState(false)
  const [error, setError] = useState('')
  const [resultSummary, setResultSummary] = useState<{ applied: number; skipped: number; flagged: number } | null>(null)
  const [isPending, startTransition] = useTransition()

  const selectedCandidates = useMemo(
    () => candidates.filter(c => selected.has(c.id)),
    [candidates, selected]
  )
  const totalDiscount = selectedCandidates.reduce((s, c) => s + c.new_discount_amount, 0)
  const totalNewDebit = selectedCandidates.reduce((s, c) => s + c.new_total_amount, 0)
  const paidCount = selectedCandidates.filter(c => c.new_status === 'paid').length
  const issuedCount = selectedCandidates.filter(c => c.new_status === 'issued').length

  function toggleAll() {
    setSelected(selected.size === candidates.length ? new Set() : new Set(candidates.map(c => c.id)))
  }
  function toggleOne(id: string) {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id); else next.add(id)
    setSelected(next)
  }

  function handleConfirm() {
    setError('')
    startTransition(async () => {
      const res = await applySurplusReconciliation([...selected])
      if (res.error) {
        setError(res.error)
        return
      }
      setResultSummary({
        applied: res.applied?.length ?? 0,
        skipped: res.skipped?.length ?? 0,
        flagged: res.flagged?.length ?? 0,
      })
      setShowConfirm(false)
      router.refresh()
    })
  }

  return (
    <div>
      {/* Page header */}
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <p
            className="text-xs font-bold uppercase tracking-widest"
            style={{ color: 'var(--color-saffron)', letterSpacing: '.12em' }}
          >
            Finance
          </p>
          <h1 className="font-display font-bold text-[25px] mt-0.5" style={{ color: 'var(--color-ink)' }}>
            Reconciliation
          </h1>
        </div>
      </div>

      {/* Explanation note — how to read this page */}
      <div
        className="flex items-start gap-2.5 px-4 py-3 rounded-[12px] mb-5 text-sm"
        style={{ background: '#FFF7ED', border: '1px solid #FED7AA', color: '#92400E' }}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 flex-shrink-0 mt-0.5" aria-hidden="true">
          <circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/>
        </svg>
        <p>
          Each row below is a draft or issued invoice whose customer has money paid historically
          that was never matched to any invoice — that surplus is money they don&apos;t actually owe
          again. <strong>Discount</strong> is the surplus applied to this invoice; <strong>New total</strong>{' '}
          is the real remaining balance. Rows going to AED 0.00 move to <strong>Paid</strong>; the rest
          move to <strong>Issued</strong> at the smaller, accurate total. Nothing is written until you
          review and click Apply below.
        </p>
      </div>

      {resultSummary && (
        <div
          className="px-4 py-3 rounded-[12px] mb-5 text-sm font-semibold"
          style={{ background: 'var(--color-green-soft)', border: '1px solid var(--color-green)', color: 'var(--color-green)' }}
        >
          Applied {resultSummary.applied} invoice{resultSummary.applied !== 1 ? 's' : ''}
          {resultSummary.skipped > 0 && `, skipped ${resultSummary.skipped} (no longer eligible)`}
          {resultSummary.flagged > 0 && `, flagged ${resultSummary.flagged} for manual review`}.
        </div>
      )}

      {candidates.length === 0 ? (
        <div className="py-16 text-center rounded-[14px]" style={{ border: '1px dashed var(--color-border)' }}>
          <p className="font-semibold text-sm" style={{ color: 'var(--color-muted)' }}>
            No invoices currently need reconciliation.
          </p>
        </div>
      ) : (
        <>
          {/* Summary + apply bar */}
          <div
            className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] px-4 py-3 mb-4"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
          >
            <p className="text-sm" style={{ color: 'var(--color-ink)' }}>
              <strong>{selectedCandidates.length}</strong> selected · {currency} {totalDiscount.toFixed(2)} discount ·{' '}
              {currency} {totalNewDebit.toFixed(2)} new ledger debit · {paidCount} → Paid, {issuedCount} → Issued
            </p>
            <button
              type="button"
              disabled={selectedCandidates.length === 0}
              onClick={() => { setError(''); setShowConfirm(true) }}
              className="px-4 py-2 rounded-[10px] text-sm font-bold transition-opacity"
              style={{
                background: '#1A6B6B',
                color: '#fff',
                opacity: selectedCandidates.length === 0 ? 0.5 : 1,
              }}
            >
              Apply Reconciliation
            </button>
          </div>

          {/* Table */}
          <div
            className="rounded-[14px] overflow-x-auto"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}
          >
            <table className="w-full text-sm min-w-[720px]">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <th className="text-left px-3 py-2.5">
                    <input type="checkbox" checked={selected.size === candidates.length} onChange={toggleAll} />
                  </th>
                  <th className="text-left px-3 py-2.5 text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>Customer</th>
                  <th className="text-left px-3 py-2.5 text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>Invoice</th>
                  <th className="text-left px-3 py-2.5 text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>Status</th>
                  <th className="text-right px-3 py-2.5 text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>Old total</th>
                  <th className="text-right px-3 py-2.5 text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>Discount</th>
                  <th className="text-right px-3 py-2.5 text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>New total</th>
                  <th className="text-left px-3 py-2.5 text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>New status</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((c, idx) => (
                  <tr key={c.id} style={{ borderTop: idx > 0 ? '1px solid var(--color-border)' : undefined }}>
                    <td className="px-3 py-2.5">
                      <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggleOne(c.id)} />
                    </td>
                    <td className="px-3 py-2.5 font-semibold" style={{ color: 'var(--color-ink)' }}>{c.customer_name}</td>
                    <td className="px-3 py-2.5 num" style={{ color: 'var(--color-ink)' }}>{c.invoice_number}</td>
                    <td className="px-3 py-2.5"><StatusBadge status={c.old_status} /></td>
                    <td className="px-3 py-2.5 text-right num" style={{ color: 'var(--color-muted)' }}>{c.old_total_amount.toFixed(2)}</td>
                    <td className="px-3 py-2.5 text-right num font-semibold" style={{ color: 'var(--color-green)' }}>−{c.new_discount_amount.toFixed(2)}</td>
                    <td className="px-3 py-2.5 text-right num font-semibold" style={{ color: 'var(--color-ink)' }}>{c.new_total_amount.toFixed(2)}</td>
                    <td className="px-3 py-2.5"><StatusBadge status={c.new_status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {showConfirm && (
        <ApplyConfirmDialog
          count={selectedCandidates.length}
          totalDiscount={totalDiscount}
          currency={currency}
          error={error}
          isPending={isPending}
          onClose={() => setShowConfirm(false)}
          onConfirm={handleConfirm}
        />
      )}
    </div>
  )
}
