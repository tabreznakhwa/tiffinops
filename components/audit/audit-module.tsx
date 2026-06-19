'use client'

import { useState, useMemo, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useAppSettings } from '@/components/settings/settings-context'

// ── Types ─────────────────────────────────────────────────────────────────────

export type AuditLog = {
  id: number
  user_id: string | null
  action: string
  table_name: string | null
  record_id: string | null
  old_value: Record<string, unknown> | null
  new_value: Record<string, unknown> | null
  ip_address: string | null
  created_at: string
}

export type User = {
  id: string
  full_name: string
  email: string
}

// ── Constants ─────────────────────────────────────────────────────────────────

const TABLE_LABELS: Record<string, string> = {
  customers:              'Customer',
  orders:                 'Order',
  payments:               'Payment',
  invoices:               'Invoice',
  customer_subscriptions: 'Subscription',
}

const TABLE_OPTIONS = [
  { value: '',                       label: 'All Tables'     },
  { value: 'customers',              label: 'Customers'      },
  { value: 'orders',                 label: 'Orders'         },
  { value: 'payments',               label: 'Payments'       },
  { value: 'invoices',               label: 'Invoices'       },
  { value: 'customer_subscriptions', label: 'Subscriptions'  },
]

const ACTION_OPTIONS = [
  { value: '',        label: 'All Actions' },
  { value: 'INSERT',  label: 'Insert'      },
  { value: 'UPDATE',  label: 'Update'      },
  { value: 'DELETE',  label: 'Delete'      },
]

// Fields to extract per table (ordered by priority)
const TABLE_KEY_FIELDS: Record<string, string[]> = {
  customers:              ['full_name', 'status', 'mobile_number'],
  orders:                 ['order_number', 'order_status', 'total_amount', 'meal_period'],
  payments:               ['payment_number', 'amount', 'mode', 'voided_at'],
  invoices:               ['invoice_number', 'status', 'total_amount'],
  customer_subscriptions: ['status', 'agreed_monthly_price'],
}

// User-identity fields embedded in the JSON rows (in priority order)
const WHO_FIELDS = ['created_by', 'received_by', 'voided_by', 'updated_by']

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDubai(ts: string): string {
  return new Date(ts).toLocaleString('en-GB', {
    timeZone: 'Asia/Dubai',
    day:    'numeric',
    month:  'short',
    year:   'numeric',
    hour:   '2-digit',
    minute: '2-digit',
  })
}

function shortId(id: string | null): string {
  if (!id) return '—'
  return id.length > 12 ? id.slice(0, 8) + '…' : id
}

function getWhoId(row: Record<string, unknown> | null): string | null {
  if (!row) return null
  for (const field of WHO_FIELDS) {
    if (row[field] && typeof row[field] === 'string') return row[field] as string
  }
  return null
}

function formatFieldValue(key: string, val: unknown, currency: string): string {
  if (val === null || val === undefined) return '—'
  if (key === 'total_amount' || key === 'amount' || key === 'agreed_monthly_price') {
    const n = parseFloat(String(val))
    return isNaN(n) ? String(val) : `${currency} ${n.toFixed(2)}`
  }
  if (key === 'voided_at' && val) return 'VOIDED'
  if (typeof val === 'boolean') return val ? 'Yes' : 'No'
  return String(val)
}

function humanFieldName(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
}

// ── Changes summary ───────────────────────────────────────────────────────────

type ChangeItem = { key: string; label: string; oldVal?: string; newVal?: string; val?: string }

function getChanges(log: AuditLog, currency: string): ChangeItem[] {
  const table  = log.table_name ?? ''
  const fields = TABLE_KEY_FIELDS[table] ?? []
  const old    = log.old_value
  const nxt    = log.new_value

  if (log.action === 'UPDATE') {
    const changes: ChangeItem[] = []
    for (const key of fields) {
      const oldV = old?.[key]
      const newV = nxt?.[key]
      // Compare as strings to catch type coercion quirks
      if (String(oldV ?? '') !== String(newV ?? '')) {
        changes.push({
          key,
          label:  humanFieldName(key),
          oldVal: formatFieldValue(key, oldV, currency),
          newVal: formatFieldValue(key, newV, currency),
        })
      }
    }
    return changes.slice(0, 4)
  }

  const source = log.action === 'DELETE' ? old : nxt
  if (!source) return []

  return fields
    .filter(key => source[key] !== null && source[key] !== undefined)
    .slice(0, 4)
    .map(key => ({
      key,
      label: humanFieldName(key),
      val:   formatFieldValue(key, source[key], currency),
    }))
}

// ── Action badge ──────────────────────────────────────────────────────────────

const ACTION_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  INSERT: { bg: '#D1FAE5', color: '#2E7D4F', label: 'INSERT' },
  UPDATE: { bg: '#FEF3C7', color: '#B7860B', label: 'UPDATE' },
  DELETE: { bg: '#FEE2E2', color: '#C0392B', label: 'DELETE' },
}

