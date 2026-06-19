import { formatInTimeZone } from 'date-fns-tz'
import { requireAuth } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSettings } from '@/lib/settings/getSettings'
import { BillPrintSetup } from '@/components/bills/bill-print-setup'

function fmtDate(d: string) {
  return new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  })
}

const MODE_LABELS: Record<string, string> = {
  cash: 'Cash', bank_transfer: 'Bank Transfer', card: 'Card',
  online: 'Online', cheque: 'Cheque', wallet: 'Wallet', other: 'Other',
}
const STATUS_LABELS: Record<string, string> = {
  active: 'Active', paused: 'Paused', inactive: 'Inactive', blacklisted: 'Blacklisted',
}
const TYPE_LABELS: Record<string, string> = {
  fixed_menu: 'Fixed Menu', a_la_carte: 'A La Carte', hybrid: 'Hybrid',
}

// ── Shared styles ─────────────────────────────────────────────────────────────

const cell: React.CSSProperties = {
  padding: '6px 8px',
  borderBottom: '1px solid #ECE2D3',
  fontSize: 12,
  verticalAlign: 'top',
  color: '#221A13',
}
const hdr: React.CSSProperties = {
  padding: '5px 8px',
  borderBottom: '2px solid #221A13',
  fontSize: 9.5,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '.08em',
  color: '#7C7063',
  textAlign: 'left',
}
const sectionTitle: React.CSSProperties = {
  fontFamily: 'var(--font-display)',
  fontSize: 15,
  fontWeight: 800,
  color: '#221A13',
  margin: '28px 0 10px',
  paddingBottom: 5,
  borderBottom: '2px solid #E76F2A',
}
const kpiGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
  gap: 12,
  marginBottom: 14,
}
const kpiBox: React.CSSProperties = {
  background: '#FBF6EE',
  border: '1px solid #ECE2D3',
  borderRadius: 8,
  padding: '10px 12px',
}

function KPI({ label, value }: { label: string; value: string }) {
  return (
    <div style={kpiBox}>
      <p style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: '#7C7063', marginBottom: 3 }}>
        {label}
      </p>
      <p style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 17, color: '#221A13' }}>
        {value}
      </p>
    </div>
  )
}

