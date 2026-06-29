'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTransition, useState } from 'react'
import { ArrowLeft, ChevronLeft, ChevronRight, Printer, FileText, Calendar, CalendarRange } from 'lucide-react'
import { extractVAT } from '@/lib/settings/getSettings'
import { useAppSettings } from '@/components/settings/settings-context'
import { formatMonthDisplay, shiftMonth, formatBillDate } from '@/lib/bills/utils'
import { createInvoice } from '@/lib/invoices/actions'
import type { Tables, Enums } from '@/lib/supabase/types'

type Customer = Tables<'customers'>

type OrderItem = {
  id: string
  item_name_snapshot: string
  quantity: string
  unit_price: string
  total_price: string
}

type Order = {
  id: string
  order_number: string
  order_date: string
  meal_period: Enums<'meal_period'>
  subtotal: string
  discount_amount: string
  delivery_charge: string
  total_amount: string
  notes: string | null
  order_items: OrderItem[]
}

const PERIOD_LABELS: Record<Enums<'meal_period'>, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
}

const PERIOD_COLORS: Record<Enums<'meal_period'>, { bg: string; color: string }> = {
  breakfast: { bg: '#FEF3C7', color: '#B7860B' },
  lunch: { bg: 'var(--color-saffron-soft)', color: 'var(--color-ember)' },
  dinner: { bg: 'var(--color-purple-soft)', color: 'var(--color-purple)' },
}

const PLAN_LABELS: Record<Enums<'customer_type'>, string> = {
  a_la_carte: 'A La Carte',
  fixed_menu: 'Fixed Menu',
  hybrid: 'Hybrid',
}

