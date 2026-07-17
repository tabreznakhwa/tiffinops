export const dynamic = 'force-dynamic'

import { requireAuth } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSettings } from '@/lib/settings/getSettings'
import Link from 'next/link'

const TYPE_LABELS: Record<string, string> = {
  a_la_carte: 'A La Carte',
  fixed_menu:  'Fixed Menu',
  hybrid:      'Hybrid',
}
const TYPE_COLORS: Record<string, { bg: string; color: string }> = {
  a_la_carte: { bg: 'var(--color-saffron-soft)', color: 'var(--color-saffron)' },
  fixed_menu:  { bg: 'var(--color-blue-soft, #EFF6FF)', color: 'var(--color-blue, #2563EB)' },
  hybrid:      { bg: 'var(--color-purple-soft, #F5F3FF)', color: 'var(--color-purple, #7C3AED)' },
}

export default async function OutstandingPage() {
  const user = await requireAuth()
  const canView = ['owner', 'manager', 'accounts'].includes(user.role)
  if (!canView) {
    return (
      <div className="flex items-center justify-center h-48">
        <p className="text-sm font-semibold" style={{ color: 'var(--color-muted)' }}>
          You don't have permission to view this report.
        </p>
      </div>
    )
  }

  const admin = createAdminClient()
  const settings = await getSettings()
  const currency = settings.currency

  // Fetch customers
  const { data: customers } = await admin
    .from('customers')
    .select('id, full_name, customer_code, customer_type, mobile_number, area, status')
    .in('status', ['active', 'paused'])
    .order('full_name', { ascending: true })

  const customerMap = new Map((customers ?? []).map(c => [c.id, c]))
  const customerIds = (customers ?? []).map(c => c.id)

  if (customerIds.length === 0) {
    return (
      <div>
        <h1 className="font-display font-bold text-[25px]" style={{ color: 'var(--color-ink)' }}>Outstanding Report</h1>
        <p className="text-sm mt-4" style={{ color: 'var(--color-muted)' }}>No active customers found.</p>
      </div>
    )
  }

  // Paginated fetch of all credit non-cancelled orders
  const PAGE = 1000
  const orderTotals = new Map<string, number>()
  {
    let off = 0
    while (true) {
      const { data } = await admin
        .from('orders')
        .select('customer_id, total_amount')
        .in('customer_id', customerIds)
        .eq('is_credit', true)
        .not('order_status', 'in', '(cancelled,voided,draft)')
        .range(off, off + PAGE - 1)
      if (!data || data.length === 0) break
      for (const o of data) {
        orderTotals.set(o.customer_id, (orderTotals.get(o.customer_id) ?? 0) + parseFloat(o.total_amount))
      }
      if (data.length < PAGE) break
      off += PAGE
    }
  }

  // Paginated fetch of all non-voided payments
  const paymentTotals = new Map<string, number>()
  {
    let off = 0
    while (true) {
      const { data } = await admin
        .from('payments')
        .select('customer_id, amount')
        .in('customer_id', customerIds)
        .is('voided_at', null)
        .range(off, off + PAGE - 1)
      if (!data || data.length === 0) break
      for (const p of data) {
        paymentTotals.set(p.customer_id, (paymentTotals.get(p.customer_id) ?? 0) + parseFloat(p.amount))
      }
      if (data.length < PAGE) break
      off += PAGE
    }
  }

  // Compute outstanding per customer
  type OutstandingRow = {
    id: string
    full_name: string
    customer_code: string
    customer_type: string
    mobile_number: string
    area: string | null
    totalBilled: number
    totalPaid: number
    outstanding: number
  }

  const rows: OutstandingRow[] = []
  for (const c of customers ?? []) {
    const totalBilled = orderTotals.get(c.id) ?? 0
    const totalPaid   = paymentTotals.get(c.id) ?? 0
    const outstanding = totalBilled - totalPaid
    if (outstanding > 0.005) {
      rows.push({
        id:            c.id,
        full_name:     c.full_name,
        customer_code: c.customer_code,
        customer_type: c.customer_type,
        mobile_number: c.mobile_number,
        area:          c.area,
        totalBilled,
        totalPaid,
        outstanding,
      })
    }
  }

  rows.sort((a, b) => b.outstanding - a.outstanding)

  const grandTotal     = rows.reduce((s, r) => s + r.outstanding, 0)
  const grandBilled    = rows.reduce((s, r) => s + r.totalBilled, 0)
  const grandPaid      = rows.reduce((s, r) => s + r.totalPaid, 0)

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--color-saffron)', letterSpacing: '.12em' }}>
          Finance
        </p>
        <h1 className="font-display font-bold text-[25px] mt-0.5" style={{ color: 'var(--color-ink)' }}>
          Outstanding Report
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--color-muted)' }}>
          All customers with unpaid balances (orders billed minus payments received)
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="rounded-[14px] p-4" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}>
          <p className="text-xs font-semibold mb-1" style={{ color: 'var(--color-muted)' }}>Customers with Balance</p>
          <p className="font-display font-bold text-[24px]" style={{ color: 'var(--color-ink)' }}>{rows.length}</p>
          <p className="text-[11px] mt-0.5" style={{ color: 'var(--color-muted)' }}>of {customers?.length ?? 0} active</p>
        </div>
        <div className="rounded-[14px] p-4" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}>
          <p className="text-xs font-semibold mb-1" style={{ color: 'var(--color-muted)' }}>Total Billed vs Paid</p>
          <p className="font-display font-bold text-[20px]" style={{ color: 'var(--color-ink)' }}>
            {currency} {grandBilled.toFixed(2)}
          </p>
          <p className="text-[11px] mt-0.5" style={{ color: 'var(--color-green, #2E7D4F)' }}>
            {currency} {grandPaid.toFixed(2)} collected
          </p>
        </div>
        <div className="rounded-[14px] p-4" style={{ background: 'var(--color-ink)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}>
          <p className="text-xs font-semibold mb-1" style={{ color: '#C9BEB1' }}>Total Outstanding</p>
          <p className="font-display font-bold text-[20px]" style={{ color: '#fff' }}>
            {currency} {grandTotal.toFixed(2)}
          </p>
          <p className="text-[11px] mt-0.5" style={{ color: '#A09080' }}>All customers combined</p>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-[14px] overflow-hidden" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}>
        {rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <p className="font-semibold text-[15px]" style={{ color: 'var(--color-green, #2E7D4F)' }}>All clear!</p>
            <p className="text-sm mt-1" style={{ color: 'var(--color-muted)' }}>No customers have outstanding balances.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--color-cream)' }}>
                  {['#', 'Customer', 'Type', 'Contact', 'Total Billed', 'Total Paid', 'Outstanding'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => {
                  const tc = TYPE_COLORS[row.customer_type] ?? TYPE_COLORS.a_la_carte
                  return (
                    <tr
                      key={row.id}
                      style={{ borderBottom: i < rows.length - 1 ? '1px solid var(--color-border)' : undefined }}
                    >
                      <td className="px-4 py-3 text-xs font-bold" style={{ color: 'var(--color-muted)' }}>
                        {i + 1}
                      </td>
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
                        {currency} {row.totalBilled.toFixed(2)}
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
                    Total ({rows.length} customers)
                  </td>
                  <td className="px-4 py-3 text-right font-bold font-mono" style={{ color: 'var(--color-ink)' }}>
                    {currency} {grandBilled.toFixed(2)}
                  </td>
                  <td className="px-4 py-3 text-right font-bold font-mono" style={{ color: 'var(--color-green, #2E7D4F)' }}>
                    {currency} {grandPaid.toFixed(2)}
                  </td>
                  <td className="px-4 py-3 text-right font-bold font-mono" style={{ color: 'var(--color-red, #C0392B)' }}>
                    {currency} {grandTotal.toFixed(2)}
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