export default async function ReportsPrintPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>
}) {
  await requireAuth()

  const { from: qFrom, to: qTo } = await searchParams
  const admin = createAdminClient()

  const todayStr   = formatInTimeZone(new Date(), 'Asia/Dubai', 'yyyy-MM-dd')
  const monthStr   = formatInTimeZone(new Date(), 'Asia/Dubai', 'yyyy-MM')
  const monthStart = `${monthStr}-01`

  const from = qFrom || monthStart
  const to   = qTo   || todayStr

  const fromDate  = new Date(from + 'T00:00:00Z')
  const toDate    = new Date(to   + 'T00:00:00Z')
  const rangeDays = Math.max(1, Math.round((toDate.getTime() - fromDate.getTime()) / 86400000) + 1)

  const [
    settings,
    { data: rawPayments },
    { data: allCustomers },
    { data: rawSubs },
    { data: allOrders },
    { data: rawItems },
    { data: allSubsMonth },
    { data: newCustomers },
  ] = await Promise.all([
    getSettings(),
    admin.from('payments')
      .select('payment_date, amount, mode, customer_id, customers(full_name, customer_code)')
      .is('voided_at', null)
      .gte('payment_date', from).lte('payment_date', to)
      .order('payment_date'),

    admin.from('customers').select('id, customer_type, status, area, created_at'),

    admin.from('customer_subscriptions')
      .select('id, customer_id, status, agreed_monthly_price, start_date, fixed_plans(plan_name), customers(full_name, customer_code)')
      .order('created_at', { ascending: false }),

    admin.from('orders')
      .select('id, order_date, meal_period, total_amount, customer_id')
      .gte('order_date', from).lte('order_date', to)
      .not('order_status', 'in', '(cancelled,voided,draft)'),

    admin.from('order_items')
      .select('item_name_snapshot, quantity, total_price, orders!inner(order_date, order_status)')
      .gte('orders.order_date', from).lte('orders.order_date', to)
      .not('orders.order_status', 'in', '(cancelled,voided,draft)'),

    admin.from('payments')
      .select('customer_id, amount')
      .is('voided_at', null)
      .gte('payment_date', monthStart).lte('payment_date', todayStr),

    admin.from('customers')
      .select('id')
      .gte('created_at', from + 'T00:00:00Z')
      .lte('created_at', to + 'T23:59:59Z'),
  ])

  // ── Revenue ────────────────────────────────────────────────────────────────

  type PayRow = { payment_date: string; amount: string; mode: string; customer_id: string; customers: { full_name: string; customer_code: string } | null }
  const payments = (rawPayments ?? []) as unknown as PayRow[]
  const revenueTotal = payments.reduce((s, p) => s + parseFloat(String(p.amount)), 0)

  const modeMap = new Map<string, { amount: number; count: number }>()
  for (const p of payments) {
    const cur = modeMap.get(p.mode) ?? { amount: 0, count: 0 }
    modeMap.set(p.mode, { amount: cur.amount + parseFloat(String(p.amount)), count: cur.count + 1 })
  }
  const revenueByMode = [...modeMap.entries()].sort((a, b) => b[1].amount - a[1].amount)

  const custPayMap = new Map<string, { name: string; code: string; total: number }>()
  for (const p of payments) {
    const cur = custPayMap.get(p.customer_id) ?? { name: p.customers?.full_name ?? 'Unknown', code: p.customers?.customer_code ?? '', total: 0 }
    custPayMap.set(p.customer_id, { ...cur, total: cur.total + parseFloat(String(p.amount)) })
  }
  const topCustomers = [...custPayMap.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 15).map(([, v]) => v)

  // ── Subscriptions ──────────────────────────────────────────────────────────

  type SubRow = { id: string; customer_id: string; status: string; agreed_monthly_price: string; start_date: string; fixed_plans: { plan_name: string } | null; customers: { full_name: string; customer_code: string } | null }
  const subs = (rawSubs ?? []) as unknown as SubRow[]
  const activeSubs   = subs.filter(s => s.status === 'active')
  const pausedSubs   = subs.filter(s => s.status === 'paused')
  const cancelledSubs = subs.filter(s => s.status === 'cancelled')
  const mrr = activeSubs.reduce((s, sub) => s + parseFloat(String(sub.agreed_monthly_price)), 0)

  const planMap = new Map<string, { count: number; mrr: number }>()
  for (const sub of activeSubs) {
    const name = sub.fixed_plans?.plan_name ?? 'Unknown Plan'
    const cur  = planMap.get(name) ?? { count: 0, mrr: 0 }
    planMap.set(name, { count: cur.count + 1, mrr: cur.mrr + parseFloat(String(sub.agreed_monthly_price)) })
  }
  const subsByPlan = [...planMap.entries()].sort((a, b) => b[1].mrr - a[1].mrr).map(([plan, v]) => ({ plan, ...v }))

  // ── Customers ──────────────────────────────────────────────────────────────

  const customers = allCustomers ?? []
  const byStatus = ['active', 'paused', 'inactive', 'blacklisted'].map(s => ({ status: s, count: customers.filter(c => c.status === s).length }))
  const byType   = ['fixed_menu', 'a_la_carte', 'hybrid'].map(t => ({ type: t, count: customers.filter(c => c.customer_type === t).length }))
  const areaMap  = new Map<string, number>()
  for (const c of customers) { if (c.area) areaMap.set(c.area, (areaMap.get(c.area) ?? 0) + 1) }
  const byArea = [...areaMap.entries()].sort((a, b) => b[1] - a[1]).map(([area, count]) => ({ area, count }))

  // ── Balances ───────────────────────────────────────────────────────────────

  const monthPayBalMap = new Map<string, number>()
  for (const p of allSubsMonth ?? []) {
    monthPayBalMap.set(p.customer_id, (monthPayBalMap.get(p.customer_id) ?? 0) + parseFloat(String(p.amount)))
  }
  const balanceRows = activeSubs.map(s => {
    const charge  = parseFloat(String(s.agreed_monthly_price))
    const paid    = monthPayBalMap.get(s.customer_id) ?? 0
    const balance = charge - paid
    return { full_name: s.customers?.full_name ?? 'Unknown', customer_code: s.customers?.customer_code ?? '', monthlyCharge: charge, monthPaid: paid, balance }
  }).filter(r => r.balance > 0.005).sort((a, b) => b.balance - a.balance)
  const totalOutstanding = balanceRows.reduce((s, r) => s + r.balance, 0)

  // ── Orders ─────────────────────────────────────────────────────────────────

  const orders = allOrders ?? []
  const periodMap = new Map<string, { count: number; revenue: number }>()
  for (const o of orders) {
    const cur = periodMap.get(o.meal_period) ?? { count: 0, revenue: 0 }
    periodMap.set(o.meal_period, { count: cur.count + 1, revenue: cur.revenue + parseFloat(String(o.total_amount)) })
  }
  const ordersByPeriod = ['breakfast', 'lunch', 'dinner'].map(p => ({ period: p, count: periodMap.get(p)?.count ?? 0, revenue: periodMap.get(p)?.revenue ?? 0 }))

  type ItemRow = { item_name_snapshot: string; quantity: number; total_price: string }
  const items = (rawItems ?? []) as unknown as ItemRow[]
  const itemMap = new Map<string, { qty: number; revenue: number }>()
  for (const item of items) {
    const cur = itemMap.get(item.item_name_snapshot) ?? { qty: 0, revenue: 0 }
    itemMap.set(item.item_name_snapshot, { qty: cur.qty + Number(item.quantity), revenue: cur.revenue + parseFloat(String(item.total_price)) })
  }
  const topItems = [...itemMap.entries()].sort((a, b) => b[1].qty - a[1].qty).slice(0, 20).map(([name, v]) => ({ name, ...v }))

  // ── Render ─────────────────────────────────────────────────────────────────

  const printedAt      = formatInTimeZone(new Date(), 'Asia/Dubai', 'd MMM yyyy, h:mm a')
  const dateRangeLabel = `${fmtDate(from)} — ${fmtDate(to)} (${rangeDays} day${rangeDays !== 1 ? 's' : ''})`

  return (
    <div style={{ background: 'white', minHeight: '100vh', padding: '24px 28px', maxWidth: 800, margin: '0 auto', fontFamily: 'var(--font-sans)', color: '#221A13', fontSize: 13, lineHeight: 1.5 }}>
      <BillPrintSetup />

      {/* ── Page header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18, paddingBottom: 14, borderBottom: '3px solid #221A13' }}>
        <div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/Apna%20chulha%20logo%20brown.png" alt="Apna Chulha" style={{ height: 42, width: 'auto', display: 'block', marginBottom: 8 }} />
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 800, margin: '0 0 2px' }}>
            Business Report
          </h1>
          <p style={{ fontSize: 12, color: '#7C7063' }}>{dateRangeLabel}</p>
        </div>
        <div style={{ textAlign: 'right' }}>
          <p style={{ fontSize: 11, color: '#7C7063' }}>Printed: {printedAt} (Dubai)</p>
          <p style={{ fontSize: 11, color: '#7C7063', marginTop: 2 }}>Apna Chulha Restaurant LLC</p>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* 1. REVENUE                                                             */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <p style={sectionTitle}>1. Revenue</p>

      <div style={kpiGrid}>
        <KPI label="Total Collected" value={`${settings.currency} ${revenueTotal.toFixed(2)}`} />
        <KPI label="Transactions" value={String(payments.length)} />
        <KPI label="Average per Transaction" value={payments.length ? `${settings.currency} ${(revenueTotal / payments.length).toFixed(2)}` : '—'} />
      </div>

      {revenueByMode.length > 0 && (
        <>
          <p style={{ fontSize: 11, fontWeight: 700, color: '#7C7063', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 6 }}>
            By Payment Mode
          </p>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 16 }}>
            <thead>
              <tr>
                <th style={hdr}>Mode</th>
                <th style={{ ...hdr, textAlign: 'right' }}>Transactions</th>
                <th style={{ ...hdr, textAlign: 'right' }}>Amount ({settings.currency})</th>
                <th style={{ ...hdr, textAlign: 'right' }}>Share %</th>
              </tr>
            </thead>
            <tbody>
              {revenueByMode.map(([mode, v]) => (
                <tr key={mode}>
                  <td style={cell}>{MODE_LABELS[mode] ?? mode}</td>
                  <td style={{ ...cell, textAlign: 'right' }}>{v.count}</td>
                  <td style={{ ...cell, textAlign: 'right', fontWeight: 700 }}>{v.amount.toFixed(2)}</td>
                  <td style={{ ...cell, textAlign: 'right', color: '#7C7063' }}>
                    {revenueTotal > 0 ? ((v.amount / revenueTotal) * 100).toFixed(1) : '0.0'}%
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td style={{ ...cell, fontWeight: 700, borderTop: '2px solid #221A13', borderBottom: 'none' }}>Total</td>
                <td style={{ ...cell, textAlign: 'right', fontWeight: 700, borderTop: '2px solid #221A13', borderBottom: 'none' }}>
                  {payments.length}
                </td>
                <td style={{ ...cell, textAlign: 'right', fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 13, borderTop: '2px solid #221A13', borderBottom: 'none' }}>
                  {revenueTotal.toFixed(2)}
                </td>
                <td style={{ ...cell, borderTop: '2px solid #221A13', borderBottom: 'none' }} />
              </tr>
            </tfoot>
          </table>
        </>
      )}

      {topCustomers.length > 0 && (
        <>
          <p style={{ fontSize: 11, fontWeight: 700, color: '#7C7063', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 6 }}>
            Top Customers by Payment
          </p>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 8 }}>
            <thead>
              <tr>
                <th style={hdr}>#</th>
                <th style={hdr}>Customer</th>
                <th style={hdr}>Code</th>
                <th style={{ ...hdr, textAlign: 'right' }}>Total Paid ({settings.currency})</th>
              </tr>
            </thead>
            <tbody>
              {topCustomers.map((c, i) => (
                <tr key={i}>
                  <td style={{ ...cell, color: '#7C7063' }}>{i + 1}</td>
                  <td style={{ ...cell, fontWeight: 600 }}>{c.name}</td>
                  <td style={{ ...cell, color: '#7C7063' }}>{c.code}</td>
                  <td style={{ ...cell, textAlign: 'right', fontWeight: 700 }}>{c.total.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* 2. SUBSCRIPTIONS                                                       */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <p style={sectionTitle}>2. Subscriptions</p>

      <div style={kpiGrid}>
        <KPI label="Monthly Recurring Revenue" value={`${settings.currency} ${mrr.toFixed(2)}`} />
        <KPI label="Active" value={String(activeSubs.length)} />
        <KPI label="Paused" value={String(pausedSubs.length)} />
        <KPI label="Cancelled" value={String(cancelledSubs.length)} />
      </div>

      {subsByPlan.length > 0 && (
        <>
          <p style={{ fontSize: 11, fontWeight: 700, color: '#7C7063', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 6 }}>
            Active Subscriptions by Plan
          </p>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 8 }}>
            <thead>
              <tr>
                <th style={hdr}>Plan</th>
                <th style={{ ...hdr, textAlign: 'right' }}>Customers</th>
                <th style={{ ...hdr, textAlign: 'right' }}>MRR ({settings.currency})</th>
                <th style={{ ...hdr, textAlign: 'right' }}>Avg Price</th>
              </tr>
            </thead>
            <tbody>
              {subsByPlan.map(p => (
                <tr key={p.plan}>
                  <td style={{ ...cell, fontWeight: 600 }}>{p.plan}</td>
                  <td style={{ ...cell, textAlign: 'right' }}>{p.count}</td>
                  <td style={{ ...cell, textAlign: 'right', fontWeight: 700 }}>{p.mrr.toFixed(2)}</td>
                  <td style={{ ...cell, textAlign: 'right', color: '#7C7063' }}>
                    {p.count > 0 ? (p.mrr / p.count).toFixed(2) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td style={{ ...cell, fontWeight: 700, borderTop: '2px solid #221A13', borderBottom: 'none' }}>Total</td>
                <td style={{ ...cell, textAlign: 'right', fontWeight: 700, borderTop: '2px solid #221A13', borderBottom: 'none' }}>
                  {activeSubs.length}
                </td>
                <td style={{ ...cell, textAlign: 'right', fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 13, borderTop: '2px solid #221A13', borderBottom: 'none' }}>
                  {mrr.toFixed(2)}
                </td>
                <td style={{ ...cell, borderTop: '2px solid #221A13', borderBottom: 'none' }} />
              </tr>
            </tfoot>
          </table>
        </>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* 3. CUSTOMERS                                                           */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <p style={sectionTitle}>3. Customers</p>

      <div style={kpiGrid}>
        <KPI label="Total Customers" value={String(customers.length)} />
        <KPI label="New in Period" value={String(newCustomers?.length ?? 0)} />
        <KPI label="Active" value={String(byStatus.find(s => s.status === 'active')?.count ?? 0)} />
        <KPI label="Paused" value={String(byStatus.find(s => s.status === 'paused')?.count ?? 0)} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 16 }}>
        <div>
          <p style={{ fontSize: 11, fontWeight: 700, color: '#7C7063', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 6 }}>
            By Status
          </p>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={hdr}>Status</th><th style={{ ...hdr, textAlign: 'right' }}>Count</th></tr></thead>
            <tbody>
              {byStatus.map(s => (
                <tr key={s.status}>
                  <td style={cell}>{STATUS_LABELS[s.status] ?? s.status}</td>
                  <td style={{ ...cell, textAlign: 'right', fontWeight: 700 }}>{s.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div>
          <p style={{ fontSize: 11, fontWeight: 700, color: '#7C7063', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 6 }}>
            By Type
          </p>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={hdr}>Type</th><th style={{ ...hdr, textAlign: 'right' }}>Count</th></tr></thead>
            <tbody>
              {byType.map(t => (
                <tr key={t.type}>
                  <td style={cell}>{TYPE_LABELS[t.type] ?? t.type}</td>
                  <td style={{ ...cell, textAlign: 'right', fontWeight: 700 }}>{t.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {byArea.length > 0 && (
        <>
          <p style={{ fontSize: 11, fontWeight: 700, color: '#7C7063', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 6 }}>
            By Area
          </p>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 8 }}>
            <thead>
              <tr>
                <th style={hdr}>Area</th>
                <th style={{ ...hdr, textAlign: 'right' }}>Customers</th>
                <th style={{ ...hdr, textAlign: 'right' }}>Share %</th>
              </tr>
            </thead>
            <tbody>
              {byArea.map(a => (
                <tr key={a.area}>
                  <td style={cell}>{a.area}</td>
                  <td style={{ ...cell, textAlign: 'right', fontWeight: 700 }}>{a.count}</td>
                  <td style={{ ...cell, textAlign: 'right', color: '#7C7063' }}>
                    {customers.length > 0 ? ((a.count / customers.length) * 100).toFixed(1) : '0.0'}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* 4. OUTSTANDING BALANCES                                                */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <p style={sectionTitle}>4. Outstanding Balances (Current Month)</p>

      <div style={kpiGrid}>
        <KPI label="Total Outstanding" value={`${settings.currency} ${totalOutstanding.toFixed(2)}`} />
        <KPI label="Customers with Balance" value={String(balanceRows.length)} />
        <KPI label="Average Balance" value={balanceRows.length ? `${settings.currency} ${(totalOutstanding / balanceRows.length).toFixed(2)}` : '—'} />
      </div>

      {balanceRows.length === 0 ? (
        <p style={{ color: '#7C7063', fontSize: 12, marginBottom: 8 }}>All subscriptions are fully settled this month.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 8 }}>
          <thead>
            <tr>
              <th style={hdr}>#</th>
              <th style={hdr}>Customer</th>
              <th style={hdr}>Code</th>
              <th style={{ ...hdr, textAlign: 'right' }}>Plan ({settings.currency})</th>
              <th style={{ ...hdr, textAlign: 'right' }}>Paid ({settings.currency})</th>
              <th style={{ ...hdr, textAlign: 'right' }}>Balance Due ({settings.currency})</th>
            </tr>
          </thead>
          <tbody>
            {balanceRows.map((r, i) => (
              <tr key={i}>
                <td style={{ ...cell, color: '#7C7063' }}>{i + 1}</td>
                <td style={{ ...cell, fontWeight: 600 }}>{r.full_name}</td>
                <td style={{ ...cell, color: '#7C7063' }}>{r.customer_code}</td>
                <td style={{ ...cell, textAlign: 'right' }}>{r.monthlyCharge.toFixed(2)}</td>
                <td style={{ ...cell, textAlign: 'right' }}>{r.monthPaid.toFixed(2)}</td>
                <td style={{ ...cell, textAlign: 'right', fontWeight: 800, color: '#C0392B' }}>
                  {r.balance.toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={5} style={{ ...cell, fontWeight: 700, borderTop: '2px solid #221A13', borderBottom: 'none' }}>
                Total Outstanding
              </td>
              <td style={{ ...cell, textAlign: 'right', fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 13, color: '#C0392B', borderTop: '2px solid #221A13', borderBottom: 'none' }}>
                {totalOutstanding.toFixed(2)}
              </td>
            </tr>
          </tfoot>
        </table>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* 5. ORDERS                                                              */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <p style={sectionTitle}>5. Orders</p>

      <div style={kpiGrid}>
        <KPI label="Total Orders" value={String(orders.length)} />
        <KPI label="Breakfast" value={String(ordersByPeriod[0].count)} />
        <KPI label="Lunch" value={String(ordersByPeriod[1].count)} />
        <KPI label="Dinner" value={String(ordersByPeriod[2].count)} />
      </div>

      <p style={{ fontSize: 11, fontWeight: 700, color: '#7C7063', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 6 }}>
        By Meal Period
      </p>
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 16 }}>
        <thead>
          <tr>
            <th style={hdr}>Meal Period</th>
            <th style={{ ...hdr, textAlign: 'right' }}>Orders</th>
            <th style={{ ...hdr, textAlign: 'right' }}>Revenue ({settings.currency})</th>
          </tr>
        </thead>
        <tbody>
          {ordersByPeriod.map(p => (
            <tr key={p.period}>
              <td style={cell}>{p.period.charAt(0).toUpperCase() + p.period.slice(1)}</td>
              <td style={{ ...cell, textAlign: 'right', fontWeight: 700 }}>{p.count}</td>
              <td style={{ ...cell, textAlign: 'right' }}>{p.revenue.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td style={{ ...cell, fontWeight: 700, borderTop: '2px solid #221A13', borderBottom: 'none' }}>Total</td>
            <td style={{ ...cell, textAlign: 'right', fontWeight: 700, borderTop: '2px solid #221A13', borderBottom: 'none' }}>
              {orders.length}
            </td>
            <td style={{ ...cell, textAlign: 'right', fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 13, borderTop: '2px solid #221A13', borderBottom: 'none' }}>
              {ordersByPeriod.reduce((s, p) => s + p.revenue, 0).toFixed(2)}
            </td>
          </tr>
        </tfoot>
      </table>

      {topItems.length > 0 && (
        <>
          <p style={{ fontSize: 11, fontWeight: 700, color: '#7C7063', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 6 }}>
            Top Items by Quantity
          </p>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 8 }}>
            <thead>
              <tr>
                <th style={hdr}>#</th>
                <th style={hdr}>Item</th>
                <th style={{ ...hdr, textAlign: 'right' }}>Qty</th>
                <th style={{ ...hdr, textAlign: 'right' }}>Revenue ({settings.currency})</th>
              </tr>
            </thead>
            <tbody>
              {topItems.map((item, i) => (
                <tr key={i}>
                  <td style={{ ...cell, color: '#7C7063' }}>{i + 1}</td>
                  <td style={{ ...cell, fontWeight: 600 }}>{item.name}</td>
                  <td style={{ ...cell, textAlign: 'right', fontWeight: 700 }}>{item.qty}</td>
                  <td style={{ ...cell, textAlign: 'right' }}>{item.revenue.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {/* ── Signature ── */}
      <div style={{ marginTop: 40, display: 'flex', justifyContent: 'space-between', paddingTop: 20, borderTop: '1px solid #ECE2D3' }}>
        <div>
          <div style={{ borderTop: '1px solid #221A13', width: 180, paddingTop: 4 }}>
            <p style={{ fontSize: 11, color: '#7C7063' }}>Authorized Signature</p>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <p style={{ fontSize: 11, color: '#7C7063' }}>{settings.business_name} · Dubai</p>
        </div>
      </div>
    </div>
  )
}
