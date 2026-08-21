'use client'

// Expenses ledger — month-filtered list with category totals, manual "Add
// Expense" modal, receipt links (signed URLs on demand), owner-only delete.
// Most rows arrive via the AI bill scanner (/scan-bill); this page is the
// register + keyboard fallback.

import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { Paperclip, Plus, ScanLine, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAppSettings } from '@/components/settings/settings-context'
import { createExpense, deleteExpense, getReceiptUrl } from '@/lib/scan/actions'
import { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_LABELS, type ExpenseCategory } from '@/lib/scan/categories'
import type { Enums } from '@/lib/supabase/types'

export type ExpenseRow = {
  id: string
  expense_number: string
  expense_date: string
  category: ExpenseCategory
  vendor_name: string | null
  description: string | null
  amount: string
  payment_method: Enums<'payment_mode'> | null
  receipt_path: string | null
  notes: string | null
}

const inputBase =
  'w-full rounded-[11px] px-3 py-2.5 text-sm bg-surface text-ink focus:outline-none focus:ring-1 focus:ring-saffron'
const inputStyle = { border: '1px solid var(--color-border)' } as const
const card = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  boxShadow: 'var(--shadow-card)',
} as const

const CATEGORY_LABELS = EXPENSE_CATEGORY_LABELS

const METHOD_LABELS: Record<string, string> = {
  cash: 'Cash', card: 'Card', bank_transfer: 'Bank', cheque: 'Cheque',
  online: 'Online', wallet: 'Wallet', other: 'Other',
}

const PAYMENT_METHODS = Object.entries(METHOD_LABELS) as [Enums<'payment_mode'>, string][]

function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`)
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
}

export function ExpensesModule({ rows, todayDubai, isOwner }: {
  rows: ExpenseRow[]
  todayDubai: string
  isOwner: boolean
}) {
  const { currency } = useAppSettings()
  const [month, setMonth] = useState(todayDubai.slice(0, 7)) // yyyy-MM
  const [showAdd, setShowAdd] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const monthRows = useMemo(() => rows.filter(r => r.expense_date.startsWith(month)), [rows, month])

  const { total, byCategory } = useMemo(() => {
    const byCat = new Map<ExpenseCategory, number>()
    let sum = 0
    for (const r of monthRows) {
      const amt = parseFloat(r.amount)
      sum += amt
      byCat.set(r.category, (byCat.get(r.category) ?? 0) + amt)
    }
    return { total: sum, byCategory: [...byCat.entries()].sort((a, b) => b[1] - a[1]) }
  }, [monthRows])

  function openReceipt(path: string) {
    startTransition(async () => {
      const res = await getReceiptUrl(path)
      if (res.url) window.open(res.url, '_blank', 'noopener')
      else setError(res.error ?? 'Could not open receipt')
    })
  }

  function handleDelete(row: ExpenseRow) {
    if (!confirm(`Delete ${row.expense_number} (${currency} ${parseFloat(row.amount).toFixed(2)})?`)) return
    startTransition(async () => {
      const res = await deleteExpense(row.id)
      if (res.error) setError(res.error)
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display font-bold text-[22px]" style={{ color: 'var(--color-ink)' }}>Expenses</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--color-muted)' }}>
            Fuel, utilities, rent and other business costs — outside inventory purchases.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/scan-bill">
            <Button variant="outline" size="sm"><ScanLine size={14} className="mr-1" /> Scan Bill</Button>
          </Link>
          <Button variant="primary" size="sm" onClick={() => { setShowAdd(true); setError(null) }}>
            <Plus size={14} className="mr-1" /> Add Expense
          </Button>
        </div>
      </div>

      {/* Month + total */}
      <div className="rounded-[14px] p-4 flex flex-wrap items-center justify-between gap-3" style={card}>
        <input
          type="month" value={month} onChange={e => setMonth(e.target.value)}
          className="rounded-[11px] px-3 py-2 text-sm bg-surface text-ink focus:outline-none focus:ring-1 focus:ring-saffron"
          style={inputStyle}
        />
        <div className="text-right">
          <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>Month Total</p>
          <p className="num font-extrabold text-[22px]" style={{ color: 'var(--color-ink)' }}>{currency} {total.toFixed(2)}</p>
        </div>
      </div>

      {/* Category chips */}
      {byCategory.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {byCategory.map(([cat, amt]) => (
            <span
              key={cat}
              className="px-3 py-1.5 rounded-pill text-xs font-semibold"
              style={{ background: 'var(--color-cream)', border: '1px solid var(--color-border)', color: 'var(--color-ink)' }}
            >
              {CATEGORY_LABELS[cat]} · <span className="num font-bold">{amt.toFixed(2)}</span>
            </span>
          ))}
        </div>
      )}

      {error && <p className="text-sm font-semibold" style={{ color: 'var(--color-red)' }}>{error}</p>}

      {/* List */}
      <div className="rounded-[14px] overflow-hidden" style={card}>
        {monthRows.length === 0 ? (
          <p className="p-8 text-center text-sm" style={{ color: 'var(--color-muted)' }}>
            No expenses recorded for this month yet.
          </p>
        ) : (
          <div className="divide-y" style={{ borderColor: 'var(--color-border)' }}>
            {monthRows.map(row => (
              <div key={row.id} className="px-4 py-3 flex items-center gap-3" style={{ borderColor: 'var(--color-border)' }}>
                <div className="w-12 flex-shrink-0 text-center">
                  <p className="text-xs font-bold" style={{ color: 'var(--color-ink)' }}>{formatDate(row.expense_date)}</p>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span
                      className="px-2 py-0.5 rounded-pill text-[10.5px] font-bold"
                      style={{ background: 'var(--color-cream)', border: '1px solid var(--color-border)', color: 'var(--color-muted)' }}
                    >
                      {CATEGORY_LABELS[row.category]}
                    </span>
                    <p className="text-sm font-semibold truncate" style={{ color: 'var(--color-ink)' }}>
                      {row.vendor_name ?? row.description ?? row.expense_number}
                    </p>
                  </div>
                  <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--color-muted)' }}>
                    {row.expense_number}
                    {row.vendor_name && row.description ? ` · ${row.description}` : ''}
                    {row.payment_method ? ` · ${METHOD_LABELS[row.payment_method]}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {row.receipt_path && (
                    <button type="button" onClick={() => openReceipt(row.receipt_path!)} disabled={isPending} aria-label="View receipt">
                      <Paperclip size={15} style={{ color: 'var(--color-saffron)' }} />
                    </button>
                  )}
                  <p className="num font-bold text-sm" style={{ color: 'var(--color-ink)' }}>
                    {currency} {parseFloat(row.amount).toFixed(2)}
                  </p>
                  {isOwner && (
                    <button type="button" onClick={() => handleDelete(row)} disabled={isPending} aria-label="Delete expense">
                      <Trash2 size={14} style={{ color: 'var(--color-red)' }} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showAdd && (
        <AddExpenseModal
          todayDubai={todayDubai}
          currency={currency}
          onClose={() => setShowAdd(false)}
        />
      )}
    </div>
  )
}

