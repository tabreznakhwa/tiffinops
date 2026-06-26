'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { useAppSettings } from '@/components/settings/settings-context'

// ── Types ─────────────────────────────────────────────────────────────────────

export type ReportData = {
  range: { from: string; to: string; days: number }
  revenue: {
    total: number
    count: number
    prevTotal: number
    byDay: { date: string; amount: number }[]
    byMode: { mode: string; label: string; amount: number; count: number }[]
    topCustomers: { id: string; name: string; code: string; total: number }[]
  }
  customers: {
    total: number
    newInRange: number
    byStatus: { status: string; count: number }[]
    byType:   { type: string; label: string; count: number }[]
    byArea:   { area: string; count: number }[]
    topCustomers: { id: string; name: string; code: string; total: number }[]
  }
  subscriptions: {
    active: number; paused: number; cancelled: number; completed: number
    mrr: number
    byPlan: { plan_name: string; count: number; mrr: number }[]
    recentSubs: { full_name: string; customer_code: string; plan_name: string; start_date: string; price: number }[]
  }
  balances: {
    totalOutstanding: number
    rows: { id: string; full_name: string; customer_code: string; monthlyCharge: number; monthPaid: number; balance: number }[]
  }
  orders: {
    total: number
    byDay:    { date: string; count: number }[]
    byPeriod: { period: string; count: number; revenue: number }[]
    topItems: { name: string; qty: number; revenue: number }[]
  }
}

// ── Color palette ─────────────────────────────────────────────────────────────

const C = {
  saffron: '#E76F2A', ember: '#8B2E1F', green: '#2E7D4F',
  blue: '#2C5E8F', purple: '#6B3FA0', gold: '#B7860B',
  red: '#C0392B', muted: '#7C7063', ink: '#221A13',
}
const PIE_COLORS = [C.saffron, C.blue, C.purple, C.green, C.gold, C.ember, C.red]
const STATUS_COLORS: Record<string, string> = {
  active: C.green, paused: C.gold, inactive: C.muted, blacklisted: C.red,
}
const TYPE_COLORS: Record<string, string> = {
  fixed_menu: C.purple, a_la_carte: C.saffron, hybrid: C.blue,
}

// ── Helper components ─────────────────────────────────────────────────────────

