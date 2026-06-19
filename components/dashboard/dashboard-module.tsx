'use client'

import Link from 'next/link'
import Image from 'next/image'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts'
import { TrendingUp, TrendingDown, AlertCircle } from 'lucide-react'
import { useAppSettings } from '@/components/settings/settings-context'

// ── Types ─────────────────────────────────────────────────────────────────────

export type DashboardData = {
  userName: string
  todayRevenue: number
  monthRevenue: number
  lastMonthRevenue: number
  mrr: number
  activeCustomers: number
  pausedCustomers: number
  totalCustomers: number
  newCustomersMonth: number
  activeSubscriptions: number
  ordersToday: number
  ordersByPeriod: { breakfast: number; lunch: number; dinner: number }
  totalOutstanding: number
  pendingApprovals: number
  rev30d: { date: string; amount: number }[]
  topBalances: { full_name: string; customer_code: string; monthlyCharge: number; monthPaid: number; balance: number }[]
  recentPayments: { id: string; payment_number: string; payment_date: string; amount: string; mode: string; voided_at: string | null; customers: { full_name: string; customer_code: string } | null }[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const C = {
  saffron: '#E76F2A', ember: '#8B2E1F', green: '#2E7D4F',
  blue: '#2C5E8F', purple: '#6B3FA0', gold: '#B7860B',
  red: '#C0392B', muted: '#7C7063', ink: '#221A13',
}

const MODE_COLORS: Record<string, string> = {
  cash: C.green, bank_transfer: C.purple, card: C.blue,
  online: C.saffron, cheque: C.gold, wallet: C.ember, other: C.muted,
}
const MODE_LABELS: Record<string, string> = {
  cash: 'Cash', bank_transfer: 'Bank Transfer', card: 'Card',
  online: 'Online', cheque: 'Cheque', wallet: 'Wallet', other: 'Other',
}

function fmtDate(d: string) {
  return new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function fmtShortDate(d: string) {
  const dt = new Date(d + 'T00:00:00Z')
  return `${dt.getDate()} ${dt.toLocaleString('en', { month: 'short' })}`
}

const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: { value: number }[]; label?: string }) => {
  const { currency } = useAppSettings()
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-[10px] px-3 py-2 text-sm shadow-lg" style={{ background: '#221A13', color: '#fff' }}>
      <p className="font-semibold mb-0.5">{label}</p>
      <p className="num">{currency} {payload[0].value.toFixed(2)}</p>
    </div>
  )
}

// ── KPI Card ──────────────────────────────────────────────────────────────────

function KPI({
  label, value, sub, color, href, badge,
}: {
  label: string; value: string; sub?: string; color: string; href?: string; badge?: string
}) {
  const inner = (
    <div
      className="rounded-[14px] px-4 py-4 relative overflow-hidden h-full"
      style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}
    >
      <div className="absolute left-0 top-0 bottom-0 w-[3.5px]" style={{ background: color }} />
      {badge && (
        <span
          className="absolute top-3 right-3 text-[10px] font-bold px-1.5 py-0.5 rounded-[5px]"
          style={{ background: color + '22', color }}
        >
          {badge}
        </span>
      )}
      <p className="text-[11px] font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--color-muted)' }}>{label}</p>
      <p className="font-display font-extrabold text-[26px] num leading-none" style={{ color }}>
        {value}
      </p>
      {sub && <p className="text-[11px] mt-1" style={{ color: 'var(--color-muted)' }}>{sub}</p>}
    </div>
  )
  return href ? <Link href={href} className="block">{inner}</Link> : inner
}

// ── Main Dashboard ────────────────────────────────────────────────────────────