function ActionBadge({ action }: { action: string }) {
  const cfg = ACTION_STYLE[action] ?? { bg: '#F3F4F6', color: '#7C7063', label: action }
  return (
    <span
      className="inline-block px-2 py-0.5 rounded-[6px] text-[10.5px] font-bold tracking-wide"
      style={{ background: cfg.bg, color: cfg.color }}
    >
      {cfg.label}
    </span>
  )
}

function TableBadge({ table }: { table: string | null }) {
  if (!table) return null
  const label = TABLE_LABELS[table] ?? table
  return (
    <span
      className="inline-block px-2 py-0.5 rounded-[6px] text-[10.5px] font-semibold"
      style={{ background: 'var(--color-border)', color: 'var(--color-muted)' }}
    >
      {label}
    </span>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function AuditModule({
  logs,
  users,
  filters,
}: {
  logs: AuditLog[]
  users: User[]
  filters: { table?: string; action?: string; from?: string; to?: string }
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const { currency } = useAppSettings()

  // Local filter state (mirrors URL)
  const [tableVal,  setTableVal]  = useState(filters.table  ?? '')
  const [actionVal, setActionVal] = useState(filters.action ?? '')
  const [fromVal,   setFromVal]   = useState(filters.from   ?? '')
  const [toVal,     setToVal]     = useState(filters.to     ?? '')

  // Users lookup map
  const userMap = useMemo<Map<string, User>>(() => {
    const m = new Map<string, User>()
    for (const u of users) m.set(u.id, u)
    return m
  }, [users])

  // Stats
  const totalCount   = logs.length
  const insertCount  = logs.filter(l => l.action === 'INSERT').length
  const updateCount  = logs.filter(l => l.action === 'UPDATE').length
  const deleteCount  = logs.filter(l => l.action === 'DELETE').length

  function applyFilters() {
    const params = new URLSearchParams()
    if (tableVal)  params.set('table',  tableVal)
    if (actionVal) params.set('action', actionVal)
    if (fromVal)   params.set('from',   fromVal)
    if (toVal)     params.set('to',     toVal)
    startTransition(() => {
      router.push(`/audit-trail?${params.toString()}`)
    })
  }

  function clearFilters() {
    setTableVal('')
    setActionVal('')
    setFromVal('')
    setToVal('')
    startTransition(() => {
      router.push('/audit-trail')
    })
  }

  const hasActiveFilters = !!(
    (filters.table  && filters.table  !== '') ||
    (filters.action && filters.action !== '') ||
    filters.from ||
    filters.to
  )

  return (
    <div>
      {/* Page header */}
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <p
            className="text-xs font-bold uppercase tracking-widest"
            style={{ color: 'var(--color-saffron)', letterSpacing: '.12em' }}
          >
            System
          </p>
          <h1
            className="font-display font-bold text-[25px] mt-0.5"
            style={{ color: 'var(--color-ink)' }}
          >
            Audit Trail
          </h1>
        </div>
      </div>

      {/* Info note */}
      <div
        className="flex items-start gap-2.5 px-4 py-3 rounded-[12px] mb-5 text-sm"
        style={{ background: '#FFF7ED', border: '1px solid #FED7AA', color: '#92400E' }}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="w-4 h-4 flex-shrink-0 mt-0.5"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9"/>
          <path d="M12 8v4M12 16h.01"/>
        </svg>
        <p>
          Audit logs are generated automatically for all key business operations.
          Showing up to 200 records per query.
        </p>
      </div>

      {/* Filter bar */}
      <div
        className="rounded-[14px] px-4 py-3 mb-5"
        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
      >
        <div className="flex flex-wrap gap-2 items-end">
          {/* Date range */}
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>
              From
            </label>
            <input
              type="date"
              value={fromVal}
              onChange={e => setFromVal(e.target.value)}
              className="rounded-[8px] px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1"
              style={{
                background: 'var(--color-cream)',
                border: '1px solid var(--color-border)',
                color: 'var(--color-ink)',
              }}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>
              To
            </label>
            <input
              type="date"
              value={toVal}
              onChange={e => setToVal(e.target.value)}
              className="rounded-[8px] px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1"
              style={{
                background: 'var(--color-cream)',
                border: '1px solid var(--color-border)',
                color: 'var(--color-ink)',
              }}
            />
          </div>

          {/* Table filter */}
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>
              Table
            </label>
            <select
              value={tableVal}
              onChange={e => setTableVal(e.target.value)}
              className="rounded-[8px] px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1"
              style={{
                background: 'var(--color-cream)',
                border: '1px solid var(--color-border)',
                color: 'var(--color-ink)',
              }}
            >
              {TABLE_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          {/* Action filter */}
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>
              Action
            </label>
            <select
              value={actionVal}
              onChange={e => setActionVal(e.target.value)}
              className="rounded-[8px] px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1"
              style={{
                background: 'var(--color-cream)',
                border: '1px solid var(--color-border)',
                color: 'var(--color-ink)',
              }}
            >
              {ACTION_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          {/* Buttons */}
          <div className="flex gap-2 items-center">
            <button
              onClick={applyFilters}
              disabled={isPending}
              className="px-3 py-1.5 rounded-[8px] text-xs font-bold disabled:opacity-50"
              style={{ background: 'var(--color-saffron)', color: '#fff' }}
            >
              {isPending ? 'Loading…' : 'Apply'}
            </button>
            {hasActiveFilters && (
              <button
                onClick={clearFilters}
                disabled={isPending}
                className="px-3 py-1.5 rounded-[8px] text-xs font-semibold disabled:opacity-50"
                style={{ background: 'var(--color-border)', color: 'var(--color-muted)' }}
              >
                Clear
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Stats bar */}
      <div
        className="flex flex-wrap items-center gap-4 px-4 py-3 rounded-[12px] mb-5"
        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
      >
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>
            Total
          </p>
          <p className="font-display font-bold text-[20px] num" style={{ color: 'var(--color-ink)' }}>
            {totalCount}
          </p>
        </div>
        <div className="w-px self-stretch" style={{ background: 'var(--color-border)' }} />
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>
            Inserts
          </p>
          <p className="font-display font-bold text-[20px] num" style={{ color: '#2E7D4F' }}>
            {insertCount}
          </p>
        </div>
        <div className="w-px self-stretch" style={{ background: 'var(--color-border)' }} />
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>
            Updates
          </p>
          <p className="font-display font-bold text-[20px] num" style={{ color: '#B7860B' }}>
            {updateCount}
          </p>
        </div>
        <div className="w-px self-stretch" style={{ background: 'var(--color-border)' }} />
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>
            Deletes
          </p>
          <p className="font-display font-bold text-[20px] num" style={{ color: '#C0392B' }}>
            {deleteCount}
          </p>
        </div>
      </div>

      {/* Log list */}
      {logs.length === 0 ? (
        <div
          className="py-16 text-center rounded-[14px]"
          style={{ border: '1px dashed var(--color-border)' }}
        >
          <p className="font-semibold text-sm" style={{ color: 'var(--color-muted)' }}>
            No audit logs found for the selected filters.
          </p>
        </div>
      ) : (
        <div
          className="rounded-[14px] overflow-hidden"
          style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            boxShadow: 'var(--shadow-card)',
          }}
        >
          {logs.map((log, idx) => {
            const changes = getChanges(log, currency)
            const whoId   = getWhoId(log.new_value) ?? getWhoId(log.old_value)
            const who     = whoId ? userMap.get(whoId) : null

            return (
              <div
                key={log.id}
                style={{ borderTop: idx > 0 ? '1px solid var(--color-border)' : undefined }}
              >
                <div className="px-4 py-3.5">
                  {/* Top row: timestamp + badges */}
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    {/* Timestamp */}
                    <span
                      className="text-[12px] font-semibold num flex-shrink-0"
                      style={{ color: 'var(--color-ink)' }}
                    >
                      {fmtDubai(log.created_at)}
                    </span>

                    {/* Action badge */}
                    <ActionBadge action={log.action} />

                    {/* Table badge */}
                    <TableBadge table={log.table_name} />

                    {/* Record ID */}
                    {log.record_id && (
                      <span
                        className="text-[11px] font-mono px-1.5 py-0.5 rounded-[5px]"
                        style={{
                          background: 'var(--color-cream)',
                          color: 'var(--color-muted)',
                          border: '1px solid var(--color-border)',
                        }}
                        title={log.record_id}
                      >
                        {shortId(log.record_id)}
                      </span>
                    )}

                    {/* Who made the change */}
                    {who && (
                      <span
                        className="ml-auto text-[11px] font-semibold flex-shrink-0"
                        style={{ color: 'var(--color-blue)' }}
                      >
                        {who.full_name}
                      </span>
                    )}
                  </div>

                  {/* Changes summary */}
                  {changes.length > 0 ? (
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                      {changes.map(c => (
                        <div key={c.key} className="text-xs">
                          <span
                            className="font-semibold"
                            style={{ color: 'var(--color-muted)' }}
                          >
                            {c.label}:{' '}
                          </span>
                          {log.action === 'UPDATE' ? (
                            <>
                              <span
                                className="line-through"
                                style={{ color: '#C0392B' }}
                              >
                                {c.oldVal}
                              </span>
                              <span style={{ color: 'var(--color-muted)' }}> → </span>
                              <span
                                className="font-semibold"
                                style={{ color: '#2E7D4F' }}
                              >
                                {c.newVal}
                              </span>
                            </>
                          ) : (
                            <span style={{ color: 'var(--color-ink)' }}>
                              {c.val}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                      No key field changes detected.
                    </p>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
