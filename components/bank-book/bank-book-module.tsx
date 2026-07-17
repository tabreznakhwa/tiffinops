'use client'

import { useState, useMemo } from 'react'
import { Search } from 'lucide-react'
import Link from 'next/link'
import { DatePresetPicker } from '@/components/ui/date-preset-picker'

export type BankRow = {
  id: string
  payment_number: string
  payment_date: string
  amount: string
  mode: string
  reference_number: string | null
  notes: string | null
  is_advance: boolean
  customers: { full_name: string; customer_code: string } | null
}

const MODE_LABELS: Record<string, string> = {
  bank_transfer: 'Bank Transfer', card: 'Card',
  online: 'Online', cheque: 'Cheque', wallet: 'Wallet', other: 'Other',
}

const MODE_COLORS: Record<string, { bg: string; color: string }> = {
  bank_transfer: { bg: 'var(--color-purple-soft, #F5F3FF)', color: 'var(--color-purple, #7C3AED)' },
  card:          { bg: 'var(--color-blue-soft, #EFF6FF)',   color: 'var(--color-blue, #2563EB)'   },
  online:        { bg: 'var(--color-saffron-soft)',         color: 'var(--color-saffron)'          },
  cheque:        { bg: '#FEF3C7',                           color: 'var(--color-gold, #D97706)'    },
  wallet:        { bg: 'var(--color-red-soft)',             color: 'var(--color-ember)'            },
  other:         { bg: 'var(--color-border)',               color: 'var(--color-muted)'            },
}

function fmtDate(d: string) {
  return new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  })
}

interface Props {
  rows:           BankRow[]
  openingBalance: number
  openingDate:    string | null
  currency:       string
}

