'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { updateDeliveryStatus } from '@/lib/deliveries/actions'

// ── Types ─────────────────────────────────────────────────────────────────────

type CustomerInfo = {
  id: string
  full_name: string
  customer_code: string
  area: string | null
  delivery_address: string | null
  delivery_instructions: string | null
  mobile_number: string
}

type DeliveryRecord = {
  id: string
  status: string
  skip_reason: string | null
  skip_note: string | null
  delivered_at: string | null
} | null

export type DeliveryEntry = {
  customer_id: string
  subscription_id: string
  customer: CustomerInfo
  plan_name: string
  meal_period: 'breakfast' | 'lunch' | 'dinner'
  delivery: DeliveryRecord
}

type DeliveriesModuleProps = {
  entries: DeliveryEntry[]
  selectedDate: string
  todayDubai: string
  canWrite: boolean
}

// ── Constants ─────────────────────────────────────────────────────────────────

const MEAL_LABELS: Record<string, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
}

const MEAL_PERIODS = ['breakfast', 'lunch', 'dinner'] as const

const STATUS_CONFIG: Record<string, { label: string; bg: string; color: string }> = {
  pending:           { label: 'Pending',          bg: '#F4EFEA',              color: '#7C7063' },
  out_for_delivery:  { label: 'Out for Delivery',  bg: 'var(--color-blue-soft)',  color: '#2C5E8F' },
  delivered:         { label: 'Delivered',         bg: 'var(--color-green-soft)', color: '#2E7D4F' },
  skipped:           { label: 'Skipped',           bg: '#FEF3C7',              color: '#B7860B' },
  failed:            { label: 'Failed',            bg: 'var(--color-red-soft)',   color: '#C0392B' },
}