export function CustomerBill({
  customer,
  orders,
  activeMonth,
  currentMonth,
  rangeFrom = '',
  rangeTo = '',
}: {
  customer: Customer
  orders: Order[]
  activeMonth: string
  currentMonth: string
  rangeFrom?: string
  rangeTo?: string
}) {
  const router = useRouter()
  const { currency, vatRate } = useAppSettings()

  const isRangeMode = !!(rangeFrom && rangeTo)
  const isCurrentMonth = activeMonth === currentMonth
  const grandTotal = orders.reduce((s, o) => s + parseFloat(String(o.total_amount)), 0)
  const { exclVAT, vatAmount } = extractVAT(grandTotal, vatRate)

  const [fromInput, setFromInput] = useState(rangeFrom || '')
  const [toInput, setToInput] = useState(rangeTo || '')

  function applyRange() {
    if (!fromInput || !toInput) return
    router.push(`/bills/${customer.id}?from=${fromInput}&to=${toInput}`)
  }

  function switchToMonth() {
    router.push(`/bills/${customer.id}?month=${currentMonth}`)
  }

  function switchToRange() {
    const today = new Date().toISOString().split('T')[0]
    const firstOfMonth = today.substring(0, 7) + '-01'
    setFromInput(firstOfMonth)
    setToInput(today)
    router.push(`/bills/${customer.id}?from=${firstOfMonth}&to=${today}`)
  }

  const printUrl = isRangeMode
    ? `/print/bill?customer_id=${customer.id}&from=${rangeFrom}&to=${rangeTo}`
    : `/print/bill?customer_id=${customer.id}&month=${activeMonth}`

  const [isExtracting, startExtract] = useTransition()
  const [extractError, setExtractError] = useState('')

  function handleExtractInvoice() {
    setExtractError('')
    const sortedDates = [...orders].map(o => o.order_date).sort()
    const billingStart = sortedDates[0]
    const billingEnd = sortedDates[sortedDates.length - 1]
    const due = new Date()
    due.setDate(due.getDate() + 30)
    const dueDate = due.toISOString().split('T')[0]

    const items = orders.map(order => {
      const itemsList = order.order_items.map(i => {
        const qty = parseFloat(i.quantity)
        return `${i.item_name_snapshot} ×${Number.isInteger(qty) ? qty : qty.toFixed(1)}`
      }).join(', ')
      const dateLabel = new Date(order.order_date + 'T00:00:00Z').toLocaleDateString('en-GB', {
        day: 'numeric', month: 'short', year: 'numeric',
      })
      return {
        description: `${dateLabel} – ${PERIOD_LABELS[order.meal_period]} – ${itemsList}`,
        quantity: 1,
        unit_price: parseFloat(String(order.total_amount)),
        order_id: order.id,
      }
    })

    startExtract(async () => {
      const result = await createInvoice({
        customer_id: customer.id,
        invoice_type: 'a_la_carte_cycle',
        billing_period_start: billingStart,
        billing_period_end: billingEnd,
        due_date: dueDate,
        items,
      })
      if (result.error) {
        setExtractError(result.error)
      } else if (result.invoice_id) {
        window.open(`/print/invoice/${result.invoice_id}`, '_blank')
      }
    })
  }

  return (
    <div>
      {/* Back */}
      <Link
        href={`/bills?month=${activeMonth}`}
        className="inline-flex items-center gap-1.5 text-sm font-semibold mb-5 transition-opacity hover:opacity-70"
        style={{ color: 'var(--color-muted)' }}
      >
        <ArrowLeft size={15} />
        A La Carte Bill
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <p
            className="text-xs font-bold uppercase tracking-widest"
            style={{ color: 'var(--color-saffron)', letterSpacing: '.12em' }}
          >
            {customer.customer_code}
          </p>
          <h1
            className="font-display font-bold text-[25px] mt-0.5"
            style={{ color: 'var(--color-ink)' }}
          >
            {customer.full_name}
          </h1>
          <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
            {PLAN_LABELS[customer.customer_type]} · {customer.mobile_number}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="flex gap-2">
            <button
              onClick={() => window.open(printUrl, '_blank', 'noopener,noreferrer')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] text-sm font-semibold flex-shrink-0 transition-colors hover:bg-cream"
              style={{ color: 'var(--color-saffron)', border: '1px solid var(--color-border)' }}
            >
              <Printer size={14} />
              Print Bill
            </button>
            <button
              onClick={handleExtractInvoice}
              disabled={isExtracting || orders.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] text-sm font-semibold flex-shrink-0 transition-colors"
              style={{
                background: 'var(--color-saffron)',
                color: '#fff',
                opacity: isExtracting || orders.length === 0 ? 0.6 : 1,
              }}
            >
              <FileText size={14} />
              {isExtracting ? 'Extracting…' : 'Extract Invoice'}
            </button>
          </div>
          {extractError && (
            <p className="text-xs font-semibold" style={{ color: 'var(--color-red)' }}>
              {extractError}
            </p>
          )}
        </div>
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
            onClick={() => router.push(`/bills/${customer.id}?month=${shiftMonth(activeMonth, -1)}`)}
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
                onClick={() => router.push(`/bills/${customer.id}`)}
                className="text-xs font-bold mt-0.5"
                style={{ color: 'var(--color-saffron)' }}
              >
                Current Month
              </button>
            )}
          </div>
          <button
            onClick={() => router.push(`/bills/${customer.id}?month=${shiftMonth(activeMonth, 1)}`)}
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
        </div>
      )}

      {/* No orders */}
      {orders.length === 0 ? (
        <div
          className="py-16 text-center rounded-[14px]"
          style={{ border: '1px dashed var(--color-border)' }}
        >
          <p className="font-semibold text-sm" style={{ color: 'var(--color-muted)' }}>
            No orders for {customer.full_name} in {formatMonthDisplay(activeMonth)}
          </p>
        </div>
      ) : (
        <>
          {/* Order table */}
          <div
            className="rounded-[14px] overflow-hidden mb-4"
            style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              boxShadow: 'var(--shadow-card)',
            }}
          >
            {/* Table header */}
            <div
              className="grid px-4 py-2.5 text-[11px] font-bold uppercase tracking-wide"
              style={{
                background: 'var(--color-cream)',
                color: 'var(--color-muted)',
                gridTemplateColumns: '80px 90px 1fr 90px',
                borderBottom: '1px solid var(--color-border)',
              }}
            >
              <span>Date</span>
              <span>Period</span>
              <span>Items</span>
              <span className="text-right">Amount</span>
            </div>

            {/* Order rows */}
            {orders.map((order, idx) => {
              const periodStyle = PERIOD_COLORS[order.meal_period]
              const qty = (item: OrderItem) => {
                const n = parseFloat(item.quantity)
                return Number.isInteger(n) ? n : n.toFixed(1)
              }
              const itemsText = order.order_items
                .map((i) => `${i.item_name_snapshot} ×${qty(i)}`)
                .join(', ')

              return (
                <div
                  key={order.id}
                  style={{
                    borderTop: idx > 0 ? '1px solid var(--color-border)' : undefined,
                  }}
                >
                  <div
                    className="grid px-4 py-3 items-start gap-2"
                    style={{ gridTemplateColumns: '80px 90px 1fr 90px' }}
                  >
                    <span
                      className="num text-xs font-semibold pt-0.5"
                      style={{ color: 'var(--color-muted)' }}
                    >
                      {formatBillDate(order.order_date)}
                    </span>
                    <span>
                      <span
                        className="inline-block text-[10px] font-bold px-2 py-0.5 rounded-pill"
                        style={{ background: periodStyle.bg, color: periodStyle.color }}
                      >
                        {PERIOD_LABELS[order.meal_period]}
                      </span>
                    </span>
                    <span className="text-xs leading-relaxed" style={{ color: 'var(--color-ink)' }}>
                      {itemsText}
                      {order.notes && (
                        <span className="ml-1.5 text-[10px] font-semibold" style={{ color: 'var(--color-ember)' }}>
                          📌 {order.notes}
                        </span>
                      )}
                    </span>
                    <span
                      className="num text-sm font-semibold text-right"
                      style={{ color: 'var(--color-ink)' }}
                    >
                      {parseFloat(String(order.total_amount)).toFixed(2)}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Totals + VAT */}
          <div
            className="rounded-[14px] p-4"
            style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              boxShadow: 'var(--shadow-card)',
            }}
          >
            <h2
              className="font-display font-bold text-[15px] mb-4"
              style={{ color: 'var(--color-ink)' }}
            >
              Bill Summary — {isRangeMode ? `${rangeFrom} → ${rangeTo}` : formatMonthDisplay(activeMonth)}
            </h2>

            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span style={{ color: 'var(--color-muted)' }}>
                  {orders.length} order{orders.length !== 1 ? 's' : ''}
                </span>
                <span className="num font-semibold" style={{ color: 'var(--color-ink)' }}>
                  {currency} {grandTotal.toFixed(2)}
                </span>
              </div>
            </div>

            {/* VAT breakdown */}
            <div
              className="mt-4 pt-4 space-y-2"
              style={{ borderTop: '1px solid var(--color-border)' }}
            >
              <p
                className="text-[11px] font-bold uppercase tracking-wide mb-2"
                style={{ color: 'var(--color-muted)' }}
              >
                VAT Breakdown ({vatRate}% included in prices)
              </p>
              <div className="flex justify-between text-sm">
                <span style={{ color: 'var(--color-muted)' }}>Amount excl. VAT</span>
                <span className="num" style={{ color: 'var(--color-muted)' }}>
                  {currency} {exclVAT.toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span style={{ color: 'var(--color-muted)' }}>VAT ({vatRate}%)</span>
                <span className="num" style={{ color: 'var(--color-muted)' }}>
                  {currency} {vatAmount.toFixed(2)}
                </span>
              </div>
            </div>

            {/* Total Due */}
            <div
              className="mt-4 pt-4 flex justify-between items-baseline"
              style={{ borderTop: '2px solid var(--color-ink)' }}
            >
              <span
                className="font-display font-bold text-[17px]"
                style={{ color: 'var(--color-ink)' }}
              >
                Total Due
              </span>
              <span
                className="font-display font-extrabold text-[24px] num"
                style={{ color: 'var(--color-ink)' }}
              >
                {currency} {grandTotal.toFixed(2)}
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
