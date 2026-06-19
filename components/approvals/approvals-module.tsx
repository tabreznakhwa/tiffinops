'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle, XCircle, Clock, AlertTriangle } from 'lucide-react'
import { approveRequest, rejectRequest } from '@/lib/approvals/actions'

// ── Types ──────────────────────────────────────────────────────────────────────

export type EnrichedRequest = {
  id: string
  request_type: 'delete' | 'edit'
  target_table: 'order' | 'payment' | 'invoice'
  target_id: string
  reason: string
  status: 'pending' | 'approved' | 'rejected'
  requested_at: string
  resolved_at: string | null
  resolution_note: string | null
  requestor_name: string
  resolver_name: string | null
  target_label: string
  target_customer: string
  target_date: string
}

export type ApprovalsModuleProps = {
  requests: EnrichedRequest[]
  pendingCount: number
  isOwnerOrManager: boolean
}

// ── Badge configs ──────────────────────────────────────────────────────────────

const REQUEST_TYPE_CONFIG = {
  delete: { label: 'DELETE', bg: 'var(--color-red-soft)',    color: 'var(--color-red)'    },
  edit:   { label: 'EDIT',   bg: '#FEF3C7',                  color: 'var(--color-gold)'   },
} as const

const TARGET_TABLE_CONFIG = {
  payment: { label: 'Payment', bg: 'var(--color-green-soft)',  color: 'var(--color-green)'  },
  order:   { label: 'Order',   bg: 'var(--color-blue-soft)',   color: 'var(--color-blue)'   },
  invoice: { label: 'Invoice', bg: 'var(--color-purple-soft)', color: 'var(--color-purple)' },
} as const

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtDatetime(iso: string) {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
    timeZone: 'Asia/Dubai',
  })
}

// ── Action Panel (Approve / Reject) ───────────────────────────────────────────

function ActionPanel({ id }: { id: string }) {
  const router = useRouter()
  const [mode, setMode] = useState<'idle' | 'approving' | 'rejecting'>('idle')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()

  function reset() {
    setMode('idle')
    setNote('')
    setError('')
  }

  function handleApprove() {
    setError('')
    startTransition(async () => {
      const result = await approveRequest(id, note)
      if (result.error) { setError(result.error); return }
      reset()
      router.refresh()
    })
  }

  function handleReject() {
    if (!note.trim()) { setError('Please provide a reason for rejection'); return }
    setError('')
    startTransition(async () => {
      const result = await rejectRequest(id, note)
      if (result.error) { setError(result.error); return }
      reset()
      router.refresh()
    })
  }

  if (mode === 'idle') {
    return (
      <div className="flex gap-2 flex-shrink-0">
        <button
          onClick={() => { setMode('rejecting'); setNote(''); setError('') }}
          className="px-3 py-1.5 rounded-[8px] text-xs font-bold"
          style={{ background: 'var(--color-red-soft)', color: 'var(--color-red)', border: '1px solid #FECACA' }}
        >
          Reject
        </button>
        <button
          onClick={() => { setMode('approving'); setNote(''); setError('') }}
          className="px-3 py-1.5 rounded-[8px] text-xs font-bold"
          style={{ background: 'var(--color-green-soft)', color: 'var(--color-green)', border: '1px solid #A7F3D0' }}
        >
          Approve
        </button>
      </div>
    )
  }

  const isApproving = mode === 'approving'

  return (
    <div
      className="mt-3 rounded-[10px] p-3"
      style={{
        background: isApproving ? 'var(--color-green-soft)' : 'var(--color-red-soft)',
        border: `1px solid ${isApproving ? '#A7F3D0' : '#FECACA'}`,
      }}
    >
      <div className="flex items-center gap-1.5 mb-2">
        <AlertTriangle size={13} style={{ color: isApproving ? 'var(--color-green)' : 'var(--color-red)' }} />
        <p className="text-xs font-bold" style={{ color: isApproving ? 'var(--color-green)' : 'var(--color-red)' }}>
          {isApproving
            ? 'Approve this request? This will execute the action immediately.'
            : 'Reject this request? Please provide a reason.'}
        </p>
      </div>
      <textarea
        value={note}
        onChange={e => setNote(e.target.value)}
        placeholder={isApproving ? 'Optional note…' : 'Reason for rejection (required)…'}
        rows={2}
        className="w-full rounded-[8px] px-2.5 py-2 text-xs resize-none focus:outline-none focus:ring-1"
        style={{
          background: '#fff',
          border: `1px solid ${isApproving ? '#A7F3D0' : '#FECACA'}`,
          color: 'var(--color-ink)',
        }}
      />
      {error && (
        <p className="text-xs font-semibold mt-1" style={{ color: 'var(--color-red)' }}>{error}</p>
      )}
      <div className="flex gap-2 mt-2">
        <button
          onClick={reset}
          disabled={isPending}
          className="flex-1 py-1.5 rounded-[7px] text-xs font-semibold disabled:opacity-50"
          style={{ background: '#fff', border: '1px solid var(--color-border)', color: 'var(--color-muted)' }}
        >
          Cancel
        </button>
        <button
          onClick={isApproving ? handleApprove : handleReject}
          disabled={isPending || (!isApproving && !note.trim())}
          className="flex-1 py-1.5 rounded-[7px] text-xs font-bold disabled:opacity-50"
          style={{
            background: isApproving ? 'var(--color-green)' : 'var(--color-red)',
            color: '#fff',
          }}
        >
          {isPending
            ? isApproving ? 'Approving…' : 'Rejecting…'
            : isApproving ? 'Confirm Approve' : 'Confirm Reject'}
        </button>
      </div>
    </div>
  )
}