function KPICard({
  label, value, sub, color = C.ink, trend,
}: {
  label: string; value: string; sub?: string; color?: string; trend?: 'up' | 'down' | 'flat'
}) {
  return (
    <div
      className="rounded-[14px] px-4 py-4 relative overflow-hidden"
      style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}
    >
      <div className="absolute left-0 top-0 bottom-0 w-[3px]" style={{ background: color }} />
      <p className="text-[11px] font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--color-muted)' }}>{label}</p>
      <div className="flex items-end gap-2">
        <p className="font-display font-extrabold text-[24px] num leading-none" style={{ color }}>
          {value}
        </p>
        {trend && (
          <span className="mb-0.5">
            {trend === 'up'   && <TrendingUp  size={16} style={{ color: C.green }} />}
            {trend === 'down' && <TrendingDown size={16} style={{ color: C.red   }} />}
            {trend === 'flat' && <Minus        size={16} style={{ color: C.muted }} />}
          </span>
        )}
      </div>
      {sub && <p className="text-[11px] mt-0.5" style={{ color: 'var(--color-muted)' }}>{sub}</p>}
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-bold uppercase tracking-wide mb-3" style={{ color: 'var(--color-muted)' }}>
      {children}
    </p>
  )
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-[14px] p-4 ${className}`}
      style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}
    >
      {children}
    </div>
  )
}

function fmtCurrency(n: number, currency: string) { return `${currency} ${n.toFixed(2)}` }
function fmtDate(d: string) {
  return new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: { value: number; name?: string }[]; label?: string }) => {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-[10px] px-3 py-2 text-sm shadow-lg" style={{ background: '#221A13', color: '#fff' }}>
      <p className="font-semibold mb-1">{label}</p>
      {payload.map((p, i) => (
        <p key={i} className="num">{p.name ? `${p.name}: ` : ''}{typeof p.value === 'number' ? p.value.toFixed(2) : p.value}</p>
      ))}
    </div>
  )
}

// ── Tab: Revenue ──────────────────────────────────────────────────────────────

function RevenueTab({ data }: { data: ReportData }) {
  const { currency } = useAppSettings()
  const fmtAED = (n: number) => fmtCurrency(n, currency)
  const { revenue, range } = data
  const avgDaily = range.days > 0 ? revenue.total / range.days : 0
  const pctChange = revenue.prevTotal > 0
    ? ((revenue.total - revenue.prevTotal) / revenue.prevTotal) * 100 : null
  const trend = pctChange === null ? undefined : pctChange > 5 ? 'up' : pctChange < -5 ? 'down' : 'flat'

  return (
    <div className="space-y-5">
      {/* KPIs */}
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
        <KPICard label="Total Collected" value={fmtAED(revenue.total)} color={C.saffron}
          sub={pctChange !== null ? `${pctChange > 0 ? '+' : ''}${pctChange.toFixed(1)}% vs prev period` : undefined}
          trend={trend} />
        <KPICard label="Payments" value={String(revenue.count)} color={C.blue}
          sub={`${currency} ${(revenue.count > 0 ? revenue.total / revenue.count : 0).toFixed(2)} avg`} />
        <KPICard label="Daily Average" value={fmtAED(avgDaily)} color={C.green} />
        <KPICard label="Prev Period" value={fmtAED(revenue.prevTotal)} color={C.muted} />
      </div>

      {/* Daily revenue chart */}
      {revenue.byDay.length > 0 && (
        <Card>
          <SectionTitle>Daily Revenue ({currency})</SectionTitle>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={revenue.byDay} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#ECE2D3" />
              <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fontSize: 11, fill: C.muted }} />
              <YAxis tick={{ fontSize: 11, fill: C.muted }} width={55} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="amount" name="Revenue" fill={C.saffron} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {/* By mode pie */}
        {revenue.byMode.length > 0 && (
          <Card>
            <SectionTitle>Revenue by Payment Mode</SectionTitle>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={revenue.byMode} dataKey="amount" nameKey="label" cx="50%" cy="50%"
                  innerRadius={50} outerRadius={80}
                  label={(props: { name?: string; percent?: number }) => `${props.name ?? ''} ${((props.percent ?? 0) * 100).toFixed(0)}%`}
                  labelLine={false} fontSize={11}>
                  {revenue.byMode.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
            <div className="mt-2 space-y-1.5">
              {revenue.byMode.map((m, i) => (
                <div key={m.mode} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                    <span style={{ color: 'var(--color-ink)' }}>{m.label}</span>
                    <span style={{ color: 'var(--color-muted)' }}>({m.count})</span>
                  </div>
                  <span className="num font-semibold" style={{ color: 'var(--color-ink)' }}>{fmtAED(m.amount)}</span>
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* Top customers */}
        {revenue.topCustomers.length > 0 && (
          <Card>
            <SectionTitle>Top Customers by Payments</SectionTitle>
            <div className="space-y-2">
              {revenue.topCustomers.slice(0, 8).map((c, i) => {
                const pct = revenue.total > 0 ? (c.total / revenue.total) * 100 : 0
                return (
                  <div key={c.id}>
                    <div className="flex justify-between text-xs mb-0.5">
                      <span style={{ color: 'var(--color-ink)' }}>
                        <span className="font-semibold">{c.name}</span>
                        <span style={{ color: 'var(--color-muted)' }}> · {c.code}</span>
                      </span>
                      <span className="num font-bold" style={{ color: C.saffron }}>{fmtAED(c.total)}</span>
                    </div>
                    <div className="h-1.5 rounded-full" style={{ background: 'var(--color-border)' }}>
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: C.saffron }} />
                    </div>
                  </div>
                )
              })}
            </div>
          </Card>
        )}
      </div>
    </div>
  )
}

// ── Tab: Subscriptions ────────────────────────────────────────────────────────

function SubscriptionsTab({ data }: { data: ReportData }) {
  const { currency } = useAppSettings()
  const { subscriptions: s } = data

  return (
    <div className="space-y-5">
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
        <KPICard label="Monthly Recurring Revenue" value={`${currency} ${s.mrr.toFixed(2)}`} color={C.purple} />
        <KPICard label="Active Subscriptions" value={String(s.active)} color={C.green} />
        <KPICard label="Paused" value={String(s.paused)} color={C.gold} />
        <KPICard label="Cancelled" value={String(s.cancelled)} color={C.red} />
        <KPICard label="Completed" value={String(s.completed)} color={C.muted} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* By plan */}
        {s.byPlan.length > 0 && (
          <Card>
            <SectionTitle>Active Subscriptions by Plan</SectionTitle>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={s.byPlan} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#ECE2D3" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11, fill: C.muted }} />
                <YAxis dataKey="plan_name" type="category" tick={{ fontSize: 11, fill: C.muted }} width={100} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="mrr" name={`MRR (${currency})`} fill={C.purple} radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <div className="mt-3 space-y-1.5">
              {s.byPlan.map(p => (
                <div key={p.plan_name} className="flex justify-between text-xs">
                  <span style={{ color: 'var(--color-ink)' }}>{p.plan_name} <span style={{ color: 'var(--color-muted)' }}>({p.count} active)</span></span>
                  <span className="num font-bold" style={{ color: C.purple }}>{currency} {p.mrr.toFixed(2)}/mo</span>
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* Recently started */}
        <Card>
          <SectionTitle>Subscriptions Started in Range</SectionTitle>
          {s.recentSubs.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--color-muted)' }}>No new subscriptions in this period.</p>
          ) : (
            <div className="space-y-2">
              {s.recentSubs.map((sub, i) => (
                <div key={i} className="flex justify-between text-xs py-1.5" style={{ borderBottom: i < s.recentSubs.length - 1 ? '1px solid var(--color-border)' : 'none' }}>
                  <div>
                    <p className="font-semibold" style={{ color: 'var(--color-ink)' }}>{sub.full_name}</p>
                    <p style={{ color: 'var(--color-muted)' }}>{sub.customer_code} · {sub.plan_name} · {fmtDate(sub.start_date)}</p>
                  </div>
                  <span className="num font-bold" style={{ color: C.purple }}>{currency} {sub.price.toFixed(2)}/mo</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}

// ── Tab: Customers ────────────────────────────────────────────────────────────

function CustomersTab({ data }: { data: ReportData }) {
  const { currency } = useAppSettings()
  const fmtAED = (n: number) => fmtCurrency(n, currency)
  const { customers: c } = data
  const active = c.byStatus.find(s => s.status === 'active')?.count ?? 0

  return (
    <div className="space-y-5">
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
        <KPICard label="Total Customers" value={String(c.total)} color={C.blue} />
        <KPICard label="Active" value={String(active)} color={C.green} />
        <KPICard label="New in Range" value={String(c.newInRange)} color={C.saffron}
          sub="joined during selected period" />
        <KPICard label="Paused / Inactive" value={String((c.byStatus.find(s => s.status === 'paused')?.count ?? 0) + (c.byStatus.find(s => s.status === 'inactive')?.count ?? 0))} color={C.muted} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* By type */}
        <Card>
          <SectionTitle>Customers by Plan Type</SectionTitle>
          <ResponsiveContainer width="100%" height={180}>
            <PieChart>
              <Pie data={c.byType.filter(t => t.count > 0)} dataKey="count" nameKey="label"
                cx="50%" cy="50%" outerRadius={70}
                label={(props: { name?: string; percent?: number }) => `${props.name ?? ''} ${((props.percent ?? 0) * 100).toFixed(0)}%`}
                labelLine={false} fontSize={11}>
                {c.byType.map(t => (
                  <Cell key={t.type} fill={TYPE_COLORS[t.type] ?? C.muted} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
          <div className="mt-2 space-y-1.5">
            {c.byType.map(t => (
              <div key={t.type} className="flex justify-between text-xs">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-sm" style={{ background: TYPE_COLORS[t.type] ?? C.muted }} />
                  <span style={{ color: 'var(--color-ink)' }}>{t.label}</span>
                </div>
                <span className="font-bold" style={{ color: 'var(--color-ink)' }}>{t.count}</span>
              </div>
            ))}
          </div>
        </Card>

        {/* By status */}
        <Card>
          <SectionTitle>Customers by Status</SectionTitle>
          <div className="space-y-3 mt-2">
            {c.byStatus.filter(s => s.count > 0).map(s => {
              const pct = c.total > 0 ? (s.count / c.total) * 100 : 0
              const col = STATUS_COLORS[s.status] ?? C.muted
              return (
                <div key={s.status}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="font-semibold capitalize" style={{ color: 'var(--color-ink)' }}>{s.status}</span>
                    <span className="font-bold" style={{ color: col }}>{s.count} ({pct.toFixed(0)}%)</span>
                  </div>
                  <div className="h-2 rounded-full" style={{ background: 'var(--color-border)' }}>
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: col }} />
                  </div>
                </div>
              )
            })}
          </div>

          {c.byArea.length > 0 && (
            <div className="mt-4 pt-4" style={{ borderTop: '1px solid var(--color-border)' }}>
              <SectionTitle>By Area</SectionTitle>
              <div className="space-y-1.5">
                {c.byArea.slice(0, 6).map(a => (
                  <div key={a.area} className="flex justify-between text-xs">
                    <span style={{ color: 'var(--color-ink)' }}>{a.area}</span>
                    <span className="font-bold" style={{ color: 'var(--color-ink)' }}>{a.count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* Top customers table */}
      {c.topCustomers.length > 0 && (
        <Card>
          <SectionTitle>Top Customers by Payments Received (Selected Period)</SectionTitle>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--color-border)' }}>
                <th style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--color-muted)', fontWeight: 700, fontSize: 10, textTransform: 'uppercase', letterSpacing: '.06em' }}>#</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--color-muted)', fontWeight: 700, fontSize: 10, textTransform: 'uppercase', letterSpacing: '.06em' }}>Customer</th>
                <th style={{ textAlign: 'right', padding: '6px 8px', color: 'var(--color-muted)', fontWeight: 700, fontSize: 10, textTransform: 'uppercase', letterSpacing: '.06em' }}>Paid</th>
              </tr>
            </thead>
            <tbody>
              {c.topCustomers.map((cust, i) => (
                <tr key={cust.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <td style={{ padding: '7px 8px', color: 'var(--color-muted)', fontWeight: 700 }}>{i + 1}</td>
                  <td style={{ padding: '7px 8px' }}>
                    <span style={{ fontWeight: 600, color: 'var(--color-ink)' }}>{cust.name}</span>
                    <span style={{ color: 'var(--color-muted)', marginLeft: 6 }}>{cust.code}</span>
                  </td>
                  <td style={{ padding: '7px 8px', textAlign: 'right', fontWeight: 700, color: C.saffron }}>{fmtAED(cust.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}

// ── Tab: Outstanding Balances ─────────────────────────────────────────────────

function BalancesTab({ data }: { data: ReportData }) {
  const { currency } = useAppSettings()
  const { balances } = data

  return (
    <div className="space-y-5">
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
        <KPICard label="Total Outstanding (This Month)" value={`${currency} ${balances.totalOutstanding.toFixed(2)}`} color={C.red} />
        <KPICard label="Customers with Balance Due" value={String(balances.rows.length)} color={C.ember} />
        <KPICard label="Avg Balance per Customer" value={`${currency} ${(balances.rows.length > 0 ? balances.totalOutstanding / balances.rows.length : 0).toFixed(2)}`} color={C.gold} />
      </div>

      {balances.rows.length === 0 ? (
        <Card>
          <div className="py-8 text-center">
            <p className="font-bold text-[15px] mb-1" style={{ color: C.green }}>All clear!</p>
            <p className="text-sm" style={{ color: 'var(--color-muted)' }}>No outstanding balances for active subscriptions this month.</p>
          </div>
        </Card>
      ) : (
        <Card>
          <SectionTitle>Customers with Outstanding Balance — Current Month</SectionTitle>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--color-border)' }}>
                {['Customer', 'Monthly Plan', 'Paid', 'Balance Due'].map((h, i) => (
                  <th key={h} style={{ textAlign: i > 0 ? 'right' : 'left', padding: '6px 8px', color: 'var(--color-muted)', fontWeight: 700, fontSize: 10, textTransform: 'uppercase', letterSpacing: '.06em' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {balances.rows.map((r, i) => (
                <tr key={r.id} style={{ borderBottom: '1px solid var(--color-border)', background: i % 2 === 0 ? 'transparent' : 'var(--color-cream)' }}>
                  <td style={{ padding: '8px 8px' }}>
                    <p style={{ fontWeight: 600, color: 'var(--color-ink)' }}>{r.full_name}</p>
                    <p style={{ fontSize: 11, color: 'var(--color-muted)' }}>{r.customer_code}</p>
                  </td>
                  <td style={{ padding: '8px 8px', textAlign: 'right', color: 'var(--color-ink)' }}>{currency} {r.monthlyCharge.toFixed(2)}</td>
                  <td style={{ padding: '8px 8px', textAlign: 'right', color: C.green }}>{currency} {r.monthPaid.toFixed(2)}</td>
                  <td style={{ padding: '8px 8px', textAlign: 'right', fontWeight: 700, color: C.red }}>{currency} {r.balance.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: '2px solid var(--color-ink)' }}>
                <td colSpan={3} style={{ padding: '8px 8px', fontWeight: 700, color: 'var(--color-ink)' }}>Total Outstanding</td>
                <td style={{ padding: '8px 8px', textAlign: 'right', fontWeight: 800, fontSize: 15, color: C.red }}>{currency} {balances.totalOutstanding.toFixed(2)}</td>
              </tr>
            </tfoot>
          </table>
        </Card>
      )}
    </div>
  )
}

// ── Tab: Orders ───────────────────────────────────────────────────────────────

function OrdersTab({ data }: { data: ReportData }) {
  const { currency } = useAppSettings()
  const { orders } = data

  return (
    <div className="space-y-5">
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
        <KPICard label="Total Orders" value={String(orders.total)} color={C.saffron} />
        {orders.byPeriod.map(p => (
          <KPICard key={p.period} label={p.period} value={String(p.count)} color={C.blue}
            sub={`${currency} ${p.revenue.toFixed(2)}`} />
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Orders by day */}
        {orders.byDay.length > 0 && (
          <Card>
            <SectionTitle>Orders Per Day</SectionTitle>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={orders.byDay} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#ECE2D3" />
                <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fontSize: 10, fill: C.muted }} />
                <YAxis tick={{ fontSize: 11, fill: C.muted }} allowDecimals={false} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="count" name="Orders" fill={C.blue} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        )}

        {/* By meal period */}
        <Card>
          <SectionTitle>By Meal Period</SectionTitle>
          <div className="space-y-3 mt-2">
            {orders.byPeriod.map(p => {
              const pct = orders.total > 0 ? (p.count / orders.total) * 100 : 0
              const col = p.period === 'Breakfast' ? C.gold : p.period === 'Lunch' ? C.saffron : C.blue
              return (
                <div key={p.period}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="font-semibold" style={{ color: 'var(--color-ink)' }}>{p.period}</span>
                    <span className="font-bold" style={{ color: col }}>{p.count} orders · {currency} {p.revenue.toFixed(2)}</span>
                  </div>
                  <div className="h-2 rounded-full" style={{ background: 'var(--color-border)' }}>
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: col }} />
                  </div>
                </div>
              )
            })}
          </div>
        </Card>
      </div>

      {/* Top items */}
      {orders.topItems.length > 0 && (
        <Card>
          <SectionTitle>Top Menu Items by Quantity Ordered</SectionTitle>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={orders.topItems.slice(0, 8)} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#ECE2D3" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: C.muted }} allowDecimals={false} />
                  <YAxis dataKey="name" type="category" tick={{ fontSize: 10, fill: C.muted }} width={110} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="qty" name="Qty" fill={C.green} radius={[0, 3, 3, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="space-y-1.5">
              {orders.topItems.slice(0, 10).map((item, i) => (
                <div key={item.name} className="flex justify-between text-xs py-1.5" style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-bold w-5 flex-shrink-0" style={{ color: 'var(--color-muted)' }}>{i + 1}</span>
                    <span className="truncate" style={{ color: 'var(--color-ink)', fontWeight: 500 }}>{item.name}</span>
                  </div>
                  <div className="flex gap-3 flex-shrink-0">
                    <span className="font-bold" style={{ color: C.green }}>{item.qty} qty</span>
                    <span className="num" style={{ color: 'var(--color-muted)' }}>{currency} {item.revenue.toFixed(2)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Card>
      )}
    </div>
  )
}

// ── Main Reports Module ───────────────────────────────────────────────────────

const TABS = [
  { id: 'revenue',       label: 'Revenue'       },
  { id: 'subscriptions', label: 'Subscriptions' },
  { id: 'customers',     label: 'Customers'     },
  { id: 'balances',      label: 'Balances'      },
  { id: 'orders',        label: 'Orders'        },
] as const

type TabId = typeof TABS[number]['id']

export function ReportsModule({ data, initialTab }: { data: ReportData; initialTab: string }) {
  const router      = useRouter()
  const searchParams = useSearchParams()
  const [tab, setTab] = useState<TabId>(TABS.some(t => t.id === initialTab) ? initialTab as TabId : 'revenue')
  const [from, setFrom] = useState(data.range.from)
  const [to, setTo]     = useState(data.range.to)

  function applyDateRange() {
    const params = new URLSearchParams(searchParams.toString())
    params.set('from', from)
    params.set('to', to)
    params.set('tab', tab)
    router.push(`/reports?${params.toString()}`)
  }

  function switchTab(t: TabId) {
    setTab(t)
    const params = new URLSearchParams(searchParams.toString())
    params.set('tab', t)
    router.replace(`/reports?${params.toString()}`, { scroll: false })
  }

  function setQuickRange(days: number) {
    const t = new Date()
    const f = new Date(t.getTime() - (days - 1) * 86400000)
    const toStr   = t.toISOString().split('T')[0]
    const fromStr = f.toISOString().split('T')[0]
    setFrom(fromStr); setTo(toStr)
    const params = new URLSearchParams(searchParams.toString())
    params.set('from', fromStr); params.set('to', toStr); params.set('tab', tab)
    router.push(`/reports?${params.toString()}`)
  }

  function setThisMonth() {
    const now = new Date()
    const ms  = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
    const ts  = now.toISOString().split('T')[0]
    setFrom(ms); setTo(ts)
    const params = new URLSearchParams(searchParams.toString())
    params.set('from', ms); params.set('to', ts); params.set('tab', tab)
    router.push(`/reports?${params.toString()}`)
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-5">
        <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--color-saffron)', letterSpacing: '.12em' }}>
          Analytics
        </p>
        <h1 className="font-display font-bold text-[25px] mt-0.5" style={{ color: 'var(--color-ink)' }}>
          Reports
        </h1>
      </div>

      {/* Date range picker */}
      <div
        className="flex flex-wrap items-center gap-2 px-4 py-3 rounded-[12px] mb-5"
        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
      >
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={from}
            onChange={e => setFrom(e.target.value)}
            className="rounded-[8px] px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-saffron"
            style={{ background: 'var(--color-cream)', border: '1px solid var(--color-border)', color: 'var(--color-ink)' }}
          />
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>to</span>
          <input
            type="date"
            value={to}
            onChange={e => setTo(e.target.value)}
            className="rounded-[8px] px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-saffron"
            style={{ background: 'var(--color-cream)', border: '1px solid var(--color-border)', color: 'var(--color-ink)' }}
          />
          <button
            onClick={applyDateRange}
            className="px-3 py-1.5 rounded-[8px] text-xs font-bold"
            style={{ background: 'var(--color-saffron)', color: '#fff' }}
          >
            Apply
          </button>
        </div>
        <div className="flex gap-1.5 ml-1">
          {[7, 30, 90].map(d => (
            <button key={d}
              onClick={() => setQuickRange(d)}
              className="px-2.5 py-1 rounded-[7px] text-[11px] font-bold"
              style={{ background: 'var(--color-border)', color: 'var(--color-muted)' }}
            >
              {d}d
            </button>
          ))}
          <button
            onClick={setThisMonth}
            className="px-2.5 py-1 rounded-[7px] text-[11px] font-bold"
            style={{ background: 'var(--color-border)', color: 'var(--color-muted)' }}
          >
            This Month
          </button>
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <span className="text-[11px]" style={{ color: 'var(--color-muted)' }}>
            {data.range.days} day{data.range.days !== 1 ? 's' : ''}
          </span>
          <button
            onClick={() => window.open('/print/outstanding', '_blank')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-xs font-bold"
            style={{ background: '#C0392B', color: '#fff' }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            Outstanding Report
          </button>
          <button
            onClick={() => window.open(`/print/reports?from=${from}&to=${to}`, '_blank')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-xs font-bold"
            style={{ background: '#8B2E1F', color: '#fff' }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 6 2 18 2 18 9" />
              <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
              <rect x="6" y="14" width="12" height="8" />
            </svg>
            Print PDF
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-0.5 mb-5 overflow-x-auto" style={{ borderBottom: '2px solid var(--color-border)' }}>
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => switchTab(t.id)}
            className="whitespace-nowrap px-4 py-2.5 text-sm font-semibold border-b-[2.5px] -mb-[2px]"
            style={{
              color:        tab === t.id ? 'var(--color-ink)'     : 'var(--color-muted)',
              borderColor:  tab === t.id ? 'var(--color-saffron)' : 'transparent',
              background:   'transparent',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'revenue'       && <RevenueTab       data={data} />}
      {tab === 'subscriptions' && <SubscriptionsTab data={data} />}
      {tab === 'customers'     && <CustomersTab     data={data} />}
      {tab === 'balances'      && <BalancesTab      data={data} />}
      {tab === 'orders'        && <OrdersTab        data={data} />}
    </div>
  )
}
