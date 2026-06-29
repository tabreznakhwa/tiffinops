'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft, ChevronRight, Search, FileText, Calendar, CalendarRange } from 'lucide-react'
import { formatMonthDisplay, shiftMonth } from '@/lib/bills/utils'
import { extractVAT } from '@/lib/settings/getSettings'
import { useAppSettings } from '@/components/settings/settings-context'

type BillRow = {
  customerId: string
  fullName: string
  customerCode: string
  customerType: string
  mobileNumber: string
  area: string | null
  orderCount: number
  total: number
}

const PLAN_LABELS: Record<string, string> = {
  a_la_carte: 'A La Carte',
  fixed_menu: 'Fixed + Extra',
  hybrid: 'Hybrid',
}

const PLAN_COLORS: Record<string, { bg: string; color: string }> = {
  a_la_carte: { bg: 'var(--color-saffron-soft)', color: 'var(--color-ember)' },
  fixed_menu: { bg: 'var(--color-green-soft)', color: 'var(--color-green)' },
  hybrid: { bg: 'var(--color-purple-soft)', color: 'var(--color-purple)' },
}

export function BillsModule({
  bills,
  activeMonth,
  currentMonth,
  rangeFrom = '',
  rangeTo = '',
}: {
  bills: BillRow[]
  activeMonth: string
  currentMonth: string
  rangeFrom?: string
  rangeTo?: string
}) {
  const router = useRouter()
  const { currency, vatRate } = useAppSettings()
  const [query, setQuery] = useState('')

  const isRangeMode = !!(rangeFrom && rangeTo)
  const isCurrentMonth = activeMonth === currentMonth

  const [fromInput, setFromInput] = useState(rangeFrom || '')
  const [toInput, setToInput] = useState(rangeTo || '')

  function applyRange() {
    if (!fromInput || !toInput) return
    router.push(`/bills?from=${fromInput}&to=${toInput}`)
  }

  function switchToMonth() {
    router.push(`/bills?month=${currentMonth}`)
  }

  function switchToRange() {
    const today = new Date().toISOString().split('T')[0]
    const firstOfMonth = today.substring(0, 7) + '-01'
    setFromInput(firstOfMonth)
    setToInput(today)
    router.push(`/bills?from=${firstOfMonth}&to=${today}`)
  }

  const grandTotal = bills.reduce((s, b) => s + b.total, 0)
  const { vatAmount } = extractVAT(grandTotal, vatRate)

  const filtered = useMemo(() => {
    const q = query.toLowerCase()
    if (!q) return bills
    return bills.filter(
      (b) =>
        b.fullName.toLowerCase().includes(q) ||
        b.customerCode.toLowerCase().includes(q) ||
        (b.mobileNumber ?? '').includes(q)
    )
  }, [bills, query])

  function navigate(m: string) {
    router.push(`/bills?month=${m}`)
  }

  return (
    <div>
      {/* Page header */}
      <div className="mb-5">
        <p
          className="text-xs font-bold uppercase tracking-widest"
          style={{ color: 'var(--color-saffron)', letterSpacing: '.12em' }}
        >
          A La Carte Bill
        </p>
        <h1
          className="font-display font-bold text-[25px] mt-0.5"
          style={{ color: 'var(--color-ink)' }}
        >
          Monthly Billing
        </h1>
      </div>

      {/* Mode toggle */}
      <div className="flex gap-2 mb-3">
        <button
          onClick={switchToMonth}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] text-xs font-bold transition-colors"
          style={!isRangeMode
            ? { background: 'var(--color-saffron)', color: '#fff' }
            : { background: 'var(--color-surface)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' }
          }
        >
          <Calendar size={13} />
          Monthly
        </button>
        <button
          onClick={switchToRange}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] text-xs font-bold transition-colors"
          style={isRangeMode
            ? { background: 'var(--color-saffron)', color: '#fff' }
            : { background: 'var(--color-surface)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' }
          }
        >
          <CalendarRange size={13} />
          Date Range
        </button>
      </div>

      {/* Month navigator */}
      {!isRangeMode && (
        <div
          className="flex items-center justify-between gap-2 mb-5 rounded-[14px] px-3 py-2.5"
          style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            boxShadow: 'var(--shadow-card)',
          }}
        >
          <button
            onClick={() => navigate(shiftMonth(activeMonth, -1))}
            className="h-9 w-9 flex items-center justify-center rounded-full transition-colors hover:bg-cream flex-shrink-0"
            style={{ color: 'var(--color-muted)' }}
          >
            <ChevronLeft size={20} />
          </button>
          <div className="text-center flex-1">
            <p className="font-bold text-sm" style={{ color: 'var(--color-ink)' }}>
              {formatMonthDisplay(activeMonth)}
            </p>
            {!isCurrentMonth && (
              <button
                onClick={() => navigate(currentMonth)}
                className="text-xs font-bold mt-0.5"
                style={{ color: 'var(--color-saffron)' }}
              >
                Back to Current Month
              </button>
            )}
            {isCurrentMonth && (
              <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
                Current month
              </p>
            )}
          </div>
          <button
            onClick={() => navigate(shiftMonth(activeMonth, 1))}
            className="h-9 w-9 flex items-center justify-center rounded-full transition-colors hover:bg-cream flex-shrink-0"
            style={{ color: 'var(--color-muted)' }}
          >
            <ChevronRight size={20} />
          </button>
        </div>
      )}

      {/* Date range picker */}
      {isRangeMode && (
        <div
          className="flex flex-wrap items-end gap-3 mb-5 rounded-[14px] px-4 py-3.5"
          style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            boxShadow: 'var(--shadow-card)',
          }}
        >
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>
              From
            </label>
            <input
              type="date"
              value={fromInput}
              onChange={(e) => setFromInput(e.target.value)}
              className="rounded-[8px] px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-saffron"
              style={{ border: '1px solid var(--color-border)', color: 'var(--color-ink)', background: 'var(--color-cream)' }}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>
              To
            </label>
            <input
              type="date"
              value={toInput}
              onChange={(e) => setToInput(e.target.value)}
              className="rounded-[8px] px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-saffron"
              style={{ border: '1px solid var(--color-border)', color: 'var(--color-ink)', background: 'var(--color-cream)' }}
            />
          </div>
          <button
            onClick={applyRange}
            disabled={!fromInput || !toInput}
            className="px-4 py-1.5 rounded-[8px] text-sm font-bold transition-opacity"
            style={{ background: 'var(--color-saffron)', color: '#fff', opacity: !fromInput || !toInput ? 0.5 : 1 }}
          >
            Apply
          </button>
          <p className="text-xs self-center" style={{ color: 'var(--color-muted)' }}>
            {rangeFrom} → {rangeTo}
          </p>
        </div>
      )}

      {/* Summary strip */}
      {bills.length > 0 && (
        <div
          className="flex flex-wrap items-center gap-4 px-4 py-3 rounded-[12px] mb-5"
          style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
        >
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>
              Customers
            </p>
            <p className="font-display font-bold text-[20px] num" style={{ color: 'var(--color-ink)' }}>
              {bills.length}
            </p>
          </div>
          <div
            className="w-px self-stretch"
            style={{ background: 'var(--color-border)' }}
          />
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>
              Total Due
            </p>
            <p className="font-display font-bold text-[20px] num" style={{ color: 'var(--color-ink)' }}>
              {currency} {grandTotal.toFixed(2)}
            </p>
          </div>
          <div
            className="w-px self-stretch"
            style={{ background: 'var(--color-border)' }}
          />
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>
              VAT ({vatRate}% incl.)
            </p>
            <p className="font-display font-bold text-[20px] num" style={{ color: 'var(--color-muted)' }}>
              {currency} {vatAmount.toFixed(2)}
            </p>
          </div>
        </div>
      )}

      {/* Search */}
      {bills.length > 0 && (
        <div className="relative mb-4">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
            style={{ color: 'var(--color-muted)' }}
          />
          <input
            type="search"
            placeholder="Search customer…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full rounded-[11px] pl-8 pr-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-saffron"
            style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              color: 'var(--color-ink)',
            }}
          />
        </div>
      )}

      {/* Customer list */}
      {bills.length === 0 ? (
        <div
          className="py-16 text-center rounded-[14px]"
          style={{ border: '1px dashed var(--color-border)' }}
        >
          <p className="font-semibold text-sm" style={{ color: 'var(--color-muted)' }}>
            No orders found for {isRangeMode ? `${rangeFrom} → ${rangeTo}` : formatMonthDisplay(activeMonth)}
          </p>
          <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
            Orders placed via New Order (a-la-carte) will appear here.
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-center py-8" style={{ color: 'var(--color-muted)' }}>
          No customers match &ldquo;{query}&rdquo;
        </p>
      ) : (
        <div
          className="rounded-[14px] overflow-hidden"
          style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            boxShadow: 'var(--shadow-card)',
          }}
        >
          {filtered.map((bill, idx) => {
            const planStyle = PLAN_COLORS[bill.customerType] ?? PLAN_COLORS.a_la_carte
            const { vatAmount: rowVat } = extractVAT(bill.total, vatRate)

            return (
              <div
                key={bill.customerId}
                className="px-4 py-3.5 flex items-center gap-3"
                style={{
                  borderTop: idx > 0 ? '1px solid var(--color-border)' : undefined,
                }}
              >
                {/* Customer info */}
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5 mb-0.5">
                    <p className="font-semibold text-sm truncate" style={{ color: 'var(--color-ink)' }}>
                      {bill.fullName}
                    </p>
                    <span
                      className="text-[10px] font-bold px-1.5 py-0.5 rounded-pill flex-shrink-0"
                      style={{ background: planStyle.bg, color: planStyle.color }}
                    >
                      {PLAN_LABELS[bill.customerType] ?? bill.customerType}
                    </span>
                  </div>
                  <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                    {bill.customerCode} · {bill.orderCount} order{bill.orderCount !== 1 ? 's' : ''}
                    {bill.area ? ` · ${bill.area}` : ''}
                  </p>
                </div>

                {/* Total */}
                <div className="text-right flex-shrink-0">
                  <p
                    className="num font-bold text-sm"
                    style={{ color: 'var(--color-ink)' }}
                  >
                    {currency} {bill.total.toFixed(2)}
                  </p>
                  <p className="text-[10px]" style={{ color: 'var(--color-muted)' }}>
                    VAT {rowVat.toFixed(2)}
                  </p>
                </div>

                {/* View bill */}
                <Link
                  href={`/bills/${bill.customerId}?month=${activeMonth}`}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-[8px] text-xs font-bold flex-shrink-0 transition-colors hover:bg-cream"
                  style={{ color: 'var(--color-saffron)', border: '1px solid var(--color-border)' }}
                >
                  <FileText size={12} />
                  Bill
                </Link>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
