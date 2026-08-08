'use client'

import { useState, useMemo, useTransition } from 'react'
import { Search, Pencil, Check, X } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { DatePresetPicker } from '@/components/ui/date-preset-picker'
import { updateSubscriptionStartDate, updateSubscriptionPauseDate } from '@/lib/fixed-menu/actions'

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
  totalBilled:   number
  totalPaid:     number
  outstanding:   number
  monthlyRate:   number
  subPaused:     boolean
  subId:         string | null
  subStartDate:  string | null
  subEndDate:    string | null
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

type DateEdit = { subId: string; field: 'start' | 'end'; value: string; customerId: string }

function fmtDateShort(d: string) {
  return new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function OutstandingModule({ rows, totalCustomers, currency, userRole, rangeFrom, rangeTo }: Props) {
  const canEditStartDate = userRole === 'owner'
  const canEditPauseDate = ['owner', 'manager', 'data_entry'].includes(userRole)
  const router = useRouter()
  const [search,      setSearch]      = useState('')
  const [typeFilter,  setTypeFilter]  = useState<string>('')
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
  const hasDateRange = !!(rangeFrom || rangeTo)
  const isFiltered   = !!(hasDateRange || search.trim() || typeFilter)

  return (
    <div style={{ opacity: isFiltering ? 0.6 : 1, transition: 'opacity 120ms' }}>
      <div className="mb-6">
        <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--color-saffron)', letterSpacing: '.12em' }}>Finance</p>
        <h1 className="font-display font-bold text-[25px] mt-0.5" style={{ color: 'var(--color-ink)' }}>Outstanding Report</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--color-muted)' }}>
          {hasDateRange
            ? 'Orders & subscription charges in selected period minus payments received'
            : 'All customers with unpaid balances — orders + subscription charges minus payments'}
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        <div className="rounded-[14px] p-4" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}>
          <p className="text-xs font-semibold mb-1" style={{ color: 'var(--color-muted)' }}>Customers with Balance</p>
          <p className="font-display font-bold text-[24px]" style={{ color: 'var(--color-ink)' }}>{filtered.length}</p>
          <p className="text-[11px] mt-0.5" style={{ color: 'var(--color-muted)' }}>of {totalCustomers} active</p>
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
                  {['#', 'Customer', 'Type', 'Contact', 'Subscription', 'Billed', 'Paid', 'Outstanding'].map(h => (
                    <th
                      key={h}
                      className={`px-4 py-3 text-xs font-bold uppercase tracking-wide ${['Billed', 'Paid', 'Outstanding'].includes(h) ? 'text-right' : 'text-left'}`}
                      style={{ color: 'var(--color-muted)' }}
                    >{h}</th>
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
                  <td className="px-4 py-3 font-bold text-xs uppercase tracking-wide" style={{ color: 'var(--color-muted)' }} colSpan={5}>
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