export function BankBookModule({ rows, openingBalance, openingDate, currency }: Props) {
  const [search,   setSearch]   = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate,   setToDate]   = useState('')

  // Effective opening = opening + sum of all payments before fromDate
  const effectiveOpening = useMemo(() => {
    if (!fromDate) return openingBalance
    return openingBalance + rows
      .filter(r => r.payment_date < fromDate)
      .reduce((s, r) => s + parseFloat(r.amount), 0)
  }, [rows, fromDate, openingBalance])

  const filteredRows = useMemo(() => {
    let list = rows
    if (fromDate) list = list.filter(r => r.payment_date >= fromDate)
    if (toDate)   list = list.filter(r => r.payment_date <= toDate)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(r =>
        r.customers?.full_name.toLowerCase().includes(q) ||
        r.customers?.customer_code.toLowerCase().includes(q) ||
        r.payment_number.toLowerCase().includes(q) ||
        r.reference_number?.toLowerCase().includes(q)
      )
    }
    return list
  }, [rows, fromDate, toDate, search])

  let running = effectiveOpening
  const displayRows = filteredRows.map(r => {
    const amt = parseFloat(r.amount)
    running += amt
    return { ...r, amt, balance: running }
  })

  const totalReceipts  = filteredRows.reduce((s, r) => s + parseFloat(r.amount), 0)
  const closingBalance = effectiveOpening + totalReceipts
  const isFiltered     = !!(fromDate || toDate || search.trim())

  return (
    <div>
      <div className="mb-5">
        <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--color-saffron)', letterSpacing: '.12em' }}>Finance</p>
        <h1 className="font-display font-bold text-[25px] mt-0.5" style={{ color: 'var(--color-ink)' }}>Bank Book</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--color-muted)' }}>
          Bank transfer, card, online, cheque &amp; wallet payments · {currency}
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-5">
        {[
          {
            label: isFiltered ? 'Period Opening' : 'Opening Balance',
            value: effectiveOpening,
            sub: isFiltered && fromDate
              ? `from ${fmtDate(fromDate)}`
              : (openingDate ? `as of ${fmtDate(openingDate)}` : 'Not set'),
          },
          { label: 'Total Received', value: totalReceipts, sub: `${filteredRows.length} payment${filteredRows.length !== 1 ? 's' : ''}` },
          { label: 'Closing Balance', value: closingBalance, sub: 'Running total', highlight: true },
        ].map(c => (
          <div
            key={c.label}
            className="rounded-[14px] p-4"
            style={{
              background: c.highlight ? 'var(--color-ink)' : 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              boxShadow: 'var(--shadow-card)',
            }}
          >
            <p className="text-xs font-semibold mb-1" style={{ color: c.highlight ? '#C9BEB1' : 'var(--color-muted)' }}>{c.label}</p>
            <p className="font-display font-bold text-[20px]" style={{ color: c.highlight ? '#fff' : 'var(--color-ink)' }}>
              {currency} {c.value.toFixed(2)}
            </p>
            <p className="text-[11px] mt-0.5" style={{ color: c.highlight ? '#A09080' : 'var(--color-muted)' }}>{c.sub}</p>
          </div>
        ))}
      </div>

      {/* Search + date filter */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--color-muted)' }} />
          <input
            type="search"
            placeholder="Search customer, payment# or reference…"
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

      <div className="rounded-[14px] overflow-hidden" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}>
        {displayRows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-2">
            <p className="font-semibold text-[15px]" style={{ color: 'var(--color-ink)' }}>
              {isFiltered ? 'No payments match your filter' : 'No bank payments yet'}
            </p>
            <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
              {!isFiltered && openingBalance === 0 && (
                <Link href="/settings" className="underline" style={{ color: 'var(--color-saffron)' }}>Set opening balance →</Link>
              )}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--color-cream)' }}>
                  {['Date', 'Payment #', 'Customer', 'Mode', 'Reference', 'Receipt', 'Balance'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--color-saffron-soft, #FFF7ED)' }}>
                  <td className="px-4 py-3 text-xs font-bold" style={{ color: 'var(--color-muted)' }}>
                    {fromDate ? fmtDate(fromDate) : (openingDate ? fmtDate(openingDate) : '—')}
                  </td>
                  <td className="px-4 py-3" colSpan={5}>
                    <span className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--color-saffron)' }}>
                      {isFiltered && fromDate ? 'Period Opening Balance' : 'Opening Balance'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-bold font-mono" style={{ color: 'var(--color-ink)' }}>
                    {currency} {effectiveOpening.toFixed(2)}
                  </td>
                </tr>

                {displayRows.map((row, i) => {
                  const modeStyle = MODE_COLORS[row.mode] ?? MODE_COLORS.other
                  return (
                    <tr key={row.id} style={{ borderBottom: i < displayRows.length - 1 ? '1px solid var(--color-border)' : undefined }}>
                      <td className="px-4 py-3 text-xs whitespace-nowrap" style={{ color: 'var(--color-muted)' }}>{fmtDate(row.payment_date)}</td>
                      <td className="px-4 py-3 text-xs font-mono" style={{ color: 'var(--color-muted)' }}>{row.payment_number}</td>
                      <td className="px-4 py-3">
                        <span className="font-semibold" style={{ color: 'var(--color-ink)' }}>{row.customers?.full_name ?? '—'}</span>
                        <span className="text-xs ml-1.5" style={{ color: 'var(--color-muted)' }}>{row.customers?.customer_code}</span>
                        {row.is_advance && (
                          <span className="ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: 'var(--color-purple-soft, #F5F3FF)', color: 'var(--color-purple, #7C3AED)' }}>
                            ADVANCE
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: modeStyle.bg, color: modeStyle.color }}>
                          {MODE_LABELS[row.mode] ?? row.mode}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs font-mono max-w-[120px] truncate" style={{ color: 'var(--color-muted)' }}>
                        {row.reference_number ?? '—'}
                      </td>
                      <td className="px-4 py-3 font-semibold text-right font-mono" style={{ color: 'var(--color-green, #2E7D4F)' }}>
                        + {currency} {row.amt.toFixed(2)}
                      </td>
                      <td className="px-4 py-3 font-bold text-right font-mono" style={{ color: 'var(--color-ink)' }}>
                        {currency} {row.balance.toFixed(2)}
                      </td>
                    </tr>
                  )
                })}

                <tr style={{ borderTop: '2px solid var(--color-border)', background: 'var(--color-cream)' }}>
                  <td className="px-4 py-3 font-bold text-xs uppercase tracking-wide" style={{ color: 'var(--color-muted)' }} colSpan={5}>
                    {isFiltered ? 'Period Total' : 'Total'}
                  </td>
                  <td className="px-4 py-3 text-right font-bold font-mono" style={{ color: 'var(--color-green, #2E7D4F)' }}>
                    + {currency} {totalReceipts.toFixed(2)}
                  </td>
                  <td className="px-4 py-3 text-right font-bold font-mono" style={{ color: 'var(--color-ink)' }}>
                    {currency} {closingBalance.toFixed(2)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