// ── Request Card ───────────────────────────────────────────────────────────────

function RequestCard({
  req,
  isOwnerOrManager,
}: {
  req: EnrichedRequest
  isOwnerOrManager: boolean
}) {
  const rtCfg  = REQUEST_TYPE_CONFIG[req.request_type]
  const tblCfg = TARGET_TABLE_CONFIG[req.target_table]

  return (
    <div
      className="rounded-[14px] p-4"
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        boxShadow: 'var(--shadow-card)',
      }}
    >
      <div className="flex items-start gap-3">
        {/* Left: type badges */}
        <div className="flex flex-col gap-1.5 flex-shrink-0 pt-0.5">
          <span
            className="px-2 py-0.5 rounded-[6px] text-[10.5px] font-bold text-center"
            style={{ background: rtCfg.bg, color: rtCfg.color, minWidth: 56 }}
          >
            {rtCfg.label}
          </span>
          <span
            className="px-2 py-0.5 rounded-[6px] text-[10.5px] font-bold text-center"
            style={{ background: tblCfg.bg, color: tblCfg.color, minWidth: 56 }}
          >
            {tblCfg.label}
          </span>
        </div>

        {/* Middle: details */}
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm leading-tight" style={{ color: 'var(--color-ink)' }}>
            {req.target_label}
          </p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
            {req.target_customer}
            {req.target_date !== '—' && ` · ${req.target_date}`}
          </p>

          <p
            className="text-xs mt-2 px-2.5 py-1.5 rounded-[8px] italic"
            style={{ background: 'var(--color-border)', color: 'var(--color-ink)' }}
          >
            {req.reason}
          </p>

          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5">
            <p className="text-[11px]" style={{ color: 'var(--color-muted)' }}>
              <span className="font-bold uppercase tracking-wide" style={{ fontSize: 10 }}>Requested by</span>{' '}
              {req.requestor_name} · {fmtDatetime(req.requested_at)}
            </p>

            {req.resolved_at && req.resolver_name && (
              <p className="text-[11px]" style={{ color: 'var(--color-muted)' }}>
                <span className="font-bold uppercase tracking-wide" style={{ fontSize: 10 }}>
                  {req.status === 'approved' ? 'Approved by' : 'Rejected by'}
                </span>{' '}
                {req.resolver_name} · {fmtDatetime(req.resolved_at)}
              </p>
            )}
          </div>

          {req.resolution_note && (
            <p className="text-xs mt-1.5 italic" style={{ color: 'var(--color-muted)' }}>
              Note: {req.resolution_note}
            </p>
          )}

          {/* Action panel — inline, shown below the details */}
          {req.status === 'pending' && isOwnerOrManager && (
            <div className="mt-3">
              <ActionPanel id={req.id} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Empty State ────────────────────────────────────────────────────────────────

function EmptyState({ tab }: { tab: string }) {
  const messages: Record<string, string> = {
    pending:  'No pending approval requests',
    approved: 'No approved requests yet',
    rejected: 'No rejected requests yet',
  }
  return (
    <div className="py-16 text-center rounded-[14px]" style={{ border: '1px dashed var(--color-border)' }}>
      <p className="font-semibold text-sm" style={{ color: 'var(--color-muted)' }}>
        {messages[tab] ?? 'Nothing here'}
      </p>
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────

type Tab = 'pending' | 'approved' | 'rejected'

export function ApprovalsModule({
  requests,
  pendingCount,
  isOwnerOrManager,
}: ApprovalsModuleProps) {
  const [activeTab, setActiveTab] = useState<Tab>('pending')

  const pending  = requests.filter(r => r.status === 'pending')
  const approved = requests.filter(r => r.status === 'approved')
  const rejected = requests.filter(r => r.status === 'rejected')

  const tabs: { key: Tab; label: string; count: number; icon: React.ReactNode }[] = [
    {
      key: 'pending',
      label: 'Pending',
      count: pending.length,
      icon: <Clock size={13} />,
    },
    {
      key: 'approved',
      label: 'Approved',
      count: approved.length,
      icon: <CheckCircle size={13} />,
    },
    {
      key: 'rejected',
      label: 'Rejected',
      count: rejected.length,
      icon: <XCircle size={13} />,
    },
  ]

  const activeList = activeTab === 'pending' ? pending : activeTab === 'approved' ? approved : rejected

  return (
    <div>
      {/* Page header */}
      <div className="mb-5">
        <p
          className="text-xs font-bold uppercase tracking-widest"
          style={{ color: 'var(--color-saffron)', letterSpacing: '.12em' }}
        >
          Approvals
        </p>
        <h1
          className="font-display font-bold text-[25px] mt-0.5"
          style={{ color: 'var(--color-ink)' }}
        >
          Approval Requests
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--color-muted)' }}>
          {pendingCount === 0
            ? 'No pending requests'
            : `${pendingCount} pending request${pendingCount !== 1 ? 's' : ''} awaiting review`}
        </p>
      </div>

      {/* Tabs */}
      <div
        className="flex gap-1 p-1 rounded-[12px] mb-5"
        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
      >
        {tabs.map(tab => {
          const isActive = activeTab === tab.key
          const activeColors: Record<Tab, { bg: string; color: string }> = {
            pending:  { bg: '#FEF3C7',                  color: 'var(--color-gold)'  },
            approved: { bg: 'var(--color-green-soft)',  color: 'var(--color-green)' },
            rejected: { bg: 'var(--color-red-soft)',    color: 'var(--color-red)'   },
          }
          const ac = activeColors[tab.key]
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className="flex items-center gap-1.5 flex-1 justify-center px-3 py-2 rounded-[9px] text-xs font-semibold transition-colors"
              style={{
                background: isActive ? ac.bg : 'transparent',
                color: isActive ? ac.color : 'var(--color-muted)',
              }}
            >
              {tab.icon}
              {tab.label}
              {tab.count > 0 && (
                <span
                  className="inline-flex items-center justify-center rounded-full text-[10px] font-bold px-1.5 min-w-[18px] h-[18px]"
                  style={{
                    background: isActive ? ac.color : 'var(--color-border)',
                    color: isActive ? '#fff' : 'var(--color-muted)',
                  }}
                >
                  {tab.count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Request list */}
      {activeList.length === 0 ? (
        <EmptyState tab={activeTab} />
      ) : (
        <div className="flex flex-col gap-3">
          {activeList.map(req => (
            <RequestCard
              key={req.id}
              req={req}
              isOwnerOrManager={isOwnerOrManager}
            />
          ))}
        </div>
      )}
    </div>
  )
}
