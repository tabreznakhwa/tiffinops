'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Search, Pencil } from 'lucide-react'
import { togglePlanStatus, updateSubscriptionStatus } from '@/lib/fixed-menu/actions'
import { PlanModal } from './plan-modal'
import { SubscribeModal } from './subscribe-modal'
import type { EditableSubscription } from './subscribe-modal'
import { useAppSettings } from '@/components/settings/settings-context'
import type { Tables } from '@/lib/supabase/types'

export type Plan = Tables<'fixed_plans'>

export type CustomerSummary = {
  id: string
  full_name: string
  customer_code: string
  mobile_number: string
  area: string | null
  customer_type: string
}

export type SubscriptionRow = {
  id: string
  customer_id: string
  fixed_plan_id: string
  start_date: string
  end_date: string | null
  agreed_monthly_price: string
  status: string
  notes: string | null
  created_at: string
  customers: CustomerSummary | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const PERIOD_LABEL: Record<string, string> = {
  breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner',
}
const PERIOD_ICON: Record<string, string> = {
  breakfast: '🌅', lunch: '☀️', dinner: '🌙',
}

const SUB_STATUS: Record<string, { label: string; bg: string; color: string }> = {
  active:    { label: 'Active',    bg: 'var(--color-green-soft)', color: 'var(--color-green)'  },
  paused:    { label: 'Paused',    bg: '#FEF3C7',                 color: 'var(--color-gold)'   },
  cancelled: { label: 'Cancelled', bg: 'var(--color-red-soft)',   color: 'var(--color-red)'    },
  completed: { label: 'Completed', bg: 'var(--color-border)',     color: 'var(--color-muted)'  },
}

function fmtDate(d: string) {
  return new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  })
}

// ── Main module ───────────────────────────────────────────────────────────────

