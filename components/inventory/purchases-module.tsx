'use client'

import { useState, useMemo, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Paperclip, Plus, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAppSettings } from '@/components/settings/settings-context'
import { getReceiptUrl } from '@/lib/scan/actions'

export type PurchaseRow = {
  id: string
  purchase_number: string
  purchase_date: string
  payment_status: string
  total_amount: string
  notes: string | null
  receipt_path: string | null
  suppliers: { name: string; supplier_code: string } | null
  purchase_items: { quantity: string }[]
}

const PAYMENT_STATUS_CONFIG: Record<string, { label: string; bg: string; color: string }> = {
  unpaid:  { label: 'Unpaid',  bg: 'var(--color-red-soft)',   color: 'var(--color-red)'   },
  partial: { label: 'Partial', bg: '#FEF3C7',                 color: 'var(--color-gold)'  },
  paid:    { label: 'Paid',    bg: 'var(--color-green-soft)', color: 'var(--color-green)' },
}

function fmtDate(d: string) {
  return new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function todayStr() {
  return new Date().toLocaleDateString('sv-SE')
}

function thisMonthStart() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

function nDaysAgoStr(n: number) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toLocaleDateString('sv-SE')
}

export function PurchasesModule({
  purchases,
  canWrite,
  initialFrom,
  initialTo,
}: {
  purchases: PurchaseRow[]
  canWrite: boolean
  initialFrom: string
  initialTo: string
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { currency } = useAppSettings()

  const [fromDate, setFromDate] = useState(initialFrom)
  const [toDate, setToDate] = useState(initialTo)
  const [search, setSearch] = useState('')

  function applyDateRange() {
    const params = new URLSearchParams(searchParams.toString())
    params.set('from', fromDate)
    params.set('to', toDate)
    router.push(`/inventory/purchases?${params.toString()}`)
  }

  function setQuickRange(from: string, to: string) {
    setFromDate(from)
    setToDate(to)
    const params = new URLSearchParams(searchParams.toString())
    params.set('from', from)
    params.set('to', to)
    router.push(`/inventory/purchases?${params.toString()}`)
  }

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    if (!q) return purchases
    return purchases.filter(
      (p) =>
        p.purchase_number.toLowerCase().includes(q) ||
        (p.suppliers?.name.toLowerCase().includes(q) ?? false) ||
        (p.suppliers?.supplier_code.toLowerCase().includes(q) ?? false)
    )
  }, [purchases, search])

  const totalSpend = useMemo(() => filtered.reduce((s, p) => s + parseFloat(p.total_amount), 0), [filtered])

  const [, startTransition] = useTransition()
  function openReceipt(path: string) {
    startTransition(async () => {
      const res = await getReceiptUrl(path)
      if (res.url) window.open(res.url, '_blank', 'noopener')
    })
  }

  return (
    <div>
      <Link
        href="/inventory"
        className="inline-flex items-center gap-1.5 text-sm font-semibold transition-opacity hover:opacity-70 mb-4"
        style={{ color: 'var(--color-muted)' }}
      >
        <ArrowLeft size={15} />
        Inventory
      </Link>

      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--color-saffron)', letterSpacing: '.12em' }}>
            Inventory
          </p>
          <h1 className="font-display font-bold text-[25px] mt-0.5" style={{ color: 'var(--color-ink)' }}>
            {currency} {totalSpend.toFixed(2)}
            <span className="text-[15px] font-semibold ml-1.5" style={{ color: 'var(--color-muted)' }}>
              purchased · {filtered.length} invoice{filtered.length === 1 ? '' : 's'}
            </span>
          </h1>
        </div>
        {canWrite && (
          <Link href="/inventory/purchases/new">
            <Button variant="primary" size="sm"><Plus size={15} />Record Purchase</Button>
          </Link>
        )}
      </div>

      {/* Date range */}
      <div className="flex flex-col sm:flex-row sm:items-end gap-2 mb-3">
        <div className="flex gap-2">
          <div>
            <label className="block text-[11px] font-semibold mb-1" style={{ color: 'var(--color-muted)' }}>From</label>
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="rounded-[10px] px-3 py-2 text-sm bg-surface text-ink" style={{ border: '1px solid var(--color-border)' }} />
          </div>
          <div>
            <label className="block text-[11px] font-semibold mb-1" style={{ color: 'var(--color-muted)' }}>To</label>
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="rounded-[10px] px-3 py-2 text-sm bg-surface text-ink" style={{ border: '1px solid var(--color-border)' }} />
          </div>
          <Button variant="secondary" size="sm" onClick={applyDateRange} className="self-end">Apply</Button>
        </div>
        <div className="flex gap-1.5">
          <Button variant="ghost" size="sm" onClick={() => setQuickRange(nDaysAgoStr(30), todayStr())}>Last 30 Days</Button>
          <Button variant="ghost" size="sm" onClick={() => setQuickRange(thisMonthStart(), todayStr())}>This Month</Button>
        </div>
      </div>

      <div className="relative mb-4">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--color-muted)' }} />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by invoice number or supplier…"
          className="w-full h-9 pl-9 pr-3 rounded-[10px] text-sm outline-none"
          style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-ink)' }}
        />
      </div>

      {purchases.length === 0 ? (
        <div className="py-16 text-center" style={{ color: 'var(--color-muted)' }}>
          <p className="font-semibold text-[15px]">No purchases in this range</p>
          {canWrite && <p className="text-sm mt-1">Click <strong>Record Purchase</strong> to log a supplier invoice.</p>}
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-16 text-center" style={{ color: 'var(--color-muted)' }}>
          <p className="font-semibold text-[15px]">No purchases match your search</p>
        </div>
      ) : (
        <div className="rounded-[14px] overflow-hidden" style={{ border: '1px solid var(--color-border)', background: 'var(--color-surface)', boxShadow: 'var(--shadow-card)' }}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr style={{ background: 'var(--color-cream)', borderBottom: '1px solid var(--color-border)' }}>
                  {['Invoice', 'Supplier', 'Date', 'Items', 'Total', 'Status'].map((h) => (
                    <th key={h} className="text-left px-4 py-3 text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((p, i) => {
                  const cfg = PAYMENT_STATUS_CONFIG[p.payment_status] ?? PAYMENT_STATUS_CONFIG.unpaid
                  return (
                    <tr key={p.id} style={{ borderTop: i > 0 ? '1px solid var(--color-border)' : undefined }}>
                      <td className="px-4 py-3 font-semibold num" style={{ color: 'var(--color-ink)' }}>
                        <span className="inline-flex items-center gap-1.5">
                          {p.purchase_number}
                          {p.receipt_path && (
                            <button type="button" onClick={() => openReceipt(p.receipt_path!)} aria-label="View scanned bill" title="View scanned bill">
                              <Paperclip size={13} style={{ color: 'var(--color-saffron)' }} />
                            </button>
                          )}
                        </span>
                      </td>
                      <td className="px-4 py-3" style={{ color: 'var(--color-ink)' }}>
                        {p.suppliers?.name ?? '—'}
                        <div className="text-[11px] font-mono" style={{ color: 'var(--color-muted)' }}>{p.suppliers?.supplier_code}</div>
                      </td>
                      <td className="px-4 py-3" style={{ color: 'var(--color-muted)' }}>{fmtDate(p.purchase_date)}</td>
                      <td className="px-4 py-3 num" style={{ color: 'var(--color-muted)' }}>{p.purchase_items.length}</td>
                      <td className="px-4 py-3 num font-semibold" style={{ color: 'var(--color-ink)' }}>{currency} {parseFloat(p.total_amount).toFixed(2)}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10.5px] font-bold" style={{ background: cfg.bg, color: cfg.color }}>
                          {cfg.label}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

