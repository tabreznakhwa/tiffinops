'use client'

import { useState, useMemo } from 'react'
import { Search } from 'lucide-react'
import Link from 'next/link'
import { DatePresetPicker } from '@/components/ui/date-preset-picker'

export type CustomerBasic = {
  id: string
  full_name: string
  customer_code: string
  customer_type: string
  mobile_number: string
  area: string | null
  status: string
}

export type OrderBasic = {
  customer_id: string
  total_amount: string
  order_date: string
}

export type PaymentBasic = {
  customer_id: string
  amount: string
  payment_date: string
}

export type SubscriptionBasic = {
  customer_id: string
  start_date: string
  end_date: string | null
  agreed_monthly_price: string
  status: string
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

// Months elapsed inclusive (advance-payment model: month of start counts immediately)
function monthsInRange(subStart: string, subEnd: string | null, subStatus: string, rangeFrom: string, rangeTo: string): number {
  // Subscription hasn't started yet within the range
  if (subStart > rangeTo) return 0

  // Effective end of subscription
  const subEffectiveEnd = (subStatus === 'cancelled' || subStatus === 'completed') && subEnd
    ? subEnd
    : rangeTo

  // Clamp to range
  const from = subStart > rangeFrom ? subStart : rangeFrom
  const to   = subEffectiveEnd < rangeTo ? subEffectiveEnd : rangeTo

  if (from > to) return 0

  const f = new Date(from + 'T00:00:00Z')
  const t = new Date(to   + 'T00:00:00Z')
  return Math.max(0, (t.getFullYear() - f.getFullYear()) * 12 + (t.getMonth() - f.getMonth()) + 1)
}

function todayStr(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

interface Props {
  customers:     CustomerBasic[]
  orders:        OrderBasic[]
  payments:      PaymentBasic[]
  subscriptions: SubscriptionBasic[]
  currency:      string
}

export function OutstandingModule({ customers, orders, payments, subscriptions, currency }: Props) {
  const [search,      setSearch]      = useState('')
  const [fromDate,    setFromDate]    = useState('')
  const [toDate,      setToDate]      = useState('')
  const [typeFilter,  setTypeFilter]  = useState<string>('')

  const rows = useMemo(() => {
    const today         = todayStr()
    const effectiveFrom = fromDate || '2000-01-01'
    const effectiveTo   = toDate   || today

    // Filter orders and payments by date range
    const filtOrders = orders.filter(o =>
      o.order_date >= effectiveFrom && o.order_date <= effectiveTo
    )
    const filtPayments = payments.filter(p =>
      p.payment_date >= effectiveFrom && p.payment_date <= effectiveTo
    )

    // Aggregate per customer
    const orderTotals   = new Map<string, number>()
    const paymentTotals = new Map<string, number>()
    for (const o of filtOrders)   orderTotals.set(o.customer_id, (orderTotals.get(o.customer_id) ?? 0) + parseFloat(o.total_amount))
    for (const p of filtPayments) paymentTotals.set(p.customer_id, (paymentTotals.get(p.customer_id) ?? 0) + parseFloat(p.amount))

    // Subscription expected charges per customer (months × agreed_monthly_price)
    const subExpected = new Map<string, number>()
    for (const sub of subscriptions) {
      const months = monthsInRange(sub.start_date, sub.end_date, sub.status, effectiveFrom, effectiveTo)
      if (months > 0) {
        const charge = months * parseFloat(sub.agreed_monthly_price)
        subExpected.set(sub.customer_id, (subExpected.get(sub.customer_id) ?? 0) + charge)
      }
    }

    return customers
      .map(c => {
        const orderBilled = orderTotals.get(c.id) ?? 0
        const subCharge   = subExpected.get(c.id) ?? 0
        const totalBilled = orderBilled + subCharge
        const totalPaid   = paymentTotals.get(c.id) ?? 0
        return {
          ...c,
          orderBilled,
          subCharge,
          totalBilled,
          totalPaid,
          outstanding: totalBilled - totalPaid,
        }
      })
      .filter(r => r.outstanding > 0.005)
      .sort((a, b) => b.outstanding - a.outstanding)
  }, [customers, orders, payments, subscriptions, fromDate, toDate])

  const filtered = useMemo(() => {
    let result = rows
    if (typeFilter) result = result.filter(r => r.customer_type === typeFilter)
    if (search.trim()) {
      const q = search.toLowerCase()
      result = result.filter(r =>
        r.full_name.toLowerCase().includes(q) ||
        r.customer_code.toLowerCase().includes(q) ||
        (r.mobile_number ?? '').includes(q)
      )
    }
    return result
  }, [rows, search, typeFilter])

  const grandTotal  = filtered.reduce((s, r) => s + r.outstanding, 0)
  const grandBilled = filtered.reduce((s, r) => s + r.totalBilled, 0)
  const grandPaid   = filtered.reduce((s, r) => s + r.totalPaid,   0)
  const isFiltered  = !!(fromDate || toDate || search.trim() || typeFilter)

  return (
    <div>
      <div className="mb-6">
        <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--color-saffron)', letterSpacing: '.12em' }}>Finance</p>
        <h1 className="font-display font-bold text-[25px] mt-0.5" style={{ color: 'var(--color-ink)' }}>Outstanding Report</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--color-muted)' }}>
          {isFiltered && (fromDate || toDate)
            ? 'Orders & subscription charges in selected period minus payments received'
            : 'All customers with unpaid balances — orders + subscription charges minus payments'}
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        <div className="rounded-[14px] p-4" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}>
          <p className="text-xs font-semibold mb-1" style={{ color: 'var(--color-muted)' }}>Customers with Balance</p>
          <p className="font-display font-bold text-[24px]" style={{ color: 'var(--color-ink)' }}>{filtered.length}</p>
          <p className="text-[11px] mt-0.5" style={{ color: 'var(--color-muted)' }}>of {customers.length} active</p>
        </div>
        <div className="rounded-[14px] p-4" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}>
          <p className="text-xs font-semibold mb-1" style={{ color: 'var(--color-muted)' }}>Total Billed vs Paid</p>
          <p className="font-display font-bold text-[20px]" style={{ color: 'var(--color-ink)' }}>{currency} {grandBilled.toFixed(2)}</p>
          <p className="text-[11px] mt-0.5" style={{ color: 'var(--color-green, #2E7D4F)' }}>{currency} {grandPaid.toFixed(2)} collected</p>
        </div>
        <div className="rounded-[14px] p-4" style={{ background: 'var(--color-ink)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}>
          <p className="text-xs font-semibold mb-1" style={{ color: '#C9BEB1' }}>Total Outstanding</p>
          <p className="font-display font-bold text-[20px]" style={{ color: '#fff' }}>{currency} {grandTotal.toFixed(2)}</p>
          <p className="text-[11px] mt-0.5" style={{ color: '#A09080' }}>All customers combined</p>
        </div>
      </div>

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
        <DatePresetPicker
          fromDate={fromDate}
          toDate={toDate}
          onChange={(from, to) => { setFromDate(from); setToDate(to) }}
        />
      </div>

      {/* Table */}
      <div className="rounded-[14px] overflow-hidden" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}>
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <p className="font-semibold text-[15px]" style={{ color: isFiltered ? 'var(--color-muted)' : 'var(--color-green, #2E7D4F)' }}>
              {isFiltered ? 'No customers match your filter' : 'All clear!'}
            </p>
            <p className="text-sm mt-1" style={{ color: 'var(--color-muted)' }}>
              {isFiltered ? 'Try a different date range or search term.' : 'No customers have outstanding balances.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--color-cream)' }}>
                  {['#', 'Customer', 'Type', 'Contact', 'Billed', 'Paid', 'Outstanding'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((row, i) => {
                  const tc = TYPE_COLORS[row.customer_type] ?? TYPE_COLORS.a_la_carte
                  return (
                    <tr key={row.id} style={{ borderBottom: i < filtered.length - 1 ? '1px solid var(--color-border)' : undefined }}>
                      <td className="px-4 py-3 text-xs font-bold" style={{ color: 'var(--color-muted)' }}>{i + 1}</td>
                      <td className="px-4 py-3">
                        <Link href={`/customers/${row.id}`} className="hover:underline">
                          <span className="font-semibold block" style={{ color: 'var(--color-ink)' }}>{row.full_name}</span>
                          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{row.customer_code}</span>
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: tc.bg, color: tc.color }}>
                          {TYPE_LABELS[row.customer_type] ?? row.customer_type}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs" style={{ color: 'var(--color-muted)' }}>
                        <div>{row.mobile_number}</div>
                        {row.area && <div className="mt-0.5">{row.area}</div>}
                      </td>
                      <td className="px-4 py-3 text-right font-mono" style={{ color: 'var(--color-ink)' }}>
                        <div>{currency} {row.totalBilled.toFixed(2)}</div>
                        {row.subCharge > 0 && row.orderBilled > 0 && (
                          <div className="text-[10px] mt-0.5" style={{ color: 'var(--color-muted)' }}>
                            Sub {currency} {row.subCharge.toFixed(2)} + Orders {currency} {row.orderBilled.toFixed(2)}
                          </div>
                        )}
                        {row.subCharge > 0 && row.orderBilled === 0 && (
                          <div className="text-[10px] mt-0.5" style={{ color: 'var(--color-muted)' }}>Subscription charges</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-semibold" style={{ color: 'var(--color-green, #2E7D4F)' }}>
                        {currency} {row.totalPaid.toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-right font-bold font-mono" style={{ color: 'var(--color-red, #C0392B)' }}>
                        {currency} {row.outstanding.toFixed(2)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: '2px solid var(--color-border)', background: 'var(--color-cream)' }}>
                  <td className="px-4 py-3 font-bold text-xs uppercase tracking-wide" style={{ color: 'var(--color-muted)' }} colSpan={4}>
                    Total ({filtered.length} customers)
                  </td>
                  <td className="px-4 py-3 text-right font-bold font-mono" style={{ color: 'var(--color-ink)' }}>{currency} {grandBilled.toFixed(2)}</td>
                  <td className="px-4 py-3 text-right font-bold font-mono" style={{ color: 'var(--color-green, #2E7D4F)' }}>{currency} {grandPaid.toFixed(2)}</td>
                  <td className="px-4 py-3 text-right font-bold font-mono" style={{ color: 'var(--color-red, #C0392B)' }}>{currency} {grandTotal.toFixed(2)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