export function FixedMenuModule({
  plans,
  subscriptions,
  customers,
}: {
  plans: Plan[]
  subscriptions: SubscriptionRow[]
  customers: CustomerSummary[]
}) {
  const router = useRouter()
  const { currency } = useAppSettings()

  const [tab, setTab]                   = useState<'subscriptions' | 'plans'>('subscriptions')
  const [statusFilter, setStatusFilter] = useState('active')
  const [search, setSearch]             = useState('')
  const [showPlanModal, setShowPlanModal]       = useState(false)
  const [editPlan, setEditPlan]                 = useState<Plan | undefined>()
  const [showSubscribeModal, setShowSubscribeModal] = useState(false)
  const [editSubscription, setEditSubscription]     = useState<EditableSubscription | undefined>()
  const [busy, setBusy]                 = useState<string | null>(null)

  // ── Derived counts ──────────────────────────────────────────────────────────

  const activeSubs  = subscriptions.filter(s => s.status === 'active').length
  const pausedSubs  = subscriptions.filter(s => s.status === 'paused').length
  const activePlans = plans.filter(p => p.is_active).length

  const subCountByPlan = useMemo(() => {
    const map: Record<string, number> = {}
    subscriptions.forEach(s => {
      if (s.status === 'active') map[s.fixed_plan_id] = (map[s.fixed_plan_id] ?? 0) + 1
    })
    return map
  }, [subscriptions])

  // ── Filtered subscriptions ──────────────────────────────────────────────────

  const filtered = useMemo(() => {
    let list = statusFilter === 'all'
      ? subscriptions
      : subscriptions.filter(s => s.status === statusFilter)

    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(s =>
        s.customers?.full_name.toLowerCase().includes(q) ||
        s.customers?.customer_code.toLowerCase().includes(q)
      )
    }
    return list
  }, [subscriptions, statusFilter, search])

  // ── Actions ─────────────────────────────────────────────────────────────────

  async function handleSubStatus(id: string, status: 'active' | 'paused' | 'cancelled' | 'completed') {
    setBusy(id)
    await updateSubscriptionStatus(id, status)
    setBusy(null)
    router.refresh()
  }

  async function handleTogglePlan(id: string) {
    setBusy('plan-' + id)
    await togglePlanStatus(id)
    setBusy(null)
    router.refresh()
  }

  function closePlanModal() {
    setShowPlanModal(false)
    setEditPlan(undefined)
    router.refresh()
  }

  const STATUS_FILTERS = [
    { value: 'all',    label: `All (${subscriptions.length})`  },
    { value: 'active', label: `Active (${activeSubs})`         },
    { value: 'paused', label: `Paused (${pausedSubs})`         },
  ]

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* Page header */}
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <p
            className="text-xs font-bold uppercase tracking-widest"
            style={{ color: 'var(--color-saffron)', letterSpacing: '.12em' }}
          >
            Fixed Menu
          </p>
          <h1
            className="font-display font-bold text-[25px] mt-0.5"
            style={{ color: 'var(--color-ink)' }}
          >
            Subscriptions
          </h1>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 mt-1">
          <button
            onClick={() => { setShowPlanModal(true); setTab('plans') }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-[10px] text-sm font-semibold"
            style={{
              color: 'var(--color-saffron)',
              border: '1.5px solid var(--color-saffron)',
              background: 'transparent',
            }}
          >
            <Plus size={15} />
            Add Plan
          </button>
          <button
            onClick={() => setShowSubscribeModal(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-[10px] text-sm font-semibold"
            style={{ background: 'var(--color-saffron)', color: '#fff' }}
          >
            <Plus size={15} />
            New Subscription
          </button>
        </div>
      </div>

      {/* Summary strip */}
      <div
        className="flex flex-wrap items-center gap-4 px-4 py-3 rounded-[12px] mb-5"
        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
      >
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>
            Active Subs
          </p>
          <p className="font-display font-bold text-[20px] num" style={{ color: 'var(--color-ink)' }}>
            {activeSubs}
          </p>
        </div>
        <div className="w-px self-stretch" style={{ background: 'var(--color-border)' }} />
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>
            Paused
          </p>
          <p className="font-display font-bold text-[20px] num" style={{ color: 'var(--color-gold)' }}>
            {pausedSubs}
          </p>
        </div>
        <div className="w-px self-stretch" style={{ background: 'var(--color-border)' }} />
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>
            Active Plans
          </p>
          <p className="font-display font-bold text-[20px] num" style={{ color: 'var(--color-green)' }}>
            {activePlans}
          </p>
        </div>
        <div className="ml-auto">
          <p className="text-[11px] font-bold uppercase tracking-wide text-right" style={{ color: 'var(--color-muted)' }}>
            Monthly Revenue
          </p>
          <p className="font-display font-bold text-[20px] num text-right" style={{ color: 'var(--color-ink)' }}>
            {currency} {subscriptions
              .filter(s => s.status === 'active')
              .reduce((sum, s) => sum + parseFloat(String(s.agreed_monthly_price)), 0)
              .toFixed(0)}
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-0.5 mb-5 border-b" style={{ borderColor: 'var(--color-border)' }}>
        {(['subscriptions', 'plans'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px capitalize"
            style={{
              borderColor: tab === t ? 'var(--color-saffron)' : 'transparent',
              color: tab === t ? 'var(--color-ink)' : 'var(--color-muted)',
            }}
          >
            {t === 'subscriptions'
              ? `Subscriptions (${subscriptions.length})`
              : `Plans (${activePlans}/${plans.length})`}
          </button>
        ))}
      </div>

      {/* ── SUBSCRIPTIONS TAB ── */}
      {tab === 'subscriptions' && (
        <div>
          {/* Filters + search */}
          <div className="flex flex-wrap gap-2 mb-4">
            {STATUS_FILTERS.map(f => (
              <button
                key={f.value}
                onClick={() => setStatusFilter(f.value)}
                className="px-3 py-1.5 rounded-[8px] text-xs font-bold"
                style={{
                  background: statusFilter === f.value ? 'var(--color-saffron)' : 'var(--color-surface)',
                  color: statusFilter === f.value ? '#fff' : 'var(--color-muted)',
                  border: '1px solid var(--color-border)',
                }}
              >
                {f.label}
              </button>
            ))}
            <div className="relative flex-1 min-w-[160px]">
              <Search
                size={13}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
                style={{ color: 'var(--color-muted)' }}
              />
              <input
                type="search"
                placeholder="Search customer…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full rounded-[8px] pl-7 pr-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-saffron"
                style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-ink)' }}
              />
            </div>
          </div>

          {filtered.length === 0 ? (
            <div
              className="py-16 text-center rounded-[14px]"
              style={{ border: '1px dashed var(--color-border)' }}
            >
              <p className="font-semibold text-sm mb-3" style={{ color: 'var(--color-muted)' }}>
                No subscriptions found
              </p>
              <button
                onClick={() => setShowSubscribeModal(true)}
                className="px-4 py-2 rounded-[8px] text-sm font-semibold"
                style={{ background: 'var(--color-saffron)', color: '#fff' }}
              >
                + New Subscription
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {filtered.map(sub => {
                const plan    = plans.find(p => p.id === sub.fixed_plan_id)
                const scfg    = SUB_STATUS[sub.status] ?? SUB_STATUS.active
                const loading = busy === sub.id

                return (
                  <div
                    key={sub.id}
                    className="rounded-[14px] px-4 py-4"
                    style={{
                      background: 'var(--color-surface)',
                      border: '1px solid var(--color-border)',
                      boxShadow: 'var(--shadow-card)',
                    }}
                  >
                    {/* Top row: name + status + price */}
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-0.5">
                          <p className="font-display font-bold text-[16px]" style={{ color: 'var(--color-ink)' }}>
                            {sub.customers?.full_name ?? 'Unknown'}
                          </p>
                          <span
                            className="text-[10.5px] font-bold px-2 py-0.5 rounded-pill flex-shrink-0"
                            style={{ background: scfg.bg, color: scfg.color }}
                          >
                            {scfg.label}
                          </span>
                        </div>
                        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                          {sub.customers?.customer_code}
                          {sub.customers?.area ? ` · ${sub.customers.area}` : ''}
                        </p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="font-display font-bold text-[17px] num" style={{ color: 'var(--color-ink)' }}>
                          {currency} {parseFloat(String(sub.agreed_monthly_price)).toFixed(0)}
                        </p>
                        <p className="text-[10px]" style={{ color: 'var(--color-muted)' }}>/month</p>
                      </div>
                    </div>

                    {/* Plan + period pills */}
                    <div className="flex flex-wrap items-center gap-2 mb-3">
                      {plan ? (
                        <>
                          <span className="text-xs font-semibold" style={{ color: 'var(--color-muted)' }}>
                            {plan.plan_name}
                          </span>
                          <span style={{ color: 'var(--color-border)' }}>·</span>
                          {plan.meal_periods.map(p => (
                            <span
                              key={p}
                              className="text-[10.5px] font-bold px-2 py-0.5 rounded-pill"
                              style={{
                                background: 'var(--color-cream)',
                                color: 'var(--color-ink)',
                                border: '1px solid var(--color-border)',
                              }}
                            >
                              {PERIOD_ICON[p]} {PERIOD_LABEL[p]}
                            </span>
                          ))}
                        </>
                      ) : (
                        <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
                          Plan unavailable
                        </span>
                      )}
                    </div>

                    {/* Date row + action buttons */}
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                        Started {fmtDate(sub.start_date)}
                        {sub.end_date ? ` · Ended ${fmtDate(sub.end_date)}` : ''}
                      </p>

                      <div className="flex gap-2 flex-shrink-0">
                        {/* Edit button — always visible for active/paused */}
                        {(sub.status === 'active' || sub.status === 'paused') && (
                          <button
                            onClick={() => {
                              setEditSubscription(sub as unknown as EditableSubscription)
                              setShowSubscribeModal(true)
                            }}
                            disabled={loading}
                            className="flex items-center gap-1 px-3 py-1.5 rounded-[8px] text-xs font-semibold disabled:opacity-50"
                            style={{ color: 'var(--color-saffron)', border: '1px solid var(--color-border)', background: 'transparent' }}
                          >
                            <Pencil size={11} />
                            Edit
                          </button>
                        )}
                        {sub.status === 'active' && (
                          <>
                            <button
                              onClick={() => handleSubStatus(sub.id, 'paused')}
                              disabled={loading}
                              className="px-3 py-1.5 rounded-[8px] text-xs font-semibold disabled:opacity-50"
                              style={{ background: '#FEF3C7', color: 'var(--color-gold)', border: '1px solid #FDE68A' }}
                            >
                              {loading ? '…' : 'Pause'}
                            </button>
                            <button
                              onClick={() => handleSubStatus(sub.id, 'cancelled')}
                              disabled={loading}
                              className="px-3 py-1.5 rounded-[8px] text-xs font-semibold disabled:opacity-50"
                              style={{ background: 'var(--color-red-soft)', color: 'var(--color-red)', border: '1px solid #FECACA' }}
                            >
                              {loading ? '…' : 'Cancel'}
                            </button>
                          </>
                        )}
                        {sub.status === 'paused' && (
                          <>
                            <button
                              onClick={() => handleSubStatus(sub.id, 'active')}
                              disabled={loading}
                              className="px-3 py-1.5 rounded-[8px] text-xs font-semibold disabled:opacity-50"
                              style={{ background: 'var(--color-green-soft)', color: 'var(--color-green)', border: '1px solid #BBD9C5' }}
                            >
                              {loading ? '…' : 'Resume'}
                            </button>
                            <button
                              onClick={() => handleSubStatus(sub.id, 'cancelled')}
                              disabled={loading}
                              className="px-3 py-1.5 rounded-[8px] text-xs font-semibold disabled:opacity-50"
                              style={{ background: 'var(--color-red-soft)', color: 'var(--color-red)', border: '1px solid #FECACA' }}
                            >
                              {loading ? '…' : 'Cancel'}
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    {sub.notes && (
                      <p
                        className="mt-2 text-xs px-2.5 py-1.5 rounded-[6px]"
                        style={{ background: 'var(--color-saffron-soft)', color: 'var(--color-ember)' }}
                      >
                        📌 {sub.notes}
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ── PLANS TAB ── */}
      {tab === 'plans' && (
        <div>
          <div className="flex justify-end mb-4">
            <button
              onClick={() => setShowPlanModal(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-[10px] text-sm font-semibold"
              style={{ background: 'var(--color-saffron)', color: '#fff' }}
            >
              <Plus size={15} />
              Add Plan
            </button>
          </div>

          {plans.length === 0 ? (
            <div
              className="py-16 text-center rounded-[14px]"
              style={{ border: '1px dashed var(--color-border)' }}
            >
              <p className="font-semibold text-sm mb-3" style={{ color: 'var(--color-muted)' }}>
                No plans yet
              </p>
              <button
                onClick={() => setShowPlanModal(true)}
                className="px-4 py-2 rounded-[8px] text-sm font-semibold"
                style={{ background: 'var(--color-saffron)', color: '#fff' }}
              >
                + Add First Plan
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {plans.map(plan => {
                const count     = subCountByPlan[plan.id] ?? 0
                const planBusy  = busy === 'plan-' + plan.id

                return (
                  <div
                    key={plan.id}
                    className="rounded-[14px] px-4 py-4"
                    style={{
                      background: 'var(--color-surface)',
                      border: '1px solid var(--color-border)',
                      boxShadow: 'var(--shadow-card)',
                      opacity: plan.is_active ? 1 : 0.6,
                    }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        {/* Name + status pill */}
                        <div className="flex items-center gap-2 mb-1.5">
                          <p className="font-display font-bold text-[17px]" style={{ color: 'var(--color-ink)' }}>
                            {plan.plan_name}
                          </p>
                          <span
                            className="text-[10.5px] font-bold px-2 py-0.5 rounded-pill flex-shrink-0"
                            style={
                              plan.is_active
                                ? { background: 'var(--color-green-soft)', color: 'var(--color-green)' }
                                : { background: 'var(--color-border)', color: 'var(--color-muted)' }
                            }
                          >
                            {plan.is_active ? 'Active' : 'Inactive'}
                          </span>
                        </div>

                        {/* Meal period pills */}
                        <div className="flex flex-wrap gap-1.5 mb-2">
                          {plan.meal_periods.map(p => (
                            <span
                              key={p}
                              className="text-[10.5px] font-bold px-2 py-0.5 rounded-pill"
                              style={{ background: 'var(--color-saffron-soft)', color: 'var(--color-ember)' }}
                            >
                              {PERIOD_ICON[p]} {PERIOD_LABEL[p]}
                            </span>
                          ))}
                        </div>

                        {plan.description && (
                          <p className="text-xs mb-2" style={{ color: 'var(--color-muted)' }}>
                            {plan.description}
                          </p>
                        )}

                        <div className="flex items-center gap-4">
                          <p className="font-display font-bold text-[15px] num" style={{ color: 'var(--color-ink)' }}>
                            {currency} {parseFloat(String(plan.default_monthly_price)).toFixed(2)}/month
                          </p>
                          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                            {count} active subscriber{count !== 1 ? 's' : ''}
                          </p>
                        </div>
                      </div>

                      {/* Action buttons */}
                      <div className="flex flex-col gap-1.5 flex-shrink-0">
                        <button
                          onClick={() => { setEditPlan(plan); setShowPlanModal(true) }}
                          className="flex items-center gap-1 px-3 py-1.5 rounded-[8px] text-xs font-semibold"
                          style={{ color: 'var(--color-saffron)', border: '1px solid var(--color-border)' }}
                        >
                          <Pencil size={11} />
                          Edit
                        </button>
                        <button
                          onClick={() => handleTogglePlan(plan.id)}
                          disabled={planBusy}
                          className="px-3 py-1.5 rounded-[8px] text-xs font-semibold disabled:opacity-50"
                          style={{ color: 'var(--color-muted)', border: '1px solid var(--color-border)' }}
                        >
                          {planBusy ? '…' : plan.is_active ? 'Deactivate' : 'Activate'}
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Modals ── */}
      {showPlanModal && (
        <PlanModal plan={editPlan} onClose={closePlanModal} />
      )}
      {showSubscribeModal && (
        <SubscribeModal
          plans={plans}
          customers={customers}
          subscription={editSubscription}
          onClose={() => { setShowSubscribeModal(false); setEditSubscription(undefined); router.refresh() }}
        />
      )}
    </div>
  )
}