const SKIP_REASONS: { value: string; label: string }[] = [
  { value: 'meal_not_ready',   label: 'Meal not ready' },
  { value: 'customer_absent',  label: 'Customer absent' },
  { value: 'address_issue',    label: 'Address issue' },
  { value: 'cancelled_today',  label: 'Cancelled today' },
  { value: 'other',            label: 'Other' },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function shiftDate(dateStr: string, days: number) {
  const d = new Date(dateStr + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function formatDisplayDate(dateStr: string) {
  return new Date(dateStr + 'T00:00:00Z').toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-[10.5px] font-bold whitespace-nowrap"
      style={{ background: cfg.bg, color: cfg.color }}
    >
      {cfg.label}
    </span>
  )
}

// ── Plan name badge ───────────────────────────────────────────────────────────

function PlanBadge({ name }: { name: string }) {
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap"
      style={{ background: 'var(--color-saffron-soft)', color: 'var(--color-ember)' }}
    >
      {name}
    </span>
  )
}

// ── Skip form (inline) ────────────────────────────────────────────────────────

function SkipForm({
  entry,
  selectedDate,
  onDone,
  onCancel,
}: {
  entry: DeliveryEntry
  selectedDate: string
  onDone: () => void
  onCancel: () => void
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [skipReason, setSkipReason] = useState('meal_not_ready')
  const [skipNote, setSkipNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  function handleConfirm() {
    setError(null)
    startTransition(async () => {
      const result = await updateDeliveryStatus({
        customer_id: entry.customer_id,
        subscription_id: entry.subscription_id,
        delivery_date: selectedDate,
        meal_period: entry.meal_period,
        status: 'skipped',
        skip_reason: skipReason,
        skip_note: skipNote.trim() || null,
      })
      if (result.error) {
        setError(result.error)
      } else {
        router.refresh()
        onDone()
      }
    })
  }

  return (
    <div
      className="mt-3 rounded-[10px] p-3 space-y-2"
      style={{ background: '#FEF3C7', border: '1px solid #F6D860' }}
    >
      <div>
        <label className="block text-xs font-semibold mb-1" style={{ color: '#B7860B' }}>
          Skip reason
        </label>
        <select
          value={skipReason}
          onChange={(e) => setSkipReason(e.target.value)}
          className="w-full rounded-[8px] px-2 py-1.5 text-sm"
          style={{
            border: '1px solid #E9C84E',
            background: '#FFFBEA',
            color: 'var(--color-ink)',
          }}
        >
          {SKIP_REASONS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-xs font-semibold mb-1" style={{ color: '#B7860B' }}>
          Note (optional)
        </label>
        <textarea
          value={skipNote}
          onChange={(e) => setSkipNote(e.target.value)}
          rows={2}
          placeholder="Add a note…"
          className="w-full rounded-[8px] px-2 py-1.5 text-sm resize-none"
          style={{
            border: '1px solid #E9C84E',
            background: '#FFFBEA',
            color: 'var(--color-ink)',
          }}
        />
      </div>
      {error && (
        <p className="text-xs font-semibold" style={{ color: 'var(--color-red)' }}>
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleConfirm}
          disabled={isPending}
          className="flex-1 py-1.5 rounded-[8px] text-xs font-bold text-white disabled:opacity-60"
          style={{ background: '#B7860B' }}
        >
          {isPending ? 'Saving…' : 'Confirm Skip'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={isPending}
          className="flex-1 py-1.5 rounded-[8px] text-xs font-bold disabled:opacity-60"
          style={{ background: 'var(--color-border)', color: 'var(--color-muted)' }}
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

// ── Delivery row card ─────────────────────────────────────────────────────────

function DeliveryCard({
  entry,
  selectedDate,
  canWrite,
}: {
  entry: DeliveryEntry
  selectedDate: string
  canWrite: boolean
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [showSkipForm, setShowSkipForm] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const status = entry.delivery?.status ?? 'pending'

  function callAction(
    newStatus: 'pending' | 'out_for_delivery' | 'delivered' | 'skipped' | 'failed',
    extraFields?: { skip_reason?: string | null; skip_note?: string | null }
  ) {
    setError(null)
    startTransition(async () => {
      const result = await updateDeliveryStatus({
        customer_id: entry.customer_id,
        subscription_id: entry.subscription_id,
        delivery_date: selectedDate,
        meal_period: entry.meal_period,
        status: newStatus,
        skip_reason: extraFields?.skip_reason ?? null,
        skip_note: extraFields?.skip_note ?? null,
      })
      if (result.error) setError(result.error)
      else router.refresh()
    })
  }

  const { customer } = entry

  return (
    <div
      className="rounded-[14px] p-4"
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        boxShadow: 'var(--shadow-card)',
      }}
    >
      {/* Top row: customer info + status badge */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className="font-display font-bold text-[15px] leading-snug"
              style={{ color: 'var(--color-ink)' }}
            >
              {customer.full_name}
            </span>
            <span
              className="num text-[11px] font-semibold"
              style={{ color: 'var(--color-muted)' }}
            >
              {customer.customer_code}
            </span>
            {customer.area && (
              <span
                className="text-[11px] font-medium"
                style={{ color: 'var(--color-muted)' }}
              >
                · {customer.area}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <PlanBadge name={entry.plan_name} />
            <StatusBadge status={status} />
          </div>
        </div>
      </div>

      {/* Delivery instructions */}
      {customer.delivery_instructions && (
        <p
          className="mt-2 text-xs font-medium rounded-[8px] px-2 py-1.5"
          style={{ background: 'var(--color-saffron-soft)', color: 'var(--color-ember)' }}
        >
          {customer.delivery_instructions}
        </p>
      )}

      {/* Skip reason display */}
      {status === 'skipped' && entry.delivery?.skip_reason && (
        <p className="mt-2 text-xs font-medium" style={{ color: '#B7860B' }}>
          Reason:{' '}
          {SKIP_REASONS.find((r) => r.value === entry.delivery!.skip_reason)?.label ??
            entry.delivery.skip_reason}
          {entry.delivery.skip_note && (
            <span className="ml-1 opacity-80">— {entry.delivery.skip_note}</span>
          )}
        </p>
      )}

      {/* Skip inline form */}
      {showSkipForm && (
        <SkipForm
          entry={entry}
          selectedDate={selectedDate}
          onDone={() => setShowSkipForm(false)}
          onCancel={() => setShowSkipForm(false)}
        />
      )}

      {/* Error */}
      {error && (
        <p className="mt-2 text-xs font-semibold" style={{ color: 'var(--color-red)' }}>
          {error}
        </p>
      )}

      {/* Action buttons */}
      {canWrite && !showSkipForm && (
        <div className="flex items-center gap-2 mt-3 flex-wrap">
          {(status === 'pending' || status === 'out_for_delivery') && (
            <>
              <button
                type="button"
                onClick={() => callAction('delivered')}
                disabled={isPending}
                className="px-3 py-1.5 rounded-[9px] text-xs font-bold text-white disabled:opacity-60 transition-opacity"
                style={{ background: '#2E7D4F' }}
              >
                {isPending ? 'Saving…' : '✓ Delivered'}
              </button>
              <button
                type="button"
                onClick={() => setShowSkipForm(true)}
                disabled={isPending}
                className="px-3 py-1.5 rounded-[9px] text-xs font-bold disabled:opacity-60 transition-opacity"
                style={{ background: '#FEF3C7', color: '#B7860B' }}
              >
                Skip
              </button>
            </>
          )}

          {status === 'delivered' && (
            <button
              type="button"
              onClick={() => callAction('pending')}
              disabled={isPending}
              className="px-3 py-1.5 rounded-[9px] text-xs font-bold disabled:opacity-60 transition-opacity"
              style={{ background: 'var(--color-border)', color: 'var(--color-muted)' }}
            >
              {isPending ? 'Saving…' : 'Undo'}
            </button>
          )}

          {status === 'skipped' && (
            <button
              type="button"
              onClick={() => callAction('pending', { skip_reason: null, skip_note: null })}
              disabled={isPending}
              className="px-3 py-1.5 rounded-[9px] text-xs font-bold disabled:opacity-60 transition-opacity"
              style={{ background: 'var(--color-border)', color: 'var(--color-muted)' }}
            >
              {isPending ? 'Saving…' : 'Undo'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ── Stat chip ─────────────────────────────────────────────────────────────────

function StatChip({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <div
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold"
      style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color }}
    >
      <span className="num">{count}</span>
      <span style={{ color: 'var(--color-muted)', fontWeight: 500 }}>{label}</span>
    </div>
  )
}

// ── Main module ───────────────────────────────────────────────────────────────

export function DeliveriesModule({
  entries,
  selectedDate,
  todayDubai,
  canWrite,
}: DeliveriesModuleProps) {
  const router = useRouter()

  function goToDate(date: string) {
    router.push(`/deliveries?date=${date}`)
  }

  // Summary counts
  const total = entries.length
  const delivered = entries.filter((e) => e.delivery?.status === 'delivered').length
  const skipped = entries.filter((e) => e.delivery?.status === 'skipped').length
  const pending = entries.filter(
    (e) => !e.delivery || e.delivery.status === 'pending' || e.delivery.status === 'out_for_delivery'
  ).length

  const isToday = selectedDate === todayDubai

  return (
    <div>
      {/* Page header */}
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--color-ink)' }}>
            Deliveries
          </h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--color-muted)' }}>
            {formatDisplayDate(selectedDate)}
            {isToday && (
              <span
                className="ml-2 px-1.5 py-0.5 rounded-full text-[10px] font-bold"
                style={{ background: 'var(--color-saffron-soft)', color: 'var(--color-ember)' }}
              >
                Today
              </span>
            )}
          </p>
        </div>
      </div>

      {/* Date navigation */}
      <div className="flex items-center gap-2 mb-4">
        <button
          type="button"
          onClick={() => goToDate(shiftDate(selectedDate, -1))}
          className="flex items-center justify-center w-8 h-8 rounded-[8px] text-sm font-bold transition-opacity"
          style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-muted)' }}
          aria-label="Previous day"
        >
          ←
        </button>

        <input
          type="date"
          value={selectedDate}
          onChange={(e) => {
            if (e.target.value) goToDate(e.target.value)
          }}
          className="rounded-[9px] px-3 py-1.5 text-sm font-semibold"
          style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            color: 'var(--color-ink)',
          }}
        />

        <button
          type="button"
          onClick={() => goToDate(shiftDate(selectedDate, 1))}
          className="flex items-center justify-center w-8 h-8 rounded-[8px] text-sm font-bold transition-opacity"
          style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-muted)' }}
          aria-label="Next day"
        >
          →
        </button>
      </div>

      {/* Summary bar */}
      <div className="flex items-center gap-2 flex-wrap mb-6">
        <StatChip label="Total" count={total} color="var(--color-ink)" />
        <StatChip label="Delivered" count={delivered} color="#2E7D4F" />
        <StatChip label="Pending" count={pending} color="#7C7063" />
        <StatChip label="Skipped" count={skipped} color="#B7860B" />
      </div>

      {/* Empty state */}
      {entries.length === 0 && (
        <div
          className="rounded-[14px] p-8 text-center"
          style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
          }}
        >
          <p className="font-semibold" style={{ color: 'var(--color-muted)' }}>
            No active subscriptions for this date.
          </p>
        </div>
      )}

      {/* Meal period sections */}
      <div className="space-y-8">
        {MEAL_PERIODS.map((period) => {
          const periodEntries = entries.filter((e) => e.meal_period === period)
          if (periodEntries.length === 0) return null

          return (
            <section key={period}>
              {/* Section heading */}
              <div className="flex items-center gap-2 mb-3">
                <h2
                  className="text-base font-bold"
                  style={{ color: 'var(--color-ink)' }}
                >
                  {MEAL_LABELS[period]}
                </h2>
                <span
                  className="num text-xs font-bold px-2 py-0.5 rounded-full"
                  style={{ background: 'var(--color-border)', color: 'var(--color-muted)' }}
                >
                  {periodEntries.length}
                </span>
              </div>

              {/* Entry cards */}
              <div className="space-y-3">
                {periodEntries.map((entry) => (
                  <DeliveryCard
                    key={`${entry.customer_id}|${entry.meal_period}`}
                    entry={entry}
                    selectedDate={selectedDate}
                    canWrite={canWrite}
                  />
                ))}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}
