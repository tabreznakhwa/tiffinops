'use client'

import { useState, useMemo, useTransition } from 'react'
import Link from 'next/link'
import { Plus, Search, Printer, X } from 'lucide-react'
import { DatePresetPicker } from '@/components/ui/date-preset-picker'
import {
  createInvoice,
  issueInvoice,
  updateInvoiceStatus,
  voidInvoice,
  triggerMonthlyInvoices,
  type CreateInvoiceInput,
  type GenerateResult,
} from '@/lib/invoices/actions'
import { getCustomerSubscription } from '@/lib/invoices/getCustomerSubscription'
import { useAppSettings } from '@/components/settings/settings-context'
import type { InvoiceWithCustomer, StatusCounts } from '@/app/(app)/invoices/page'
import type { Enums } from '@/lib/supabase/types'

// ── Types ─────────────────────────────────────────────────────────────────────

type InvoiceType = Enums<'invoice_type'>
type InvoiceStatus = Enums<'invoice_status'>

type CustomerOption = {
  id: string
  full_name: string
  customer_code: string
}

type LineItem = {
  description: string
  quantity: string
  unit_price: string
  order_id?: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<InvoiceStatus, { label: string; bg: string; color: string }> = {
  draft:       { label: 'Draft',       bg: 'var(--color-border)',      color: 'var(--color-muted)'  },
  issued:      { label: 'Issued',      bg: 'var(--color-blue-soft)',   color: 'var(--color-blue)'   },
  partial:     { label: 'Partial',     bg: '#FEF3C7',                  color: 'var(--color-gold)'   },
  paid:        { label: 'Paid',        bg: 'var(--color-green-soft)',  color: 'var(--color-green)'  },
  overdue:     { label: 'Overdue',     bg: 'var(--color-red-soft)',    color: 'var(--color-red)'    },
  cancelled:   { label: 'Cancelled',   bg: 'var(--color-border)',      color: 'var(--color-muted)'  },
  written_off: { label: 'Written Off', bg: 'var(--color-border)',      color: 'var(--color-muted)'  },
}

const TYPE_CONFIG: Record<InvoiceType, { label: string; bg: string; color: string }> = {
  a_la_carte_cycle: { label: 'A La Carte',    bg: 'var(--color-saffron-soft)', color: 'var(--color-saffron)' },
  fixed_monthly:    { label: 'Fixed Monthly', bg: 'var(--color-purple-soft)',  color: 'var(--color-purple)'  },
  adhoc:            { label: 'Adhoc',         bg: 'var(--color-red-soft)',     color: 'var(--color-ember)'   },
}

function fmtDate(d: string) {
  return new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  })
}

function dueDateColor(dueDate: string, status: InvoiceStatus) {
  if (status === 'paid' || status === 'cancelled' || status === 'written_off') return 'var(--color-muted)'
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const due = new Date(dueDate + 'T00:00:00Z')
  if (due < today) return 'var(--color-red)'
  return 'var(--color-muted)'
}

// ── Badge ─────────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: InvoiceStatus }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.draft
  return (
    <span
      className="text-[10px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap"
      style={{ background: cfg.bg, color: cfg.color }}
    >
      {cfg.label}
    </span>
  )
}

function TypeBadge({ type }: { type: InvoiceType }) {
  const cfg = TYPE_CONFIG[type] ?? TYPE_CONFIG.adhoc
  return (
    <span
      className="text-[10px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap"
      style={{ background: cfg.bg, color: cfg.color }}
    >
      {cfg.label}
    </span>
  )
}

// ── Status Tab Bar ─────────────────────────────────────────────────────────────

const TAB_STATUSES: (InvoiceStatus | 'all')[] = [
  'all', 'draft', 'issued', 'partial', 'paid', 'overdue',
]

