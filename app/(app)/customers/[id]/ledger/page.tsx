export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import { requireAuth } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { getSettings } from '@/lib/settings/getSettings'

function fmtDate(d: string) {
  return new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  })
}

const MEAL_LABELS: Record<string, string> = {
  breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner',
}

const MODE_LABELS: Record<string, string> = {
  cash: 'Cash', bank_transfer: 'Bank Transfer', card: 'Card',
  online: 'Online', cheque: 'Cheque', wallet: 'Wallet', other: 'Other',
}

export default async function CustomerLedgerPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const user = await requireAuth()
  const admin = createAdminClient()

  const [{ data: customer }, { data: orders }, { data: payments }, settings] = await Promise.all([
    admin.from('customers').select('id, full_name, customer_code').eq('id', id).single(),

    // All credit orders (non-draft, non-voided)
    admin
      .from('orders')
      .select('id, order_number, order_date, meal_period, total_amount, order_status, is_credit')
      .eq('customer_id', id)
      .eq('is_credit', true)
      .not('order_status', 'in', '(voided,draft)')
      .order('order_date', { ascending: true })
      .order('created_at', { ascending: true }),

    // All non-voided payments
    admin
      .from('payments')
      .select('id, payment_number, payment_date, amount, mode, is_advance')
      .eq('customer_id', id)
      .is('voided_at', null)
      .order('payment_date', { ascending: true })
      .order('created_at', { ascending: true }),

    getSettings(),
  ])

  if (!customer) notFound()

  const currency = settings.currency

  // Build unified ledger entries sorted by date
  type LedgerRow = {
    date: string
    type: 'order' | 'payment'
    description: string
    debit: number    // amount owed (order)
    credit: number   // amount paid (payment)
    ref: string
    extra?: string
  }

  const entries: LedgerRow[] = [
    ...(orders ?? []).map(o => ({
      date: o.order_date,
      type: 'order' as const,
      description: `Order · ${MEAL_LABELS[o.meal_period] ?? o.meal_period}`,
      debit: parseFloat(o.total_amount),
      credit: 0,
      ref: o.order_number,
      extra: o.order_status === 'cancelled' ? 'cancelled' : undefined,
    })),
    ...(payments ?? []).map(p => ({
      date: p.payment_date,
      type: 'payment' as const,
      description: `Payment · ${MODE_LABELS[p.mode] ?? p.mode}`,
      debit: 0,
      credit: parseFloat(p.amount),
      ref: p.payment_number,
      extra: p.is_advance ? 'advance' : undefined,
    })),
  ].sort((a, b) => a.date.localeCompare(b.date))

  // Compute running balance (positive = customer owes, negative = credit)
  let running = 0
  const rows = entries.map(e => {
    const effectiveDebit = e.extra === 'cancelled' ? 0 : e.debit
    running += effectiveDebit - e.credit
    return { ...e, effectiveDebit, balance: running }
  })

  const totalBilled = rows.reduce((s, r) => s + r.effectiveDebit, 0)
  const totalPaid   = rows.reduce((s, r) => s + r.credit, 0)
  const outstanding = totalBilled - totalPaid

  return (
    <div>
      {/* Back link */}
      <Link
        href={`/customers/${id}`}
        className="inline-flex items-center gap-1.5 text-sm font-semibold mb-5 transition-opacity hover:opacity-70"
        style={{ color: 'var(--color-muted)' }}
      >
        <ArrowLeft size={15} />
        {customer.full_name}
      </Link>

      {/* Header */}
      <div className="mb-6">
        <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--color-saffron)', letterSpacing: '.12em' }}>
          {customer.customer_code}
        </p>
        <h1 className="font-display font-bold text-[25px] mt-0.5" style={{ color: 'var(--color-ink)' }}>
          {customer.full_name} — Ledger
        </h1>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {[
          { label: 'Total Billed', value: totalBilled, color: 'var(--color-red, #C0392B)' },
          { label: 'Total Paid', value: totalPaid, color: 'var(--color-green, #2E7D4F)' },
          {
            label: outstanding > 0 ? 'Outstanding' : outstanding < 0 ? 'Advance Credit' : 'Fully Paid',
            value: Math.abs(outstanding),
            color: outstanding > 0 ? 'var(--color-red, #C0392B)' : outstanding < 0 ? 'var(--color-purple, #7C3AED)' : 'var(--color-green, #2E7D4F)',
            highlight: true,
          },
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
            <p className="text-xs font-semibold mb-1" style={{ color: c.highlight ? '#C9BEB1' : 'var(--color-muted)' }}>
              {c.label}
            </p>
            <p
              className="font-display font-bold text-[20px]"
              style={{ color: c.highlight ? '#fff' : c.color }}
            >
              {currency} {c.value.toFixed(2)}
            </p>
          </div>
        ))}
      </div>

      {/* Ledger table */}
      <div
        className="rounded-[14px] overflow-hidden"
        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}
      >
        {rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <p className="font-semibold text-[15px]" style={{ color: 'var(--color-ink)' }}>No transactions yet</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--color-cream)' }}>
                  {['Date', 'Reference', 'Description', 'Debit (Billed)', 'Credit (Paid)', 'Balance'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => {
                  const isCancelled = row.extra === 'cancelled'
                  const isAdvance = row.extra === 'advance'
                  return (
                    <tr
                      key={`${row.type}-${row.ref}-${i}`}
                      style={{
                        borderBottom: i < rows.length - 1 ? '1px solid var(--color-border)' : undefined,
                        opacity: isCancelled ? 0.45 : 1,
                        background: isCancelled ? 'var(--color-cream)' : undefined,
                      }}
                    >
                      <td className="px-4 py-3 text-xs whitespace-nowrap" style={{ color: 'var(--color-muted)' }}>
                        {fmtDate(row.date)}
                      </td>
                      <td className="px-4 py-3 text-xs font-mono" style={{ color: 'var(--color-muted)' }}>
                        {row.ref}
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-semibold" style={{ color: 'var(--color-ink)' }}>
                          {row.description}
                        </span>
                        {isCancelled && (
                          <span className="ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: 'var(--color-border)', color: 'var(--color-muted)' }}>
                            CANCELLED
                          </span>
                        )}
                        {isAdvance && (
                          <span className="ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: 'var(--color-purple-soft, #F5F3FF)', color: 'var(--color-purple, #7C3AED)' }}>
                            ADVANCE
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-mono" style={{ color: row.effectiveDebit > 0 ? 'var(--color-red, #C0392B)' : 'var(--color-muted)' }}>
                        {row.effectiveDebit > 0 ? `${currency} ${row.effectiveDebit.toFixed(2)}` : '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-semibold" style={{ color: row.credit > 0 ? 'var(--color-green, #2E7D4F)' : 'var(--color-muted)' }}>
                        {row.credit > 0 ? `${currency} ${row.credit.toFixed(2)}` : '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-bold font-mono" style={{
                        color: row.balance > 0 ? 'var(--color-red, #C0392B)' : row.balance < 0 ? 'var(--color-purple, #7C3AED)' : 'var(--color-green, #2E7D4F)',
                      }}>
                        {row.balance > 0 ? `DR ${currency} ${row.balance.toFixed(2)}` :
                         row.balance < 0 ? `CR ${currency} ${Math.abs(row.balance).toFixed(2)}` :
                         'Nil'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: '2px solid var(--color-border)', background: 'var(--color-cream)' }}>
                  <td className="px-4 py-3 font-bold text-xs uppercase tracking-wide" style={{ color: 'var(--color-muted)' }} colSpan={3}>
                    Totals
                  </td>
                  <td className="px-4 py-3 text-right font-bold font-mono" style={{ color: 'var(--color-red, #C0392B)' }}>
                    {currency} {totalBilled.toFixed(2)}
                  </td>
                  <td className="px-4 py-3 text-right font-bold font-mono" style={{ color: 'var(--color-green, #2E7D4F)' }}>
                    {currency} {totalPaid.toFixed(2)}
                  </td>
                  <td className="px-4 py-3 text-right font-bold font-mono" style={{
                    color: outstanding > 0 ? 'var(--color-red, #C0392B)' : outstanding < 0 ? 'var(--color-purple, #7C3AED)' : 'var(--color-green, #2E7D4F)',
                  }}>
                    {outstanding > 0 ? `DR ${currency} ${outstanding.toFixed(2)}` :
                     outstanding < 0 ? `CR ${currency} ${Math.abs(outstanding).toFixed(2)}` :
                     'Nil'}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