export function DashboardModule({ data }: { data: DashboardData }) {
  const { currency } = useAppSettings()
  const d = data
  const momPct = d.lastMonthRevenue > 0
    ? ((d.monthRevenue - d.lastMonthRevenue) / d.lastMonthRevenue) * 100 : null
  const momLabel = momPct !== null
    ? `${momPct > 0 ? '+' : ''}${momPct.toFixed(1)}% vs last month`
    : undefined

  const todayHour = new Date().getHours()
  const greeting  = todayHour < 12 ? 'Good morning' : todayHour < 17 ? 'Good afternoon' : 'Good evening'

  return (
    <div>
      {/* Logo + greeting */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <div style={{ position: 'relative', width: 140, height: 44, marginBottom: 8 }}>
            <Image src="/Apna%20chulha%20logo%20brown.png" alt="Apna Chulha" fill sizes="140px"
              style={{ objectFit: 'contain', objectPosition: 'left center' }} priority />
          </div>
          <h1 className="font-display font-bold text-[22px]" style={{ color: 'var(--color-ink)' }}>
            {greeting}, {d.userName}
          </h1>
          <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
            Here's your business snapshot for today.
          </p>
        </div>
        {d.pendingApprovals > 0 && (
          <Link
            href="/approvals"
            className="flex items-center gap-2 px-4 py-2.5 rounded-[12px]"
            style={{ background: 'var(--color-red-soft)', border: '1px solid #FECACA', color: 'var(--color-red)' }}
          >
            <AlertCircle size={16} />
            <span className="font-bold text-sm">{d.pendingApprovals} Pending Approval{d.pendingApprovals > 1 ? 's' : ''}</span>
          </Link>
        )}
      </div>

      {/* Primary KPIs */}
      <div className="grid gap-3 mb-5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
        <KPI label="Today's Revenue" value={`${currency} ${d.todayRevenue.toFixed(2)}`} color={C.saffron}
          href="/payments" badge="Today" />
        <KPI label="This Month Revenue" value={`${currency} ${d.monthRevenue.toFixed(2)}`} color={C.blue}
          sub={momLabel} href="/payments" />
        <KPI label="Monthly Recurring" value={`${currency} ${d.mrr.toFixed(2)}`} color={C.purple}
          sub={`${d.activeSubscriptions} active subscription${d.activeSubscriptions !== 1 ? 's' : ''}`}
          href="/fixed-menu" />
        <KPI label="Outstanding Balance" value={`${currency} ${d.totalOutstanding.toFixed(2)}`} color={C.red}
          sub="subscription balances due this month" href="/reports?tab=balances" />
        <KPI label="Active Customers" value={String(d.activeCustomers)} color={C.green}
          sub={`${d.newCustomersMonth} new this month · ${d.pausedCustomers} paused`}
          href="/customers" />
        <KPI label="Orders Today" value={String(d.ordersToday)} color={C.gold}
          sub={`B:${d.ordersByPeriod.breakfast} L:${d.ordersByPeriod.lunch} D:${d.ordersByPeriod.dinner}`} />
      </div>

      {/* Revenue chart — last 30 days */}
      <div
        className="rounded-[14px] p-4 mb-5"
        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}
      >
        <div className="flex items-center justify-between mb-3">
          <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>
            Revenue — Last 30 Days
          </p>
          <div className="flex items-center gap-1.5">
            {momPct !== null && (
              <span className="flex items-center gap-1 text-xs font-bold"
                style={{ color: momPct >= 0 ? C.green : C.red }}>
                {momPct >= 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
                {Math.abs(momPct).toFixed(1)}% MoM
              </span>
            )}
            <Link href="/reports?tab=revenue" className="text-xs font-semibold" style={{ color: C.saffron }}>
              Full report →
            </Link>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={d.rev30d} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#ECE2D3" />
            <XAxis
              dataKey="date"
              tickFormatter={fmtShortDate}
              tick={{ fontSize: 10, fill: C.muted }}
              interval={4}
            />
            <YAxis tick={{ fontSize: 10, fill: C.muted }} width={52} />
            <Tooltip content={<CustomTooltip />} />
            <ReferenceLine
              y={d.rev30d.reduce((s, r) => s + r.amount, 0) / d.rev30d.filter(r => r.amount > 0).length || 0}
              stroke={C.muted} strokeDasharray="4 4" strokeWidth={1}
            />
            <Bar dataKey="amount" fill={C.saffron} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Outstanding balances */}
        {d.topBalances.length > 0 && (
          <div
            className="rounded-[14px] p-4"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}
          >
            <div className="flex items-center justify-between mb-3">
              <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>
                Outstanding Balances
              </p>
              <Link href="/reports?tab=balances" className="text-xs font-semibold" style={{ color: C.saffron }}>
                View all →
              </Link>
            </div>
            <div className="space-y-2.5">
              {d.topBalances.map((r, i) => {
                const pct = r.monthlyCharge > 0 ? (r.monthPaid / r.monthlyCharge) * 100 : 0
                return (
                  <div key={i}>
                    <div className="flex justify-between text-xs mb-0.5">
                      <span>
                        <span className="font-semibold" style={{ color: 'var(--color-ink)' }}>{r.full_name}</span>
                        <span style={{ color: 'var(--color-muted)' }}> · {r.customer_code}</span>
                      </span>
                      <span className="num font-bold" style={{ color: C.red }}>
                        {currency} {r.balance.toFixed(2)} due
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full" style={{ background: 'var(--color-border)' }}>
                      <div className="h-full rounded-full" style={{ width: `${Math.min(100, pct)}%`, background: C.green }} />
                    </div>
                    <p className="text-[10px] mt-0.5" style={{ color: 'var(--color-muted)' }}>
                      {currency} {r.monthPaid.toFixed(2)} paid of {currency} {r.monthlyCharge.toFixed(2)}
                    </p>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Recent payments */}
        <div
          className="rounded-[14px] p-4"
          style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}
        >
          <div className="flex items-center justify-between mb-3">
            <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>
              Recent Payments
            </p>
            <Link href="/payments" className="text-xs font-semibold" style={{ color: C.saffron }}>
              View all →
            </Link>
          </div>
          {d.recentPayments.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--color-muted)' }}>No payments yet.</p>
          ) : (
            <div className="space-y-2.5">
              {d.recentPayments.map(p => {
                const isVoided = !!p.voided_at
                const modeCol  = MODE_COLORS[p.mode] ?? C.muted
                return (
                  <div key={p.id} className="flex items-center gap-2" style={{ opacity: isVoided ? 0.5 : 1 }}>
                    <span
                      className="flex-shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-[5px]"
                      style={{ background: modeCol + '22', color: modeCol, minWidth: 46, textAlign: 'center' }}
                    >
                      {MODE_LABELS[p.mode] ?? p.mode}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold truncate" style={{ color: 'var(--color-ink)', textDecoration: isVoided ? 'line-through' : 'none' }}>
                        {p.customers?.full_name ?? 'Unknown'}
                      </p>
                      <p className="text-[10px]" style={{ color: 'var(--color-muted)' }}>
                        {p.payment_number} · {fmtDate(p.payment_date)}
                      </p>
                    </div>
                    <span className="num font-bold text-xs flex-shrink-0" style={{ color: isVoided ? 'var(--color-muted)' : 'var(--color-ink)' }}>
                      {currency} {parseFloat(String(p.amount)).toFixed(2)}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Quick actions */}
      <div
        className="mt-5 rounded-[14px] p-4"
        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}
      >
        <p className="text-[11px] font-bold uppercase tracking-wide mb-3" style={{ color: 'var(--color-muted)' }}>
          Quick Access
        </p>
        <div className="flex flex-wrap gap-2">
          {[
            { href: '/orders/new',  label: '+ New Order',         color: C.saffron  },
            { href: '/payments',    label: '+ Record Payment',    color: C.blue     },
            { href: '/customers',   label: 'All Customers',       color: C.green    },
            { href: '/fixed-menu',  label: 'Subscriptions',       color: C.purple   },
            { href: '/packing',     label: 'Packing Sheet',       color: C.gold     },
            { href: '/reports',     label: 'Reports',             color: C.muted    },
          ].map(a => (
            <Link
              key={a.href}
              href={a.href}
              className="px-3 py-1.5 rounded-[8px] text-xs font-bold"
              style={{ background: a.color + '18', color: a.color, border: `1px solid ${a.color}33` }}
            >
              {a.label}
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