function StatusTabs({
  activeStatus,
  counts,
  onChange,
}: {
  activeStatus: InvoiceStatus | 'all'
  counts: StatusCounts
  onChange: (s: InvoiceStatus | 'all') => void
}) {
  const TAB_LABELS: Record<InvoiceStatus | 'all', string> = {
    all: 'All', draft: 'Draft', issued: 'Issued', partial: 'Partial',
    paid: 'Paid', overdue: 'Overdue', cancelled: 'Cancelled', written_off: 'Written Off',
  }

  return (
    <div className="flex gap-1 overflow-x-auto pb-1 flex-wrap">
      {TAB_STATUSES.map((s) => {
        const active = s === activeStatus
        const count = counts[s] ?? 0
        return (
          <button
            key={s}
            onClick={() => onChange(s)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-colors whitespace-nowrap"
            style={{
              background: active ? 'var(--color-ink)' : 'var(--color-surface)',
              color: active ? '#fff' : 'var(--color-muted)',
              border: '1px solid var(--color-border)',
            }}
          >
            {TAB_LABELS[s]}
            {count > 0 && (
              <span
                className="text-[9px] font-bold rounded-full px-1.5 py-0.5 leading-none"
                style={{
                  background: active ? 'rgba(255,255,255,0.2)' : 'var(--color-border)',
                  color: active ? '#fff' : 'var(--color-ink)',
                }}
              >
                {count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

// ── Generate Invoice Modal ────────────────────────────────────────────────────

function GenerateInvoiceModal({
  onClose,
  onSuccess,
}: {
  onClose: () => void
  onSuccess: (id: string) => void
}) {
  const [isPending, startTransition] = useTransition()
  const { currency, vatRate } = useAppSettings()

  // Customer search
  const [customerSearch, setCustomerSearch] = useState('')
  const [customers, setCustomers] = useState<CustomerOption[]>([])
  const [customersLoaded, setCustomersLoaded] = useState(false)
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerOption | null>(null)
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false)

  // Invoice type
  const [invoiceType, setInvoiceType] = useState<InvoiceType>('adhoc')

  // Billing period (for fixed_monthly)
  const [billingMonth, setBillingMonth] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })

  // Due date — defaults to 30 days from today
  const [dueDate, setDueDate] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() + 30)
    return d.toISOString().split('T')[0]
  })

  // Notes
  const [notes, setNotes] = useState('')

  // Line items
  const [items, setItems] = useState<LineItem[]>([
    { description: '', quantity: '1', unit_price: '' },
  ])

  // Subscription load
  const [loadingSubscription, setLoadingSubscription] = useState(false)

  // Error
  const [error, setError] = useState('')

  // Load customers on focus
  async function loadCustomers() {
    if (customersLoaded) return
    try {
      const res = await fetch('/api/customers-list')
      if (res.ok) {
        const data = await res.json()
        setCustomers(data)
      }
    } catch {
      // fallback: customers will stay empty, user types manually
    }
    setCustomersLoaded(true)
  }

  const filteredCustomers = useMemo(() => {
    const q = customerSearch.toLowerCase()
    if (!q) return customers.slice(0, 20)
    return customers.filter(
      (c) =>
        c.full_name.toLowerCase().includes(q) ||
        c.customer_code.toLowerCase().includes(q)
    ).slice(0, 20)
  }, [customers, customerSearch])

  function selectCustomer(c: CustomerOption) {
    setSelectedCustomer(c)
    setCustomerSearch(c.full_name)
    setShowCustomerDropdown(false)
    // If fixed_monthly, try to auto-load subscription price
    if (invoiceType === 'fixed_monthly') {
      loadSubscriptionForCustomer(c.id)
    }
  }

  async function loadSubscriptionForCustomer(customerId: string) {
    setLoadingSubscription(true)
    try {
      const sub = await getCustomerSubscription(customerId)
      if (sub) {
        const monthLabel = new Date(billingMonth + '-01').toLocaleDateString('en-GB', {
          month: 'long', year: 'numeric',
        })
        setItems([{
          description: `Monthly Fixed Plan — ${sub.plan_name} — ${monthLabel}`,
          quantity: '1',
          unit_price: parseFloat(sub.agreed_monthly_price).toFixed(2),
        }])
      }
    } catch {
      // ignore
    } finally {
      setLoadingSubscription(false)
    }
  }

  function handleTypeChange(t: InvoiceType) {
    setInvoiceType(t)
    if (t === 'fixed_monthly' && selectedCustomer) {
      loadSubscriptionForCustomer(selectedCustomer.id)
    }
    if (t !== 'fixed_monthly') {
      // Reset items to blank
      setItems([{ description: '', quantity: '1', unit_price: '' }])
    }
  }

  function handleBillingMonthChange(val: string) {
    setBillingMonth(val)
  }

  function addItem() {
    setItems((prev) => [...prev, { description: '', quantity: '1', unit_price: '' }])
  }

  function removeItem(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx))
  }

  function updateItem(idx: number, field: keyof LineItem, value: string) {
    setItems((prev) => prev.map((item, i) => i === idx ? { ...item, [field]: value } : item))
  }

  // Computed totals
  const subtotal = items.reduce((sum, item) => {
    const qty = parseFloat(item.quantity) || 0
    const price = parseFloat(item.unit_price) || 0
    return sum + qty * price
  }, 0)
  const vatAmount = (subtotal * vatRate) / (100 + vatRate)
  const exclVAT = subtotal - vatAmount

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (!selectedCustomer) {
      setError('Please select a customer')
      return
    }

    const validItems = items.filter(
      (item) => item.description.trim() && parseFloat(item.unit_price) > 0
    )
    if (validItems.length === 0) {
      setError('Add at least one line item with a description and price')
      return
    }

    const input: CreateInvoiceInput = {
      customer_id: selectedCustomer.id,
      invoice_type: invoiceType,
      billing_period_start: invoiceType === 'fixed_monthly' ? `${billingMonth}-01` : null,
      billing_period_end: invoiceType === 'fixed_monthly'
        ? (() => {
            const [y, m] = billingMonth.split('-').map(Number)
            const lastDay = new Date(y, m, 0).getDate()
            return `${billingMonth}-${String(lastDay).padStart(2, '0')}`
          })()
        : null,
      due_date: dueDate,
      notes: notes.trim() || null,
      items: validItems.map((item) => ({
        description: item.description.trim(),
        quantity: parseFloat(item.quantity) || 1,
        unit_price: parseFloat(item.unit_price) || 0,
        order_id: item.order_id ?? null,
      })),
    }

    startTransition(async () => {
      const result = await createInvoice(input)
      if (result.error) {
        setError(result.error)
      } else if (result.invoice_id) {
        onSuccess(result.invoice_id)
      }
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto py-8 px-4"
      style={{ background: 'rgba(34,26,19,0.5)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="w-full max-w-[640px] rounded-[18px] p-6"
        style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          boxShadow: 'var(--shadow-card)',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <p
              className="text-[10px] font-bold uppercase tracking-wider"
              style={{ color: 'var(--color-saffron)' }}
            >
              New Invoice
            </p>
            <h2 className="font-bold text-[18px]" style={{ color: 'var(--color-ink)' }}>
              Generate Invoice
            </h2>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full transition-colors"
            style={{ background: 'var(--color-border)', color: 'var(--color-muted)' }}
          >
            <X size={15} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Customer */}
          <div>
            <label className="block text-xs font-bold mb-1.5" style={{ color: 'var(--color-ink)' }}>
              Customer
            </label>
            <div className="relative">
              <input
                type="text"
                placeholder="Search customer name or code…"
                value={customerSearch}
                onChange={(e) => {
                  setCustomerSearch(e.target.value)
                  setSelectedCustomer(null)
                  setShowCustomerDropdown(true)
                }}
                onFocus={() => {
                  loadCustomers()
                  setShowCustomerDropdown(true)
                }}
                onBlur={() => setTimeout(() => setShowCustomerDropdown(false), 200)}
                className="w-full rounded-[10px] px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-saffron"
                style={{
                  background: 'var(--color-cream)',
                  border: '1px solid var(--color-border)',
                  color: 'var(--color-ink)',
                }}
              />
              {showCustomerDropdown && filteredCustomers.length > 0 && (
                <div
                  className="absolute z-50 w-full mt-1 rounded-[10px] overflow-hidden shadow-lg max-h-52 overflow-y-auto"
                  style={{
                    background: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                  }}
                >
                  {filteredCustomers.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className="w-full text-left px-3 py-2 text-sm hover:bg-cream transition-colors"
                      style={{ color: 'var(--color-ink)' }}
                      onMouseDown={() => selectCustomer(c)}
                    >
                      <span className="font-semibold">{c.full_name}</span>
                      <span className="ml-2 text-xs" style={{ color: 'var(--color-muted)' }}>
                        {c.customer_code}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Invoice Type */}
          <div>
            <label className="block text-xs font-bold mb-1.5" style={{ color: 'var(--color-ink)' }}>
              Invoice Type
            </label>
            <div className="flex gap-2">
              {(['adhoc', 'a_la_carte_cycle', 'fixed_monthly'] as InvoiceType[]).map((t) => {
                const cfg = TYPE_CONFIG[t]
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => handleTypeChange(t)}
                    className="flex-1 px-2 py-2 rounded-[10px] text-xs font-bold transition-colors"
                    style={{
                      background: invoiceType === t ? cfg.bg : 'var(--color-border)',
                      color: invoiceType === t ? cfg.color : 'var(--color-muted)',
                      border: invoiceType === t ? `1.5px solid ${cfg.color}` : '1.5px solid transparent',
                    }}
                  >
                    {cfg.label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Billing month (fixed_monthly only) */}
          {invoiceType === 'fixed_monthly' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold mb-1.5" style={{ color: 'var(--color-ink)' }}>
                  Billing Month
                </label>
                <input
                  type="month"
                  value={billingMonth}
                  onChange={(e) => handleBillingMonthChange(e.target.value)}
                  className="w-full rounded-[10px] px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-saffron"
                  style={{
                    background: 'var(--color-cream)',
                    border: '1px solid var(--color-border)',
                    color: 'var(--color-ink)',
                  }}
                />
              </div>
              <div>
                <label className="block text-xs font-bold mb-1.5" style={{ color: 'var(--color-ink)' }}>
                  Due Date
                </label>
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="w-full rounded-[10px] px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-saffron"
                  style={{
                    background: 'var(--color-cream)',
                    border: '1px solid var(--color-border)',
                    color: 'var(--color-ink)',
                  }}
                />
              </div>
            </div>
          )}

          {/* Due date (non-fixed_monthly) */}
          {invoiceType !== 'fixed_monthly' && (
            <div>
              <label className="block text-xs font-bold mb-1.5" style={{ color: 'var(--color-ink)' }}>
                Due Date
              </label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full rounded-[10px] px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-saffron"
                style={{
                  background: 'var(--color-cream)',
                  border: '1px solid var(--color-border)',
                  color: 'var(--color-ink)',
                }}
              />
            </div>
          )}

          {/* Line Items */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-bold" style={{ color: 'var(--color-ink)' }}>
                Line Items
              </label>
              {loadingSubscription && (
                <span className="text-[10px]" style={{ color: 'var(--color-muted)' }}>
                  Loading subscription…
                </span>
              )}
            </div>

            <div
              className="rounded-[10px] overflow-hidden"
              style={{ border: '1px solid var(--color-border)' }}
            >
              {/* Table header */}
              <div
                className="grid text-[10px] font-bold uppercase tracking-wider px-3 py-2"
                style={{
                  gridTemplateColumns: '1fr 60px 100px 32px',
                  background: 'var(--color-cream)',
                  color: 'var(--color-muted)',
                  borderBottom: '1px solid var(--color-border)',
                }}
              >
                <span>Description</span>
                <span className="text-center">Qty</span>
                <span className="text-right">Unit Price</span>
                <span />
              </div>

              {items.map((item, idx) => (
                <div
                  key={idx}
                  className="grid gap-2 px-3 py-2.5 items-center"
                  style={{
                    gridTemplateColumns: '1fr 60px 100px 32px',
                    borderBottom: idx < items.length - 1 ? '1px solid var(--color-border)' : undefined,
                  }}
                >
                  <input
                    type="text"
                    placeholder="Description"
                    value={item.description}
                    onChange={(e) => updateItem(idx, 'description', e.target.value)}
                    className="rounded-[8px] px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-saffron"
                    style={{
                      background: 'var(--color-cream)',
                      border: '1px solid var(--color-border)',
                      color: 'var(--color-ink)',
                    }}
                  />
                  <input
                    type="number"
                    min="1"
                    step="0.5"
                    placeholder="1"
                    value={item.quantity}
                    onChange={(e) => updateItem(idx, 'quantity', e.target.value)}
                    className="rounded-[8px] px-2 py-1.5 text-sm text-center focus:outline-none focus:ring-1 focus:ring-saffron"
                    style={{
                      background: 'var(--color-cream)',
                      border: '1px solid var(--color-border)',
                      color: 'var(--color-ink)',
                    }}
                  />
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    value={item.unit_price}
                    onChange={(e) => updateItem(idx, 'unit_price', e.target.value)}
                    className="rounded-[8px] px-2 py-1.5 text-sm text-right focus:outline-none focus:ring-1 focus:ring-saffron"
                    style={{
                      background: 'var(--color-cream)',
                      border: '1px solid var(--color-border)',
                      color: 'var(--color-ink)',
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => removeItem(idx)}
                    disabled={items.length === 1}
                    className="w-7 h-7 flex items-center justify-center rounded-full transition-colors"
                    style={{
                      background: items.length === 1 ? 'transparent' : 'var(--color-red-soft)',
                      color: items.length === 1 ? 'var(--color-border)' : 'var(--color-red)',
                    }}
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={addItem}
              className="mt-2 flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-[8px] transition-colors"
              style={{
                color: 'var(--color-saffron)',
                border: '1px dashed var(--color-saffron)',
                background: 'transparent',
              }}
            >
              <Plus size={12} /> Add Row
            </button>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-bold mb-1.5" style={{ color: 'var(--color-ink)' }}>
              Notes (optional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Any additional notes…"
              className="w-full rounded-[10px] px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-saffron resize-none"
              style={{
                background: 'var(--color-cream)',
                border: '1px solid var(--color-border)',
                color: 'var(--color-ink)',
              }}
            />
          </div>

          {/* Summary */}
          <div
            className="rounded-[12px] px-4 py-3 space-y-1"
            style={{ background: 'var(--color-cream)', border: '1px solid var(--color-border)' }}
          >
            <div className="flex justify-between text-xs" style={{ color: 'var(--color-muted)' }}>
              <span>Subtotal (excl. VAT)</span>
              <span className="font-semibold num">{currency} {exclVAT.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-xs" style={{ color: 'var(--color-muted)' }}>
              <span>VAT {vatRate}% (back-calculated, inclusive)</span>
              <span className="font-semibold num">{currency} {vatAmount.toFixed(2)}</span>
            </div>
            <div
              className="flex justify-between text-sm font-bold pt-1"
              style={{ color: 'var(--color-ink)', borderTop: '1px solid var(--color-border)' }}
            >
              <span>Total (VAT Inclusive)</span>
              <span className="num">{currency} {subtotal.toFixed(2)}</span>
            </div>
          </div>

          {/* Error */}
          {error && (
            <p className="text-xs font-semibold" style={{ color: 'var(--color-red)' }}>
              {error}
            </p>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-[10px] text-sm font-bold transition-colors"
              style={{
                background: 'var(--color-border)',
                color: 'var(--color-muted)',
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="flex-[2] py-2.5 rounded-[10px] text-sm font-bold transition-opacity"
              style={{
                background: 'var(--color-saffron)',
                color: '#fff',
                opacity: isPending ? 0.6 : 1,
              }}
            >
              {isPending ? 'Creating…' : 'Create Draft Invoice'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Bulk Monthly Invoice Modal ────────────────────────────────────────────────

function BulkGenerateModal({
  defaultMonth,
  activeSubCount,
  onClose,
}: {
  defaultMonth: string
  activeSubCount: number
  onClose: () => void
}) {
  const [month, setMonth] = useState(defaultMonth)
  const [isPending, startTransition] = useTransition()
  const [result, setResult] = useState<GenerateResult | null>(null)
  const [error, setError] = useState('')

  // Format 'YYYY-MM' → 'July 2026' for display
  function fmtMonth(yyyyMM: string) {
    const [y, m] = yyyyMM.split('-').map(Number)
    return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
  }

  function handleGenerate() {
    setError('')
    setResult(null)
    startTransition(async () => {
      const res = await triggerMonthlyInvoices(month)
      if (res.error) { setError(res.error); return }
      setResult(res as GenerateResult)
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: 'rgba(34,26,19,0.5)' }}
      onClick={(e) => { if (e.target === e.currentTarget && !isPending) onClose() }}
    >
      <div
        className="w-full max-w-[420px] rounded-[18px] p-6"
        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
      >
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest mb-0.5" style={{ color: 'var(--color-saffron)' }}>
              Bulk Action
            </p>
            <h3 className="font-display font-bold text-[18px]" style={{ color: 'var(--color-ink)' }}>
              Generate Monthly Invoices
            </h3>
          </div>
          <button
            onClick={onClose}
            disabled={isPending}
            className="w-8 h-8 flex items-center justify-center rounded-full transition-colors hover:bg-cream"
            style={{ color: 'var(--color-muted)' }}
          >
            <X size={16} />
          </button>
        </div>

        {!result ? (
          <>
            {/* Info */}
            <div
              className="rounded-[10px] px-4 py-3 mb-5 text-sm"
              style={{ background: 'var(--color-cream)', border: '1px solid var(--color-border)' }}
            >
              <p style={{ color: 'var(--color-ink)' }}>
                Creates a <strong>draft fixed_monthly invoice</strong> for every active subscriber.
                Existing invoices for the selected month are skipped.
              </p>
              <p className="mt-1.5 text-xs" style={{ color: 'var(--color-muted)' }}>
                {activeSubCount} active subscription{activeSubCount !== 1 ? 's' : ''} · Due date = 1st of selected month
              </p>
            </div>

            {/* Month picker */}
            <div className="mb-5">
              <label className="block text-xs font-bold mb-1.5" style={{ color: 'var(--color-ink)' }}>
                Billing Month
              </label>
              <input
                type="month"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                className="w-full rounded-[10px] px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-saffron"
                style={{
                  background: 'var(--color-cream)',
                  border: '1px solid var(--color-border)',
                  color: 'var(--color-ink)',
                }}
              />
              <p className="text-[11px] mt-1" style={{ color: 'var(--color-muted)' }}>
                Invoices will cover the full month of {fmtMonth(month)}
              </p>
            </div>

            {error && (
              <p className="text-xs mb-4 font-semibold" style={{ color: 'var(--color-red)' }}>
                {error}
              </p>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-2.5 rounded-[10px] text-sm font-bold"
                style={{ background: 'var(--color-border)', color: 'var(--color-muted)' }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleGenerate}
                disabled={isPending || !month}
                className="flex-1 py-2.5 rounded-[10px] text-sm font-bold transition-opacity"
                style={{
                  background: 'var(--color-ember)',
                  color: '#fff',
                  opacity: isPending || !month ? 0.6 : 1,
                }}
              >
                {isPending ? 'Generating…' : `Generate for ${fmtMonth(month)}`}
              </button>
            </div>
          </>
        ) : (
          /* Result screen */
          <div>
            <div className="space-y-3 mb-5">
              <div className="flex justify-between items-center py-2.5 px-4 rounded-[10px]" style={{ background: 'var(--color-green-soft)' }}>
                <span className="text-sm font-semibold" style={{ color: 'var(--color-green)' }}>Invoices Generated</span>
                <span className="font-display font-bold text-[22px] num" style={{ color: 'var(--color-green)' }}>{result.generated}</span>
              </div>
              <div className="flex justify-between items-center py-2.5 px-4 rounded-[10px]" style={{ background: 'var(--color-cream)' }}>
                <span className="text-sm font-semibold" style={{ color: 'var(--color-muted)' }}>Skipped (duplicate / no price)</span>
                <span className="font-display font-bold text-[22px] num" style={{ color: 'var(--color-muted)' }}>{result.skipped}</span>
              </div>
              {result.errors.length > 0 && (
                <div className="rounded-[10px] px-4 py-3" style={{ background: 'var(--color-red-soft)', border: '1px solid var(--color-red)' }}>
                  <p className="text-xs font-bold mb-1" style={{ color: 'var(--color-red)' }}>
                    {result.errors.length} error{result.errors.length !== 1 ? 's' : ''}:
                  </p>
                  {result.errors.map((e, i) => (
                    <p key={i} className="text-xs" style={{ color: 'var(--color-red)' }}>{e}</p>
                  ))}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="w-full py-2.5 rounded-[10px] text-sm font-bold"
              style={{ background: 'var(--color-saffron)', color: '#fff' }}
            >
              Done — View Invoices
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Cancel Confirmation Dialog ─────────────────────────────────────────────────

function CancelDialog({
  invoiceNumber,
  onClose,
  onConfirm,
  isPending,
}: {
  invoiceNumber: string
  onClose: () => void
  onConfirm: (reason: string) => void
  isPending: boolean
}) {
  const [reason, setReason] = useState('')
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: 'rgba(34,26,19,0.5)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="w-full max-w-[400px] rounded-[18px] p-5"
        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
      >
        <h3 className="font-bold text-[16px] mb-1" style={{ color: 'var(--color-ink)' }}>
          Cancel Invoice {invoiceNumber}?
        </h3>
        <p className="text-xs mb-3" style={{ color: 'var(--color-muted)' }}>
          This sets the invoice status to Cancelled. No ledger reversal is created.
        </p>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason for cancellation…"
          rows={2}
          className="w-full rounded-[10px] px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-saffron resize-none mb-3"
          style={{
            background: 'var(--color-cream)',
            border: '1px solid var(--color-border)',
            color: 'var(--color-ink)',
          }}
        />
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2 rounded-[10px] text-sm font-bold"
            style={{ background: 'var(--color-border)', color: 'var(--color-muted)' }}
          >
            Keep
          </button>
          <button
            type="button"
            disabled={isPending || !reason.trim()}
            onClick={() => onConfirm(reason)}
            className="flex-1 py-2 rounded-[10px] text-sm font-bold transition-opacity"
            style={{
              background: 'var(--color-red)',
              color: '#fff',
              opacity: isPending || !reason.trim() ? 0.6 : 1,
            }}
          >
            {isPending ? 'Cancelling…' : 'Yes, Cancel'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main Module ───────────────────────────────────────────────────────────────

export function InvoicesModule({
  invoices,
  counts,
  userRole,
  defaultGenerateMonth,
  activeSubCount,
}: {
  invoices: InvoiceWithCustomer[]
  counts: StatusCounts
  userRole: string
  defaultGenerateMonth: string
  activeSubCount: number
}) {
  const { currency } = useAppSettings()
  const [activeStatus, setActiveStatus] = useState<InvoiceStatus | 'all'>('all')
  const [search, setSearch] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate,   setToDate]   = useState('')
  const [showModal, setShowModal] = useState(false)
  const [showBulkModal, setShowBulkModal] = useState(false)
  const [cancelTarget, setCancelTarget] = useState<{ id: string; invoice_number: string } | null>(null)

  const [isPending, startTransition] = useTransition()

  const canManage = ['owner', 'manager'].includes(userRole)
  const isOwner = userRole === 'owner'

  // Client-side filter
  const filtered = useMemo(() => {
    let result = invoices
    if (activeStatus !== 'all') {
      result = result.filter((inv) => inv.status === activeStatus)
    }
    if (fromDate) result = result.filter(inv => inv.invoice_date >= fromDate)
    if (toDate)   result = result.filter(inv => inv.invoice_date <= toDate)
    const q = search.toLowerCase().trim()
    if (q) {
      result = result.filter(
        (inv) =>
          inv.invoice_number.toLowerCase().includes(q) ||
          inv.customers?.full_name.toLowerCase().includes(q) ||
          inv.customers?.customer_code.toLowerCase().includes(q)
      )
    }
    return result
  }, [invoices, activeStatus, search, fromDate, toDate])

  function handleIssue(id: string) {
    startTransition(async () => {
      const res = await issueInvoice(id)
      if (res.error) alert(res.error)
    })
  }

  function handleMarkPaid(id: string) {
    startTransition(async () => {
      const res = await updateInvoiceStatus(id, 'paid')
      if (res.error) alert(res.error)
    })
  }

  function handleCancelConfirm(reason: string) {
    if (!cancelTarget) return
    const id = cancelTarget.id
    startTransition(async () => {
      const res = await voidInvoice(id, reason)
      if (res.error) alert(res.error)
      setCancelTarget(null)
    })
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between mb-5">
        <div>
          <p
            className="text-xs font-bold uppercase tracking-widest"
            style={{ color: 'var(--color-saffron)', letterSpacing: '.12em' }}
          >
            Finance
          </p>
          <h1
            className="font-display font-bold text-[25px] mt-0.5"
            style={{ color: 'var(--color-ink)' }}
          >
            Invoices
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {isOwner && (
            <button
              onClick={() => setShowBulkModal(true)}
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-[10px] text-sm font-bold transition-opacity"
              style={{ background: 'var(--color-ember)', color: '#fff' }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4" aria-hidden="true">
                <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-7-7Z"/>
                <path d="M13 2v7h7M9 15h6M9 11h3"/>
              </svg>
              Generate Monthly
            </button>
          )}
          {canManage && (
            <button
              onClick={() => setShowModal(true)}
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-[10px] text-sm font-bold transition-opacity"
              style={{ background: 'var(--color-saffron)', color: '#fff' }}
            >
              <Plus size={15} />
              Generate Invoice
            </button>
          )}
        </div>
      </div>

      {/* Status tabs */}
      <div className="mb-4">
        <StatusTabs
          activeStatus={activeStatus}
          counts={counts}
          onChange={setActiveStatus}
        />
      </div>

      {/* Search + date filter */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative flex-1 min-w-[200px]">
        <Search
          size={14}
          className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
          style={{ color: 'var(--color-muted)' }}
        />
        <input
          type="search"
          placeholder="Search invoice # or customer…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-[11px] pl-8 pr-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-saffron"
          style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            color: 'var(--color-ink)',
          }}
        />
        </div>
        <DatePresetPicker
          fromDate={fromDate}
          toDate={toDate}
          onChange={(from, to) => { setFromDate(from); setToDate(to) }}
        />
      </div>

      {/* Invoice list */}
      {filtered.length === 0 ? (
        <div
          className="py-16 text-center rounded-[14px]"
          style={{ border: '1px dashed var(--color-border)' }}
        >
          <p className="font-semibold text-sm" style={{ color: 'var(--color-muted)' }}>
            No invoices found
          </p>
          {canManage && (
            <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
              Use &ldquo;Generate Invoice&rdquo; to create your first one.
            </p>
          )}
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
          {/* Table header */}
          <div
            className="hidden md:grid text-[10px] font-bold uppercase tracking-wider px-4 py-2.5"
            style={{
              gridTemplateColumns: '120px 90px 90px 1fr 110px 80px 80px auto',
              background: 'var(--color-cream)',
              color: 'var(--color-muted)',
              borderBottom: '1px solid var(--color-border)',
            }}
          >
            <span>Invoice #</span>
            <span>Date</span>
            <span>Due Date</span>
            <span>Customer</span>
            <span>Type</span>
            <span className="text-right">Total</span>
            <span className="text-center">Status</span>
            <span />
          </div>

          {filtered.map((inv, idx) => {
            const isDraft = inv.status === 'draft'
            const isIssuedOrPartial = inv.status === 'issued' || inv.status === 'partial'
            const isCancellable = isDraft || inv.status === 'issued'
            const total = parseFloat(String(inv.total_amount))

            return (
              <div
                key={inv.id}
                className="px-4 py-3 md:grid md:items-center md:gap-2"
                style={{
                  gridTemplateColumns: '120px 90px 90px 1fr 110px 80px 80px auto',
                  borderTop: idx > 0 ? '1px solid var(--color-border)' : undefined,
                }}
              >
                {/* Invoice # */}
                <p className="num font-bold text-[13px]" style={{ color: 'var(--color-ink)' }}>
                  {inv.invoice_number}
                </p>

                {/* Date */}
                <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                  {fmtDate(inv.invoice_date)}
                </p>

                {/* Due Date */}
                <p
                  className="text-xs font-semibold"
                  style={{ color: dueDateColor(inv.due_date, inv.status) }}
                >
                  {fmtDate(inv.due_date)}
                </p>

                {/* Customer */}
                <div className="min-w-0">
                  <p className="font-semibold text-sm truncate" style={{ color: 'var(--color-ink)' }}>
                    {inv.customers?.full_name ?? '—'}
                  </p>
                  <p className="text-[10px]" style={{ color: 'var(--color-muted)' }}>
                    {inv.customers?.customer_code}
                  </p>
                </div>

                {/* Type badge */}
                <div className="flex items-center">
                  <TypeBadge type={inv.invoice_type} />
                </div>

                {/* Total */}
                <p className="num font-bold text-sm text-right" style={{ color: 'var(--color-ink)' }}>
                  {currency} {total.toFixed(2)}
                </p>

                {/* Status badge */}
                <div className="flex justify-center">
                  <StatusBadge status={inv.status} />
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1.5 justify-end flex-wrap mt-2 md:mt-0">
                  {/* Issue */}
                  {isDraft && canManage && (
                    <button
                      onClick={() => handleIssue(inv.id)}
                      disabled={isPending}
                      className="px-2.5 py-1 rounded-[7px] text-[11px] font-bold transition-opacity"
                      style={{
                        background: 'var(--color-blue-soft)',
                        color: 'var(--color-blue)',
                        opacity: isPending ? 0.6 : 1,
                      }}
                    >
                      Issue
                    </button>
                  )}

                  {/* Mark Paid */}
                  {isIssuedOrPartial && canManage && (
                    <button
                      onClick={() => handleMarkPaid(inv.id)}
                      disabled={isPending}
                      className="px-2.5 py-1 rounded-[7px] text-[11px] font-bold transition-opacity"
                      style={{
                        background: 'var(--color-green-soft)',
                        color: 'var(--color-green)',
                        opacity: isPending ? 0.6 : 1,
                      }}
                    >
                      Mark Paid
                    </button>
                  )}

                  {/* Print */}
                  <Link
                    href={`/print/invoice/${inv.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 px-2.5 py-1 rounded-[7px] text-[11px] font-bold transition-colors"
                    style={{
                      background: 'var(--color-cream)',
                      color: 'var(--color-muted)',
                      border: '1px solid var(--color-border)',
                    }}
                  >
                    <Printer size={11} />
                    Print
                  </Link>

                  {/* Cancel (owner only) */}
                  {isCancellable && isOwner && (
                    <button
                      onClick={() => setCancelTarget({ id: inv.id, invoice_number: inv.invoice_number })}
                      className="px-2.5 py-1 rounded-[7px] text-[11px] font-bold transition-colors"
                      style={{
                        background: 'var(--color-red-soft)',
                        color: 'var(--color-red)',
                      }}
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Bulk Monthly Invoice Modal */}
      {showBulkModal && (
        <BulkGenerateModal
          defaultMonth={defaultGenerateMonth}
          activeSubCount={activeSubCount}
          onClose={() => setShowBulkModal(false)}
        />
      )}

      {/* Generate Invoice Modal */}
      {showModal && (
        <GenerateInvoiceModal
          onClose={() => setShowModal(false)}
          onSuccess={(id) => {
            setShowModal(false)
            window.open(`/print/invoice/${id}`, '_blank')
          }}
        />
      )}

      {/* Cancel Confirmation */}
      {cancelTarget && (
        <CancelDialog
          invoiceNumber={cancelTarget.invoice_number}
          onClose={() => setCancelTarget(null)}
          onConfirm={handleCancelConfirm}
          isPending={isPending}
        />
      )}
    </div>
  )
}
