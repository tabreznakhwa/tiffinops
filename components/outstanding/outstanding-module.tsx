'use client'

import { useState, useMemo, useTransition } from 'react'
import { Search, Pencil, Check, X, HandCoins, MessageCircle, BadgePercent } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { DatePresetPicker } from '@/components/ui/date-preset-picker'
import { AreaFilter, collectAreas, matchesArea } from '@/components/ui/area-filter'
import { updateSubscriptionStartDate, updateSubscriptionPauseDate } from '@/lib/fixed-menu/actions'
import { createBalanceAdjustment } from '@/lib/adjustments/actions'
import { RecordPaymentModal } from '@/components/payments/record-payment-modal'

// One fully-computed table row. All aggregation happens on the server so the
// browser never receives raw order or payment rows.
export type OutstandingRow = {
  id:            string
  full_name:     string
  customer_code: string
  customer_type: string
  payment_terms: string
  mobile_number: string
  area:          string | null
  orderBilled:   number
  subCharge:     number
  fixedDiscount: number
  totalBilled:   number
  totalPaid:     number
  adjustmentTotal: number
  outstanding:   number
  monthlyRate:   number
  subPaused:     boolean
  subId:         string | null
  subStartDate:  string | null
  subEndDate:    string | null
  nextDueDate:   string | null
  nextDueInDays: number | null
  lastPaymentDate:    string | null
  lastPaymentAmount:  number | null
  outstandingSince:   string | null
  daysOutstanding:    number | null
  daysSinceLastPayment: number | null
}

const TYPE_LABELS: Record<string, string> = {
  a_la_carte: 'A La Carte',
  fixed_menu:  'Fixed Menu',
  hybrid:      'Hybrid',
}
const TYPE_COLORS: Record<string, { bg: string; color: string }> = {
  a_la_carte: { bg: 'var(--color-saffron-soft)',        color: 'var(--color-saffron)'         },
  fixed_menu:  { bg: 'var(--color-blue-soft, #EFF6FF)', color: 'var(--color-blue, #2563EB)'   },
  hybrid:      { bg: 'var(--color-purple-soft, #F5F3FF)', color: 'var(--color-purple, #7C3AED)' },
}

interface Props {
  rows:           OutstandingRow[]
  totalCustomers: number
  currency:       string
  userRole:       string
  rangeFrom:      string
  rangeTo:        string
}

// ── Due-flag logic ───────────────────────────────────────────────────────────
// One glanceable traffic light per owing customer, decided by the strongest
// signal available (checked top to bottom — first match wins):
//
//   🔴 OVERDUE  — prepaid due date has passed, OR owes 2+ months of their
//                 plan rate, OR any debt older than 30 days.
//   🟠 DUE SOON — prepaid payment due within the next 7 days, OR ~1 month
//                 of the plan owing, OR debt older than 15 days.
//   🟢 ON TRACK — has a balance, but comfortably within terms.
//
// Each flag carries a plain-English reason ("Payment overdue 6d",
// "Owes 2.5 months", "Due in 3d") so anyone can see WHY at a glance.

export type FlagLevel = 'overdue' | 'due_soon' | 'on_track'

const FLAG_META: Record<FlagLevel, { label: string; rank: number; bg: string; color: string; dot: string }> = {
  overdue:  { label: 'Overdue',  rank: 2, bg: '#FEE2E2', color: '#991B1B', dot: '#DC2626' },
  due_soon: { label: 'Due Soon', rank: 1, bg: '#FEF3C7', color: '#92400E', dot: '#F59E0B' },
  on_track: { label: 'On Track', rank: 0, bg: '#DCFCE7', color: '#166534', dot: '#22C55E' },
}

function computeDueFlag(row: OutstandingRow): { level: FlagLevel; reason: string } {
  // "Months owed" translates the balance into plan-months — the most natural
  // unit for a tiffin subscription ("he owes 2 months" beats any number).
  const monthsOwed = row.monthlyRate > 0 ? row.outstanding / row.monthlyRate : null

  // Red — needs follow-up now
  if (row.nextDueInDays != null && row.nextDueInDays < 0) {
    return { level: 'overdue', reason: `Payment overdue ${Math.abs(row.nextDueInDays)}d` }
  }
  if (monthsOwed != null && monthsOwed >= 2) {
    return { level: 'overdue', reason: `Owes ${monthsOwed.toFixed(1)} months` }
  }
  if ((row.daysOutstanding ?? 0) > 30) {
    return { level: 'overdue', reason: `Unpaid ${row.daysOutstanding}d` }
  }

  // Amber — follow up this week
  if (row.nextDueInDays != null && row.nextDueInDays <= 7) {
    return { level: 'due_soon', reason: row.nextDueInDays === 0 ? 'Due today' : `Due in ${row.nextDueInDays}d` }
  }
  if (monthsOwed != null && monthsOwed >= 1) {
    return { level: 'due_soon', reason: `Owes ${monthsOwed.toFixed(1)} month${monthsOwed >= 1.05 ? 's' : ''}` }
  }
  if ((row.daysOutstanding ?? 0) >= 15) {
    return { level: 'due_soon', reason: `Unpaid ${row.daysOutstanding}d` }
  }

  return { level: 'on_track', reason: 'Within terms' }
}