// ── Manual add modal ─────────────────────────────────────────────────────────

function AddExpenseModal({ todayDubai, currency, onClose }: {
  todayDubai: string
  currency: string
  onClose: () => void
}) {
  const [date, setDate] = useState(todayDubai)
  const [category, setCategory] = useState<ExpenseCategory>('fuel')
  const [vendor, setVendor] = useState('')
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<Enums<'payment_mode'> | ''>('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleSave() {
    const amt = parseFloat(amount)
    if (!(amt > 0)) { setError('Enter a valid amount'); return }
    startTransition(async () => {
      const res = await createExpense({
        expense_date: date,
        category,
        vendor_name: vendor || undefined,
        description: description || undefined,
        amount: amt,
        payment_method: method || null,
      })
      if (res.error) { setError(res.error); return }
      onClose()
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" style={{ background: 'rgba(0,0,0,0.4)' }}>
      <div className="w-full sm:max-w-md rounded-t-[18px] sm:rounded-[18px] p-5 space-y-3 max-h-[90vh] overflow-y-auto" style={card}>
        <div className="flex items-center justify-between">
          <h2 className="font-display font-bold text-[18px]" style={{ color: 'var(--color-ink)' }}>Add Expense</h2>
          <button type="button" onClick={onClose} aria-label="Close"><X size={18} style={{ color: 'var(--color-muted)' }} /></button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wide mb-2" style={{ color: 'var(--color-muted)' }}>Date</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} className={inputBase} style={inputStyle} />
          </div>
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wide mb-2" style={{ color: 'var(--color-muted)' }}>Category</label>
            <select value={category} onChange={e => setCategory(e.target.value as ExpenseCategory)} className={inputBase} style={inputStyle}>
              {EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="block text-[11px] font-bold uppercase tracking-wide mb-2" style={{ color: 'var(--color-muted)' }}>Amount ({currency})</label>
          <input type="number" min="0" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" className={`${inputBase} num`} style={inputStyle} />
        </div>
        <div>
          <label className="block text-[11px] font-bold uppercase tracking-wide mb-2" style={{ color: 'var(--color-muted)' }}>Vendor <span className="normal-case font-normal">(optional)</span></label>
          <input value={vendor} onChange={e => setVendor(e.target.value)} placeholder="e.g. ENOC, DEWA…" className={inputBase} style={inputStyle} />
        </div>
        <div>
          <label className="block text-[11px] font-bold uppercase tracking-wide mb-2" style={{ color: 'var(--color-muted)' }}>Description <span className="normal-case font-normal">(optional)</span></label>
          <input value={description} onChange={e => setDescription(e.target.value)} placeholder="What was this for?" className={inputBase} style={inputStyle} />
        </div>
        <div>
          <label className="block text-[11px] font-bold uppercase tracking-wide mb-2" style={{ color: 'var(--color-muted)' }}>Payment Method <span className="normal-case font-normal">(optional)</span></label>
          <select value={method} onChange={e => setMethod(e.target.value as Enums<'payment_mode'>)} className={inputBase} style={inputStyle}>
            <option value="">Select method</option>
            {PAYMENT_METHODS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
          </select>
        </div>

        {error && <p className="text-sm font-semibold" style={{ color: 'var(--color-red)' }}>{error}</p>}

        <Button variant="primary" onClick={handleSave} disabled={isPending} className="w-full">
          {isPending ? 'Saving…' : 'Save Expense'}
        </Button>
      </div>
    </div>
  )
}
