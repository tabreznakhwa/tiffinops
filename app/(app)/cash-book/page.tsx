import { requireAuth } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSettings } from '@/lib/settings/getSettings'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

function fmtDate(d: string) {
  return new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  })
}

const MODE_LABELS: Record<string, string> = {
  cash: 'Cash', bank_transfer: 'Bank Transfer', card: 'Card',
  online: 'Online', cheque: 'Cheque', wallet: 'Wallet', other: 'Other',
}

export default async function CashBookPage() {
  const user = await requireAuth()
  const canView = ['owner', 'manager', 'accounts'].includes(user.role)
  if (!canView) {
    return (
      <div className="flex items-center justify-center h-48">
        <p className="text-sm font-semibold" style={{ color: 'var(--color-muted)' }}>
          You don't have permission to view the Cash Book.
        </p>
      </div>
    )
  }

  const admin = createAdminClient()
  const [settings, { data: payments }] = await Promise.all([
    getSettings(),
    admin
      .from('payments')
      .select('id, payment_number, payment_date, amount, mode, notes, is_advance, voided_at, customers(full_name, customer_code)')
      .eq('mode', 'cash')
      .is('voided_at', null)
      .order('payment_date', { ascending: true })
      .order('created_at', { ascending: true }),
  ])

  const currency = settings.currency
  const openingBalance = parseFloat(settings.cash_opening_balance ?? '0')
  const openingDate = settings.opening_balance_date

  type PaymentRow = {
    id: string; payment_number: string; payment_date: string; amount: string
    mode: string; notes: string | null; is_advance: boolean; voided_at: string | null
    customers: { full_name: string; customer_code: string } | null
  }

  let running = openingBalance
  const rows = (payments as unknown as PaymentRow[] ?? []).map(p => {
    const amt = parseFloat(p.amount)
    running += amt
    return { ...p, amt, balance: running }
  })

  const totalReceipts = rows.reduce((s, r) => s + r.amt, 0)
  const closingBalance = openingBalance + totalReceipts

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--color-saffron)', letterSpacing: '.12em' }}>
          Finance
        </p>
        <h1 className="font-display font-bold text-[25px] mt-0.5" style={{ color: 'var(--color-ink)' }}>
          Cash Book
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--color-muted)' }}>
          All cash payments received · {currency}
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {[
          { label: 'Opening Balance', value: openingBalance, sub: openingDate ? `as of ${fmtDate(openingDate)}` : 'Not set' },
          { label: 'Total Cash Received', value: totalReceipts, sub: `${rows.length} payment${rows.length !== 1 ? 's' : ''}` },
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
            <p className="text-xs font-semibold mb-1" style={{ color: c.highlight ? '#C9BEB1' : 'var(--color-muted)' }}>
              {c.label}
            </p>
            <p className="font-display font-bold text-[20px]" style={{ color: c.highlight ? '#fff' : 'var(--color-ink)' }}>
              {currency} {c.value.toFixed(2)}
            </p>
            <p className="text-[11px] mt-0.5" style={{ color: c.highlight ? '#A09080' : 'var(--color-muted)' }}>
              {c.sub}
            </p>
          </div>
        ))}
      </div>

      {/* Table */}
      <div
        className="rounded-[14px] overflow-hidden"
        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}
      >
        {rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-2">
            <p className="font-semibold text-[15px]" style={{ color: 'var(--color-ink)' }}>No cash payments yet</p>
            <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
              Cash payments will appear here.{' '}
              {openingBalance === 0 && (
                <Link href="/settings" className="underline" style={{ color: 'var(--color-saffron)' }}>Set opening balance →</Link>
              )}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--color-cream)' }}>
                  {['Date', 'Payment #', 'Customer', 'Notes', 'Receipt', 'Balance'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {/* Opening balance row */}
                <tr style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--color-saffron-soft, #FFF7ED)' }}>
                  <td className="px-4 py-3 text-xs font-bold" style={{ color: 'var(--color-muted)' }}>
                    {openingDate ? fmtDate(openingDate) : '—'}
                  </td>
                  <td className="px-4 py-3" colSpan={4}>
                    <span className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--color-saffron)' }}>
                      Opening Balance
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-bold font-mono" style={{ color: 'var(--color-ink)' }}>
                    {currency} {openingBalance.toFixed(2)}
                  </td>
                </tr>

                {rows.map((row, i) => {
                  const cust = row.customers
                  return (
                    <tr
                      key={row.id}
                      style={{ borderBottom: i < rows.length - 1 ? '1px solid var(--color-border)' : undefined }}
                    >
                      <td className="px-4 py-3 text-xs whitespace-nowrap" style={{ color: 'var(--color-muted)' }}>
                        {fmtDate(row.payment_date)}
                      </td>
                      <td className="px-4 py-3 text-xs font-mono" style={{ color: 'var(--color-muted)' }}>
                        {row.payment_number}
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-semibold" style={{ color: 'var(--color-ink)' }}>
                          {cust?.full_name ?? '—'}
                        </span>
                        <span className="text-xs ml-1.5" style={{ color: 'var(--color-muted)' }}>
                          {cust?.customer_code}
                        </span>
                        {row.is_advance && (
                          <span className="ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: 'var(--color-purple-soft, #F5F3FF)', color: 'var(--color-purple, #7C3AED)' }}>
                            ADVANCE
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs max-w-[160px] truncate" style={{ color: 'var(--color-muted)' }}>
                        {row.notes ?? '—'}
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
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