type DateEdit = { subId: string; field: 'start' | 'end'; value: string; customerId: string }
type ViewMode = 'owing' | 'credit'

function fmtDateShort(d: string) {
  return new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

// wa.me link with a prefilled outstanding-balance reminder. UAE numbers:
// local 05x… → 9715x…, bare 5x… (9 digits) → 9715x…, 00-prefixed → stripped.
function whatsAppReminderLink(row: OutstandingRow, currency: string): string | null {
  let digits = (row.mobile_number ?? '').replace(/\D/g, '')
  if (!digits) return null
  if (digits.startsWith('00')) digits = digits.slice(2)
  else if (digits.startsWith('0')) digits = '971' + digits.slice(1)
  else if (digits.length === 9 && digits.startsWith('5')) digits = '971' + digits
  const msg =
    `Hi ${row.full_name}, a friendly reminder — your outstanding balance with us is ` +
    `${currency} ${row.outstanding.toFixed(2)}. Kindly arrange the payment at your convenience. Thank you!`
  return `https://wa.me/${digits}?text=${encodeURIComponent(msg)}`
}

// ── Settle / discount dialog ─────────────────────────────────────────────────
// Wipes a residual balance with a proper discount/write-off record instead of
// a fake payment. Amount prefills to the full outstanding so one click
// settles the account; a reason is always required for the audit trail.

function SettleDialog({
  row,
  currency,
  onClose,
  onDone,
}: {
  row: OutstandingRow
  currency: string
  onClose: () => void
  onDone: () => void
}) {
  const [amount, setAmount]   = useState(row.outstanding > 0 ? row.outstanding.toFixed(2) : '')
  const [type, setType]       = useState<'discount' | 'write_off'>('discount')
  const [reason, setReason]   = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')

  const amountNum = parseFloat(amount)
  const fullSettle = !isNaN(amountNum) && Math.abs(amountNum - row.outstanding) < 0.005
  const canSubmit = !loading && !isNaN(amountNum) && amountNum > 0 && reason.trim().length >= 3

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setError('')
    setLoading(true)
    const result = await createBalanceAdjustment({
      customer_id:     row.id,
      amount:          amountNum,
      adjustment_type: type,
      reason:          reason.trim(),
      adjustment_date: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString().slice(0, 10), // Dubai today
    })
    setLoading(false)
    if (result.error) { setError(result.error); return }
    onDone()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(34,26,19,.55)' }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className="relative w-full max-w-sm rounded-[18px] p-6 shadow-xl" style={{ background: 'var(--color-surface)' }}>
        <button
          onClick={onClose}
          className="absolute right-4 top-4 flex items-center justify-center w-8 h-8 rounded-full"
          style={{ color: 'var(--color-muted)' }}
          aria-label="Close"
        >
          <X size={18} />
        </button>

        <p className="text-xs font-bold uppercase tracking-widest mb-0.5" style={{ color: 'var(--color-saffron)', letterSpacing: '.12em' }}>
          Settle Account
        </p>
        <h2 className="font-display font-bold text-[19px] mb-1" style={{ color: 'var(--color-ink)' }}>
          {row.full_name}
        </h2>
        <p className="text-xs mb-4" style={{ color: 'var(--color-muted)' }}>
          Outstanding: <span className="font-bold" style={{ color: 'var(--color-red, #C0392B)' }}>{currency} {row.outstanding.toFixed(2)}</span>
          {' · '}This records a {type === 'discount' ? 'discount' : 'write-off'}, not a payment — cash books stay untouched.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Type */}
          <div className="flex gap-1.5">
            {([
              { value: 'discount' as const,  label: 'Discount'  },
              { value: 'write_off' as const, label: 'Write-off' },
            ]).map(t => (
              <button
                key={t.value}
                type="button"
                onClick={() => setType(t.value)}
                className="px-3 py-1.5 rounded-[8px] text-xs font-bold"
                style={{
                  background: type === t.value ? 'var(--color-saffron-soft)' : 'var(--color-cream)',
                  color: type === t.value ? 'var(--color-saffron)' : 'var(--color-muted)',
                  border: `1.5px solid ${type === t.value ? 'var(--color-saffron)' : 'var(--color-border)'}`,
                }}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Amount */}
          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--color-muted)' }}>
              Amount ({currency}) *
            </label>
            <input
              type="number"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              min="0.01"
              step="0.01"
              required
              className="w-full rounded-[10px] px-3 py-2.5 text-sm num focus:outline-none focus:ring-1 focus:ring-saffron"
              style={{ background: 'var(--color-cream)', border: '1px solid var(--color-border)', color: 'var(--color-ink)' }}
            />
            <p className="text-[11px] mt-1" style={{ color: fullSettle ? 'var(--color-green, #2E7D4F)' : 'var(--color-muted)' }}>
              {fullSettle
                ? '✓ Settles the account in full — balance becomes 0'
                : !isNaN(amountNum) && amountNum > 0 && amountNum < row.outstanding
                  ? `Partial — ${currency} ${(row.outstanding - amountNum).toFixed(2)} will remain outstanding`
                  : 'Prefilled with the full outstanding amount'}
            </p>
          </div>

          {/* Reason */}
          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--color-muted)' }}>
              Reason *
            </label>
            <textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              rows={2}
              required
              placeholder={row.subPaused
                ? 'e.g. Final settlement — subscription paused, small remainder waived'
                : 'e.g. Goodwill discount agreed with customer'}
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
              {loading ? 'Settling…' : fullSettle ? 'Settle in Full' : 'Apply Discount'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export function OutstandingModule({ rows, totalCustomers, currency, userRole, rangeFrom, rangeTo }: Props) {
  const canEditStartDate = userRole === 'owner'
  const canEditPauseDate = ['owner', 'manager', 'data_entry'].includes(userRole)
  // Mirrors recordPayment()'s role gate (the server re-checks anyway).
  const canRecordPayment = ['owner', 'manager', 'accounts', 'data_entry'].includes(userRole)
  const canSettle = userRole === 'owner'
  const router = useRouter()
  const [payRow, setPayRow] = useState<OutstandingRow | null>(null)
  const [settleRow, setSettleRow] = useState<OutstandingRow | null>(null)
  const [view,        setView]        = useState<ViewMode>('owing')
  const [search,      setSearch]      = useState('')
  const [typeFilter,  setTypeFilter]  = useState<string>('')
  const [flagFilter,  setFlagFilter]  = useState<FlagLevel | ''>('')
  const [areaFilter,  setAreaFilter]  = useState<string[]>([])
  const [editingDate, setEditingDate] = useState<DateEdit | null>(null)
  const [savingDate,  setSavingDate]  = useState(false)
  const [dateError,   setDateError]   = useState<string | null>(null)
  const [isFiltering, startFiltering] = useTransition()

  // Date range lives in the URL so the server can aggregate only that window.
  function applyDateRange(from: string, to: string) {
    startFiltering(() => {
      router.push(from && to ? `/outstanding?from=${from}&to=${to}` : '/outstanding')
    })
  }

  async function handleSaveDate() {
    if (!editingDate) return
    setSavingDate(true)
    setDateError(null)
    const res = editingDate.field === 'start'
      ? await updateSubscriptionStartDate(editingDate.subId, editingDate.value)
      : await updateSubscriptionPauseDate(editingDate.subId, editingDate.value || null)
    setSavingDate(false)
    if (res.error) { setDateError(res.error); return }
    setEditingDate(null)
    router.refresh()
  }

  const areas = useMemo(() => collectAreas(rows, r => r.area), [rows])

  // Every owing customer gets a due flag, computed once per render pass.
  const flagMap = useMemo(() => {
    const m = new Map<string, { level: FlagLevel; reason: string }>()
    for (const r of rows) if (r.outstanding > 0.005) m.set(r.id, computeDueFlag(r))
    return m
  }, [rows])

  // Same underlying data either way — just the other side of the same
  // balance. Owing = still owes money (outstanding > 0), sorted worst flag
  // first so the customers to chase sit at the top. Credit = already paid
  // more than they currently owe, i.e. money sitting on their account.
  const owingRows  = useMemo(() =>
    rows.filter(r => r.outstanding > 0.005).sort((a, b) => {
      const rankDiff = (FLAG_META[flagMap.get(b.id)!.level].rank) - (FLAG_META[flagMap.get(a.id)!.level].rank)
      return rankDiff !== 0 ? rankDiff : b.outstanding - a.outstanding
    }), [rows, flagMap])
  const creditRows = useMemo(() => rows.filter(r => r.outstanding < -0.005).sort((a, b) => a.outstanding - b.outstanding), [rows])
  const baseRows = view === 'owing' ? owingRows : creditRows

  const flagCounts = useMemo(() => {
    const c: Record<FlagLevel, number> = { overdue: 0, due_soon: 0, on_track: 0 }
    for (const r of owingRows) c[flagMap.get(r.id)!.level]++
    return c
  }, [owingRows, flagMap])

  const filtered = useMemo(() => {
    let result = baseRows
    if (view === 'owing' && flagFilter) result = result.filter(r => flagMap.get(r.id)!.level === flagFilter)
    if (typeFilter) result = result.filter(r => r.customer_type === typeFilter)
    if (areaFilter.length) result = result.filter(r => matchesArea(areaFilter, r.area))
    if (search.trim()) {
      const q = search.toLowerCase()
      result = result.filter(r =>
        r.full_name.toLowerCase().includes(q) ||
        r.customer_code.toLowerCase().includes(q) ||
        (r.mobile_number ?? '').includes(q)
      )
    }
    return result
  }, [baseRows, search, typeFilter, areaFilter, view, flagFilter, flagMap])

  const grandTotal  = Math.abs(filtered.reduce((s, r) => s + r.outstanding, 0))
  const grandBilled = filtered.reduce((s, r) => s + r.totalBilled, 0)
  const grandPaid   = filtered.reduce((s, r) => s + r.totalPaid,   0)
  const hasDateRange = !!(rangeFrom || rangeTo)
  const isFiltered   = !!(hasDateRange || search.trim() || typeFilter || areaFilter.length || flagFilter)

  return (
    <div style={{ opacity: isFiltering ? 0.6 : 1, transition: 'opacity 120ms' }}>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--color-saffron)', letterSpacing: '.12em' }}>Finance</p>
          <h1 className="font-display font-bold text-[25px] mt-0.5" style={{ color: 'var(--color-ink)' }}>Outstanding Report</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--color-muted)' }}>
            {view === 'owing'
              ? hasDateRange
                ? 'Orders & subscription charges in selected period minus payments received'
                : 'All customers with unpaid balances — orders + subscription charges minus payments'
              : 'Customers who’ve paid more than they currently owe — credit sitting on their account'}
          </p>
        </div>

        {/* Owing / Credit toggle */}
        <div className="flex rounded-[10px] p-0.5" style={{ background: 'var(--color-cream)', border: '1px solid var(--color-border)' }}>
          {([
            { value: 'owing' as const,  label: 'Owing' },
            { value: 'credit' as const, label: 'Credit / Prepaid' },
          ]).map(opt => (
            <button
              key={opt.value}
              onClick={() => setView(opt.value)}
              className="px-3.5 py-1.5 rounded-[8px] text-xs font-bold transition-colors"
              style={view === opt.value
                ? { background: 'var(--color-ink)', color: '#fff' }
                : { color: 'var(--color-muted)' }
              }
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        <div className="rounded-[14px] p-4" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}>
          <p className="text-xs font-semibold mb-1" style={{ color: 'var(--color-muted)' }}>{view === 'owing' ? 'Customers with Balance' : 'Customers with Credit'}</p>
          <p className="font-display font-bold text-[24px]" style={{ color: 'var(--color-ink)' }}>{filtered.length}</p>
          <p className="text-[11px] mt-0.5" style={{ color: 'var(--color-muted)' }}>
            of {totalCustomers} active
            {view === 'owing' && flagCounts.overdue > 0 && (
              <span className="font-bold" style={{ color: 'var(--color-red, #C0392B)' }}> · {flagCounts.overdue} overdue</span>
            )}
          </p>
        </div>
        <div className="rounded-[14px] p-4" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}>
          <p className="text-xs font-semibold mb-1" style={{ color: 'var(--color-muted)' }}>Total Billed vs Paid</p>
          <p className="font-display font-bold text-[20px]" style={{ color: 'var(--color-ink)' }}>{currency} {grandBilled.toFixed(2)}</p>
          <p className="text-[11px] mt-0.5" style={{ color: 'var(--color-green, #2E7D4F)' }}>{currency} {grandPaid.toFixed(2)} collected</p>
        </div>
        <div className="rounded-[14px] p-4" style={{ background: 'var(--color-ink)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}>
          <p className="text-xs font-semibold mb-1" style={{ color: '#C9BEB1' }}>{view === 'owing' ? 'Total Outstanding' : 'Total Credit'}</p>
          <p className="font-display font-bold text-[20px]" style={{ color: '#fff' }}>{currency} {grandTotal.toFixed(2)}</p>
          <p className="text-[11px] mt-0.5" style={{ color: '#A09080' }}>All customers combined</p>
        </div>
      </div>

      {/* Due-flag chips — tap to see only that group */}
      {view === 'owing' && (
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <span className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>
            Due status:
          </span>
          {(['overdue', 'due_soon', 'on_track'] as const).map(level => {
            const meta = FLAG_META[level]
            const active = flagFilter === level
            return (
              <button
                key={level}
                onClick={() => setFlagFilter(active ? '' : level)}
                className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold transition-colors"
                style={active
                  ? { background: meta.bg, color: meta.color, border: `1.5px solid ${meta.dot}` }
                  : { background: 'var(--color-surface)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' }
                }
              >
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: meta.dot }} />
                {meta.label} ({flagCounts[level]})
              </button>
            )
          })}
          {flagFilter && (
            <button
              onClick={() => setFlagFilter('')}
              className="text-xs font-semibold underline"
              style={{ color: 'var(--color-muted)' }}
            >
              Clear
            </button>
          )}
        </div>
      )}

      {/* Type filter pills */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        {([
          { value: '',            label: 'All Types' },
          { value: 'a_la_carte',  label: 'A La Carte' },
          { value: 'fixed_menu',  label: 'Fixed Menu' },
          { value: 'hybrid',      label: 'Hybrid' },
        ] as const).map(opt => {
          const active = typeFilter === opt.value
          const tc = opt.value ? TYPE_COLORS[opt.value] : null
          return (
            <button
              key={opt.value}
              onClick={() => setTypeFilter(opt.value)}
              className="px-3 py-1 rounded-full text-xs font-semibold transition-colors"
              style={active && tc
                ? { background: tc.bg, color: tc.color, border: `1.5px solid ${tc.color}` }
                : active
                ? { background: 'var(--color-ink)', color: '#fff', border: '1.5px solid var(--color-ink)' }
                : { background: 'var(--color-surface)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' }
              }
            >
              {opt.label}
            </button>
          )
        })}
      </div>

      {/* Search + date filter */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--color-muted)' }} />
          <input
            type="search"
            placeholder="Search customer name, code or mobile…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full rounded-[8px] pl-7 pr-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-saffron"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-ink)' }}
          />
        </div>
        <AreaFilter areas={areas} value={areaFilter} onChange={setAreaFilter} />
        <DatePresetPicker
          fromDate={rangeFrom}
          toDate={rangeTo}
          onChange={applyDateRange}
        />
      </div>

      {/* Table */}
      <div className="rounded-[14px] overflow-hidden" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}>
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <p className="font-semibold text-[15px]" style={{ color: isFiltered ? 'var(--color-muted)' : 'var(--color-green, #2E7D4F)' }}>
              {isFiltered ? 'No customers match your filter' : view === 'owing' ? 'All clear!' : 'No credit balances'}
            </p>
            <p className="text-sm mt-1" style={{ color: 'var(--color-muted)' }}>
              {isFiltered
                ? 'Try a different date range or search term.'
                : view === 'owing'
                ? 'No customers have outstanding balances.'
                : 'No customers currently have a credit balance.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--color-cream)' }}>
                  {['#', 'Customer', 'Type', 'Contact', 'Subscription', 'Billed', 'Paid', 'Aging', view === 'owing' ? 'Outstanding' : 'Credit', 'Actions'].map(h => (
                    <th
                      key={h}
                      className={`px-4 py-3 text-xs font-bold uppercase tracking-wide ${['Billed', 'Paid', 'Aging', 'Outstanding', 'Credit', 'Actions'].includes(h) ? 'text-right' : 'text-left'}`}
                      style={{ color: 'var(--color-muted)' }}
                    >{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((row, i) => {
                  const tc = TYPE_COLORS[row.customer_type] ?? TYPE_COLORS.a_la_carte
                  const flag = view === 'owing' ? flagMap.get(row.id) : undefined
                  const fm = flag ? FLAG_META[flag.level] : null
                  return (
                    <tr
                      key={row.id}
                      style={{
                        borderBottom: i < filtered.length - 1 ? '1px solid var(--color-border)' : undefined,
                        // Overdue rows carry a red left edge so they pop even when scrolling fast
                        boxShadow: flag?.level === 'overdue' ? `inset 3px 0 0 ${fm!.dot}` : undefined,
                      }}
                    >
                      <td className="px-4 py-3 text-xs font-bold" style={{ color: 'var(--color-muted)' }}>{i + 1}</td>
                      <td className="px-4 py-3">
                        <Link href={`/customers/${row.id}`} className="hover:underline">
                          <span className="font-semibold block" style={{ color: 'var(--color-ink)' }}>{row.full_name}</span>
                          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{row.customer_code}</span>
                        </Link>
                        {flag && fm && (
                          <span
                            className="mt-1 flex items-center gap-1 w-fit px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap"
                            style={{ background: fm.bg, color: fm.color }}
                            title={`${fm.label} — ${flag.reason}`}
                          >
                            <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: fm.dot }} />
                            {flag.reason}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1">
                          <span className="text-[11px] font-bold px-2 py-0.5 rounded-full w-fit" style={{ background: tc.bg, color: tc.color }}>
                            {TYPE_LABELS[row.customer_type] ?? row.customer_type}
                          </span>
                          <span
                            className="text-[10px] font-semibold px-1.5 py-0.5 rounded-[4px] w-fit"
                            style={row.payment_terms === 'prepaid'
                              ? { background: '#DCFCE7', color: '#166534' }
                              : { background: '#EDE9FE', color: '#5B21B6' }}
                          >
                            {row.payment_terms === 'prepaid' ? 'Prepaid' : 'Postpaid'}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs" style={{ color: 'var(--color-muted)' }}>
                        <div>{row.mobile_number}</div>
                        {row.area && <div className="mt-0.5">{row.area}</div>}
                      </td>
                      {/* Subscription info + inline date edit */}
                      <td className="px-4 py-3 text-left min-w-[200px]">
                        {row.monthlyRate > 0 && row.subId ? (
                          <div className="space-y-1.5">
                            {/* Rate + paused badge */}
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono text-xs font-semibold" style={{ color: 'var(--color-ink)' }}>
                                {currency} {row.monthlyRate.toFixed(2)}<span style={{ color: 'var(--color-muted)' }}>/mo</span>
                              </span>
                              {row.subPaused && (
                                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-[4px]"
                                  style={{ background: '#FEF3C7', color: '#92400E' }}>
                                  PAUSED
                                </span>
                              )}
                            </div>

                            {/* Start date */}
                            <div className="flex items-center gap-1 text-[11px]" style={{ color: 'var(--color-muted)' }}>
                              <span className="w-[44px] font-semibold flex-shrink-0">Start</span>
                              {editingDate?.customerId === row.id && editingDate.field === 'start' ? (
                                <div className="flex items-center gap-1">
                                  <input
                                    type="date"
                                    value={editingDate.value}
                                    onChange={e => setEditingDate({ ...editingDate, value: e.target.value })}
                                    className="rounded-[5px] px-1.5 py-0.5 text-[11px] focus:outline-none focus:ring-1"
                                    style={{ border: '1px solid var(--color-border)', color: 'var(--color-ink)', background: 'var(--color-cream)', width: 120 }}
                                  />
                                  <button onClick={handleSaveDate} disabled={savingDate}
                                    className="p-0.5 rounded hover:opacity-70 disabled:opacity-40"
                                    style={{ color: 'var(--color-green)' }}>
                                    <Check size={13} />
                                  </button>
                                  <button onClick={() => { setEditingDate(null); setDateError(null) }}
                                    className="p-0.5 rounded hover:opacity-70"
                                    style={{ color: 'var(--color-red)' }}>
                                    <X size={13} />
                                  </button>
                                </div>
                              ) : (
                                <div className="flex items-center gap-1 group">
                                  <span style={{ color: 'var(--color-ink)' }}>{row.subStartDate ? fmtDateShort(row.subStartDate) : '—'}</span>
                                  {canEditStartDate && (
                                    <button onClick={() => { setDateError(null); setEditingDate({ subId: row.subId!, field: 'start', value: row.subStartDate!, customerId: row.id }) }}
                                      className="opacity-0 group-hover:opacity-60 transition-opacity">
                                      <Pencil size={10} />
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>

                            {/* Pause date */}
                            <div className="flex items-center gap-1 text-[11px]" style={{ color: 'var(--color-muted)' }}>
                              <span className="w-[44px] font-semibold flex-shrink-0">Paused</span>
                              {editingDate?.customerId === row.id && editingDate.field === 'end' ? (
                                <div className="flex items-center gap-1">
                                  <input
                                    type="date"
                                    value={editingDate.value}
                                    onChange={e => setEditingDate({ ...editingDate, value: e.target.value })}
                                    className="rounded-[5px] px-1.5 py-0.5 text-[11px] focus:outline-none focus:ring-1"
                                    style={{ border: '1px solid var(--color-border)', color: 'var(--color-ink)', background: 'var(--color-cream)', width: 120 }}
                                  />
                                  <button onClick={handleSaveDate} disabled={savingDate}
                                    className="p-0.5 rounded hover:opacity-70 disabled:opacity-40"
                                    style={{ color: 'var(--color-green)' }}>
                                    <Check size={13} />
                                  </button>
                                  <button onClick={() => { setEditingDate(null); setDateError(null) }}
                                    className="p-0.5 rounded hover:opacity-70"
                                    style={{ color: 'var(--color-red)' }}>
                                    <X size={13} />
                                  </button>
                                </div>
                              ) : (
                                <div className="flex items-center gap-1 group">
                                  <span style={{ color: row.subEndDate ? 'var(--color-ink)' : 'var(--color-muted)' }}>
                                    {row.subEndDate ? fmtDateShort(row.subEndDate) : 'Not set'}
                                  </span>
                                  {canEditPauseDate && (
                                    <button onClick={() => { setDateError(null); setEditingDate({ subId: row.subId!, field: 'end', value: row.subEndDate ?? '', customerId: row.id }) }}
                                      className="opacity-0 group-hover:opacity-60 transition-opacity">
                                      <Pencil size={10} />
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>

                            {/* Next payment due: start date + months already paid for. Red = overdue. */}
                            {row.nextDueDate && (
                              <div className="flex items-center gap-1 text-[11px]" style={{ color: 'var(--color-muted)' }}>
                                <span className="w-[44px] font-semibold flex-shrink-0">Next due</span>
                                <span
                                  className="font-semibold"
                                  style={{
                                    color: (row.nextDueInDays ?? 0) < 0
                                      ? 'var(--color-red, #C0392B)'
                                      : 'var(--color-purple, #7C3AED)',
                                  }}
                                >
                                  {fmtDateShort(row.nextDueDate)}
                                </span>
                                {(row.nextDueInDays ?? 0) < 0 && (
                                  <span
                                    className="text-[10px] font-bold px-1 rounded-[3px]"
                                    style={{ background: '#FEE2E2', color: '#991B1B' }}
                                  >
                                    OVERDUE {Math.abs(row.nextDueInDays ?? 0)}d
                                  </span>
                                )}
                              </div>
                            )}

                            {/* Inline error */}
                            {dateError && editingDate?.customerId === row.id && (
                              <p className="text-[10px]" style={{ color: 'var(--color-red)' }}>{dateError}</p>
                            )}
                          </div>
                        ) : (
                          <span className="text-[11px]" style={{ color: 'var(--color-muted)' }}>—</span>
                        )}
                      </td>
                      {/* Billed */}
                      <td className="px-4 py-3 text-right font-mono" style={{ color: 'var(--color-ink)' }}>
                        <div>{currency} {row.totalBilled.toFixed(2)}</div>
                        {row.fixedDiscount > 0 ? (
                          <>
                            <div className="text-[10px] mt-0.5" style={{ color: 'var(--color-muted)' }}>
                              Plan {currency} {row.subCharge.toFixed(2)} + Orders {currency} {row.orderBilled.toFixed(2)}
                            </div>
                            <div className="text-[10px]" style={{ color: 'var(--color-green, #2E7D4F)' }}>
                              Fixed-plan discount −{currency} {row.fixedDiscount.toFixed(2)}
                            </div>
                          </>
                        ) : (
                          <>
                            {row.subCharge > 0 && row.orderBilled > 0 && (
                              <div className="text-[10px] mt-0.5" style={{ color: 'var(--color-muted)' }}>
                                Sub {currency} {row.subCharge.toFixed(2)} + Orders {currency} {row.orderBilled.toFixed(2)}
                              </div>
                            )}
                            {row.subCharge > 0 && row.orderBilled === 0 && (
                              <div className="text-[10px] mt-0.5" style={{ color: 'var(--color-muted)' }}>
                                {row.subPaused ? 'Prorated subscription (paused)' : 'Subscription charges'}
                              </div>
                            )}
                          </>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-semibold" style={{ color: 'var(--color-green, #2E7D4F)' }}>
                        {currency} {row.totalPaid.toFixed(2)}
                        {row.adjustmentTotal > 0 && (
                          <div className="text-[10px] font-semibold mt-0.5" style={{ color: 'var(--color-purple, #7C3AED)' }}>
                            + {currency} {row.adjustmentTotal.toFixed(2)} discount
                          </div>
                        )}
                      </td>
                      {/* Aging — how long it's been outstanding + when they last paid */}
                      <td className="px-4 py-3 text-right">
                        {row.outstandingSince ? (
                          <div className="text-[11px]" style={{
                            color: (row.daysOutstanding ?? 0) > 30 ? 'var(--color-red, #C0392B)' : 'var(--color-muted)',
                          }}>
                            Since {fmtDateShort(row.outstandingSince)}
                            <span className="font-semibold"> · {row.daysOutstanding}d</span>
                          </div>
                        ) : (
                          <div className="text-[11px]" style={{ color: 'var(--color-muted)' }}>—</div>
                        )}
                        {row.lastPaymentDate ? (
                          <div className="text-[11px] mt-0.5" style={{ color: 'var(--color-green, #2E7D4F)' }}>
                            Last {currency} {(row.lastPaymentAmount ?? 0).toFixed(2)} · {fmtDateShort(row.lastPaymentDate)}
                            <span className="font-semibold"> · {row.daysSinceLastPayment}d ago</span>
                          </div>
                        ) : (
                          <div className="text-[11px] mt-0.5" style={{ color: 'var(--color-muted)' }}>Never paid</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-bold font-mono" style={{ color: view === 'owing' ? 'var(--color-red, #C0392B)' : 'var(--color-green, #2E7D4F)' }}>
                        {currency} {Math.abs(row.outstanding).toFixed(2)}
                      </td>
                      {/* Actions — record a payment / WhatsApp follow-up */}
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1.5">
                          {canRecordPayment && (
                            <button
                              type="button"
                              onClick={() => setPayRow(row)}
                              title="Record a payment for this customer"
                              className="flex items-center gap-1 px-2 py-1 rounded-[8px] text-[11px] font-bold whitespace-nowrap"
                              style={{ background: 'var(--color-green-soft, #DCFCE7)', color: 'var(--color-green, #2E7D4F)', border: '1px solid var(--color-green, #2E7D4F)' }}
                            >
                              <HandCoins size={12} /> Pay
                            </button>
                          )}
                          {canSettle && view === 'owing' && row.outstanding > 0 && (
                            <button
                              type="button"
                              onClick={() => setSettleRow(row)}
                              title="Settle with a discount / write-off"
                              className="flex items-center justify-center w-[26px] h-[26px] rounded-[8px]"
                              style={{ background: 'var(--color-saffron-soft)', color: 'var(--color-saffron)', border: '1px solid var(--color-saffron)' }}
                            >
                              <BadgePercent size={13} />
                            </button>
                          )}
                          {view === 'owing' && (() => {
                            const wa = whatsAppReminderLink(row, currency)
                            return wa ? (
                              <a
                                href={wa}
                                target="_blank"
                                rel="noopener noreferrer"
                                title="Send a WhatsApp payment reminder"
                                className="flex items-center justify-center w-[26px] h-[26px] rounded-[8px]"
                                style={{ background: '#DCFCE7', color: '#128C7E', border: '1px solid #128C7E' }}
                              >
                                <MessageCircle size={13} />
                              </a>
                            ) : null
                          })()}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: '2px solid var(--color-border)', background: 'var(--color-cream)' }}>
                  <td className="px-4 py-3 font-bold text-xs uppercase tracking-wide" style={{ color: 'var(--color-muted)' }} colSpan={5}>
                    Total ({filtered.length} customers)
                  </td>
                  <td className="px-4 py-3 text-right font-bold font-mono" style={{ color: 'var(--color-ink)' }}>{currency} {grandBilled.toFixed(2)}</td>
                  <td className="px-4 py-3 text-right font-bold font-mono" style={{ color: 'var(--color-green, #2E7D4F)' }}>{currency} {grandPaid.toFixed(2)}</td>
                  <td className="px-4 py-3"></td>
                  <td className="px-4 py-3 text-right font-bold font-mono" style={{ color: view === 'owing' ? 'var(--color-red, #C0392B)' : 'var(--color-green, #2E7D4F)' }}>{currency} {grandTotal.toFixed(2)}</td>
                  <td className="px-4 py-3"></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* Record Payment — customer locked to the clicked row; balances refresh on close */}
      {payRow && (
        <RecordPaymentModal
          customers={[]}
          preselectedCustomer={{
            id:            payRow.id,
            full_name:     payRow.full_name,
            customer_code: payRow.customer_code,
            mobile_number: payRow.mobile_number,
            area:          payRow.area,
          }}
          initialAmount={payRow.outstanding > 0 ? payRow.outstanding.toFixed(2) : undefined}
          onClose={() => { setPayRow(null); router.refresh() }}
        />
      )}

      {/* Settle with discount / write-off — owner only */}
      {settleRow && (
        <SettleDialog
          row={settleRow}
          currency={currency}
          onClose={() => setSettleRow(null)}
          onDone={() => { setSettleRow(null); router.refresh() }}
        />
      )}
    </div>
  )
}
