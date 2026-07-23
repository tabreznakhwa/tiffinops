'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Edit2, Phone, Mail, MapPin, ShoppingBag, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EditCustomerModal } from './edit-customer-modal'
import type { ReferralCustomerOption } from './customer-form-fields'
import { RecordPaymentModal } from '@/components/payments/record-payment-modal'
import { setCustomerStatus } from '@/lib/customers/actions'
import { useAppSettings } from '@/components/settings/settings-context'
import type { Tables, Enums } from '@/lib/supabase/types'

type Customer = Tables<'customers'>

export type BalanceSummary = {
  monthlyCharge: number
  subscriptionPlanName: string | null
  monthPaid: number
  monthOrdersTotal: number
  allTimePaid: number
  currentMonth: string
  recentPayments: {
    id: string
    payment_number: string
    amount: string
    mode: string
    payment_date: string
    is_advance: boolean
  }[]
}

const STATUS_CONFIG: Record<
  Enums<'customer_status'>,
  { label: string; bg: string; color: string }
> = {
  active:      { label: 'Active',      bg: 'var(--color-green-soft)',  color: 'var(--color-green)'  },
  paused:      { label: 'Paused',      bg: 'var(--color-blue-soft)',   color: 'var(--color-blue)'   },
  inactive:    { label: 'Inactive',    bg: 'var(--color-border)',      color: 'var(--color-muted)'  },
  blacklisted: { label: 'Blacklisted', bg: 'var(--color-red-soft)',    color: 'var(--color-red)'    },
}

const PLAN_LABELS: Record<Enums<'customer_type'>, string> = {
  a_la_carte: 'A La Carte',
  fixed_menu: 'Fixed Menu (Tiffin)',
  hybrid:     'Hybrid',
}

function InfoRow({
  label,
  value,
  icon,
}: {
  label: string
  value: string
  icon?: React.ReactNode
}) {
  return (
    <div>
      <p
        className="text-[11px] font-bold uppercase tracking-wide mb-0.5"
        style={{ color: 'var(--color-muted)' }}
      >
        {label}
      </p>
      <div className="flex items-center gap-1.5">
        {icon && <span style={{ color: 'var(--color-muted)' }}>{icon}</span>}
        <p className="text-sm" style={{ color: 'var(--color-ink)' }}>
          {value}
        </p>
      </div>
    </div>
  )
}

const MODE_LABELS: Record<string, string> = {
  cash: 'Cash', bank_transfer: 'Bank Transfer', card: 'Card',
  online: 'Online', cheque: 'Cheque', wallet: 'Wallet', other: 'Other',
}

function fmtDate(d: string) {
  return new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  })
}

type OrderWithItems = {
  id: string; order_number: string; order_date: string
  meal_period: string; total_amount: string; order_status: string
  order_items: { item_name_snapshot: string; quantity: string }[]
}

const ORDER_STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  confirmed:         { label: 'Confirmed',     color: '#2C5E8F', bg: '#EFF6FF' },
  preparing:         { label: 'Preparing',     color: '#B7860B', bg: '#FEFCE8' },
  out_for_delivery:  { label: 'Out for Del.',  color: '#6B3FA0', bg: '#F5F3FF' },
  delivered:         { label: 'Delivered',     color: '#2E7D4F', bg: '#F0FDF4' },
  cancelled:         { label: 'Cancelled',     color: '#7C7063', bg: '#F5F0EB' },
  voided:            { label: 'Voided',        color: '#C0392B', bg: '#FEF2F2' },
  draft:             { label: 'Draft',         color: '#7C7063', bg: '#F5F0EB' },
}

const MEAL_LABELS: Record<string, string> = {
  breakfast: 'B', lunch: 'L', dinner: 'D',
}

export function CustomerDetailView({
  customer,
  canWrite,
  canAdmin,
  balance,
  orders = [],
  referrer,
  referralCustomers = [],
}: {
  customer: Customer
  canWrite: boolean
  canAdmin: boolean
  balance: BalanceSummary
  orders?: OrderWithItems[]
  referrer?: ReferralCustomerOption | null
  referralCustomers?: ReferralCustomerOption[]
}) {
  const router = useRouter()
  const { currency } = useAppSettings()
  const [editOpen, setEditOpen]       = useState(false)
  const [paymentOpen, setPaymentOpen] = useState(false)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [isPending, startTransition]  = useTransition()

  const statusCfg = STATUS_CONFIG[customer.status]

  function handleStatusChange(newStatus: Enums<'customer_status'>) {
    setStatusError(null)
    startTransition(async () => {
      const result = await setCustomerStatus(customer.id, newStatus)
      if (result?.error) {
        setStatusError(result.error)
      } else {
        router.refresh()
      }
    })
  }

  return (
    <div>
      {/* Back link */}
      <Link
        href="/customers"
        className="inline-flex items-center gap-1.5 text-sm font-semibold mb-5 transition-opacity hover:opacity-70"
        style={{ color: 'var(--color-muted)' }}
      >
        <ArrowLeft size={15} />
        Customers
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <p
            className="text-xs font-bold uppercase tracking-widest"
            style={{ color: 'var(--color-saffron)', letterSpacing: '.12em' }}
          >
            {customer.customer_code}
          </p>
          <h1
            className="font-display font-bold text-[25px] mt-0.5"
            style={{ color: 'var(--color-ink)' }}
          >
            {customer.full_name}
          </h1>
          <span
            className="inline-flex items-center px-2.5 py-0.5 rounded-pill text-xs font-bold mt-1"
            style={{ background: statusCfg.bg, color: statusCfg.color }}
          >
            {statusCfg.label}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 mt-1">
          {customer.status === 'active' && (
            <Link href={`/orders/new?customer_id=${customer.id}`}>
              <Button variant="primary" size="sm">
                <ShoppingBag size={14} />
                New Order
              </Button>
            </Link>
          )}
          {canWrite && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEditOpen(true)}
            >
              <Edit2 size={14} />
              Edit
            </Button>
          )}
        </div>
      </div>

      {/* Profile card */}
      <div
        className="rounded-[14px] p-5 mb-4"
        style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          boxShadow: 'var(--shadow-card)',
        }}
      >
        <h2
          className="font-display font-bold text-[15px] mb-4"
          style={{ color: 'var(--color-ink)' }}
        >
          Profile
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <InfoRow label="Mobile" value={customer.mobile_number} icon={<Phone size={13} />} />
          {customer.whatsapp_number && (
            <InfoRow label="WhatsApp" value={customer.whatsapp_number} icon={<Phone size={13} />} />
          )}
          {customer.email && (
            <InfoRow label="Email" value={customer.email} icon={<Mail size={13} />} />
          )}
          <InfoRow label="Plan Type" value={PLAN_LABELS[customer.customer_type]} />
          {customer.area && (
            <InfoRow label="Area / Zone" value={customer.area} icon={<MapPin size={13} />} />
          )}
          {customer.billing_day && (
            <InfoRow label="Billing Day" value={`Day ${customer.billing_day} of each month`} />
          )}
          {(referrer || customer.referrer_name) && (
            <InfoRow
              label="Referred By"
              value={referrer
                ? `${referrer.full_name} (${referrer.customer_code})`
                : `${customer.referrer_name}${customer.referrer_phone ? ` · ${customer.referrer_phone}` : ''}`}
            />
          )}
          {customer.referral_reward_amount && Number(customer.referral_reward_amount) > 0 && (
            <InfoRow label="Referral Reward" value={`${currency} ${Number(customer.referral_reward_amount).toFixed(2)} / month`} />
          )}
        </div>

        {(customer.delivery_address || customer.delivery_instructions) && (
          <div
            className="mt-4 pt-4"
            style={{ borderTop: '1px solid var(--color-border)' }}
          >
            <p
              className="text-[11px] font-bold uppercase tracking-wide mb-1"
              style={{ color: 'var(--color-muted)' }}
            >
              Delivery Address
            </p>
            {customer.delivery_address && (
              <p className="text-sm" style={{ color: 'var(--color-ink)' }}>
                {customer.delivery_address}
              </p>
            )}
            {customer.delivery_instructions && (
              <p className="text-sm mt-0.5" style={{ color: 'var(--color-muted)' }}>
                {customer.delivery_instructions}
              </p>
            )}
          </div>
        )}

        {customer.notes && (
          <div
            className="mt-4 pt-4"
            style={{ borderTop: '1px solid var(--color-border)' }}
          >
            <p
              className="text-[11px] font-bold uppercase tracking-wide mb-1"
              style={{ color: 'var(--color-muted)' }}
            >
              Notes
            </p>
            <p className="text-sm" style={{ color: 'var(--color-ink)' }}>
              {customer.notes}
            </p>
          </div>
        )}
      </div>

      {/* Status actions */}
      {canWrite && (
        <div
          className="rounded-[14px] p-5 mb-4"
          style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            boxShadow: 'var(--shadow-card)',
          }}
        >
          <h2
            className="font-display font-bold text-[15px] mb-3"
            style={{ color: 'var(--color-ink)' }}
          >
            Change Status
          </h2>
          <div className="flex flex-wrap gap-2">
            {customer.status !== 'active' && (
              <Button
                variant="success"
                size="sm"
                onClick={() => handleStatusChange('active')}
                disabled={isPending}
              >
                Activate
              </Button>
            )}
            {customer.status === 'active' && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleStatusChange('paused')}
                disabled={isPending}
              >
                Pause
              </Button>
            )}
            {customer.status === 'paused' && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleStatusChange('active')}
                disabled={isPending}
              >
                Resume
              </Button>
            )}
            {canAdmin && customer.status !== 'inactive' && (
              <Button
                variant="danger"
                size="sm"
                onClick={() => handleStatusChange('inactive')}
                disabled={isPending}
              >
                Deactivate
              </Button>
            )}
          </div>
          {statusError && (
            <p className="text-sm mt-2 font-semibold" style={{ color: 'var(--color-red)' }}>
              {statusError}
            </p>
          )}
        </div>
      )}

      {/* Balance & Payments */}
      <div
        className="rounded-[14px] p-5"
        style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          boxShadow: 'var(--shadow-card)',
        }}
      >
        {/* Card header */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display font-bold text-[15px]" style={{ color: 'var(--color-ink)' }}>
            Balance — {balance.currentMonth}
          </h2>
          <button
            onClick={() => setPaymentOpen(true)}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-[8px] text-xs font-bold"
            style={{ background: 'var(--color-saffron)', color: '#fff' }}
          >
            <Plus size={12} />
            Record Payment
          </button>
        </div>

        {/* Charge breakdown */}
        <div className="space-y-2 mb-4">
          {balance.monthlyCharge > 0 && (
            <div className="flex items-center justify-between text-sm">
              <span style={{ color: 'var(--color-muted)' }}>
                Monthly Plan{balance.subscriptionPlanName ? ` — ${balance.subscriptionPlanName}` : ''}
              </span>
              <span className="num font-semibold" style={{ color: 'var(--color-ink)' }}>
                {currency} {balance.monthlyCharge.toFixed(2)}
              </span>
            </div>
          )}
          {balance.monthOrdersTotal > 0 && (
            <div className="flex items-center justify-between text-sm">
              <span style={{ color: 'var(--color-muted)' }}>A-la-carte orders this month</span>
              <span className="num font-semibold" style={{ color: 'var(--color-ink)' }}>
                {currency} {balance.monthOrdersTotal.toFixed(2)}
              </span>
            </div>
          )}
          {(balance.monthlyCharge > 0 || balance.monthOrdersTotal > 0) && (
            <div className="flex items-center justify-between text-sm">
              <span style={{ color: 'var(--color-green)' }}>Paid this month</span>
              <span className="num font-semibold" style={{ color: 'var(--color-green)' }}>
                − {currency} {balance.monthPaid.toFixed(2)}
              </span>
            </div>
          )}
        </div>

        {/* Balance highlight */}
        {(() => {
          const total  = balance.monthlyCharge + balance.monthOrdersTotal
          const due    = total - balance.monthPaid
          const isDue  = due > 0.005
          const isCredit = due < -0.005
          return (
            <div
              className="flex items-center justify-between px-4 py-3 rounded-[11px] mb-4"
              style={{
                background: isDue ? 'var(--color-red-soft)' : 'var(--color-green-soft)',
                border: `1px solid ${isDue ? '#FECACA' : '#A7DFB8'}`,
              }}
            >
              <span className="text-sm font-bold" style={{ color: isDue ? 'var(--color-red)' : 'var(--color-green)' }}>
                {isDue ? 'Balance Due' : isCredit ? 'Credit / Overpaid' : 'Fully Paid'}
              </span>
              <span
                className="font-display font-extrabold text-[22px] num"
                style={{ color: isDue ? 'var(--color-red)' : 'var(--color-green)' }}
              >
                {currency} {Math.abs(due).toFixed(2)}
              </span>
            </div>
          )
        })()}

        {/* All-time total */}
        <div
          className="flex items-center justify-between text-sm pb-4"
          style={{ borderBottom: balance.recentPayments.length > 0 ? '1px solid var(--color-border)' : 'none' }}
        >
          <span style={{ color: 'var(--color-muted)' }}>All-time collected</span>
          <span className="num font-semibold" style={{ color: 'var(--color-ink)' }}>
            {currency} {balance.allTimePaid.toFixed(2)}
          </span>
        </div>

        {/* Recent payments */}
        {balance.recentPayments.length > 0 && (
          <div className="mt-4">
            <p className="text-[11px] font-bold uppercase tracking-wide mb-3" style={{ color: 'var(--color-muted)' }}>
              Recent Payments
            </p>
            <div className="space-y-2">
              {balance.recentPayments.map(p => (
                <div key={p.id} className="flex items-center justify-between text-sm">
                  <div>
                    <span className="font-semibold" style={{ color: 'var(--color-ink)' }}>
                      {MODE_LABELS[p.mode] ?? p.mode}
                    </span>
                    <span style={{ color: 'var(--color-muted)' }}>
                      {' · '}{p.payment_number}{' · '}{fmtDate(p.payment_date)}
                    </span>
                    {p.is_advance && (
                      <span className="ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full align-middle" style={{ background: 'var(--color-purple-soft, #F5F3FF)', color: 'var(--color-purple, #7C3AED)' }}>
                        ADV
                      </span>
                    )}
                  </div>
                  <span className="num font-semibold" style={{ color: 'var(--color-green)' }}>
                    {currency} {parseFloat(p.amount).toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
            <Link
              href="/payments"
              className="inline-block mt-3 text-xs font-semibold"
              style={{ color: 'var(--color-saffron)' }}
            >
              View all payments →
            </Link>
          </div>
        )}

        {/* Ledger link */}
        <div
          className="mt-3 pt-3"
          style={{ borderTop: '1px solid var(--color-border)' }}
        >
          <Link
            href={`/customers/${customer.id}/ledger`}
            className="inline-flex items-center gap-1.5 text-sm font-semibold transition-opacity hover:opacity-70"
            style={{ color: 'var(--color-ink)' }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4" aria-hidden="true">
              <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/>
              <rect x="9" y="3" width="6" height="4" rx="1"/>
              <path d="M9 12h6M9 16h4"/>
            </svg>
            View Full Ledger
          </Link>
        </div>
      </div>

      {/* Recent Orders */}
      {orders.length > 0 && (
        <div
          className="rounded-[14px] p-5 mt-4"
          style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}
        >
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-display font-bold text-[15px]" style={{ color: 'var(--color-ink)' }}>
              Recent Orders
            </h2>
            <Link
              href={`/orders/new?customer_id=${customer.id}`}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-[8px] text-xs font-bold"
              style={{ background: 'var(--color-saffron)', color: '#fff' }}
            >
              <ShoppingBag size={11} />
              New Order
            </Link>
          </div>
          <div className="space-y-2">
            {orders.map(order => {
              const cfg = ORDER_STATUS_CONFIG[order.order_status] ?? ORDER_STATUS_CONFIG.draft
              const itemsSummary = order.order_items
                .map(i => `${i.item_name_snapshot}${Number(i.quantity) > 1 ? ` ×${i.quantity}` : ''}`)
                .join(', ')
              return (
                <div
                  key={order.id}
                  className="flex items-start gap-3 py-2.5"
                  style={{ borderBottom: '1px solid var(--color-border)' }}
                >
                  {/* Meal period pill */}
                  <span
                    className="flex-shrink-0 text-[10px] font-bold rounded-[5px] px-1.5 py-0.5 mt-0.5"
                    style={{ background: 'var(--color-cream)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' }}
                  >
                    {MEAL_LABELS[order.meal_period] ?? order.meal_period}
                  </span>
                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold" style={{ color: 'var(--color-ink)' }}>
                      {order.order_number}
                      <span style={{ color: 'var(--color-muted)', fontWeight: 400 }}> · {fmtDate(order.order_date)}</span>
                    </p>
                    {itemsSummary && (
                      <p className="text-[11px] mt-0.5 truncate" style={{ color: 'var(--color-muted)' }}>
                        {itemsSummary}
                      </p>
                    )}
                  </div>
                  {/* Status + amount */}
                  <div className="text-right flex-shrink-0">
                    <p className="num text-sm font-bold" style={{ color: 'var(--color-ink)' }}>
                      {currency} {parseFloat(String(order.total_amount)).toFixed(2)}
                    </p>
                    <span
                      className="text-[10px] font-bold px-1.5 py-0.5 rounded-[5px]"
                      style={{ background: cfg.bg, color: cfg.color }}
                    >
                      {cfg.label}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
          <Link
            href="/orders"
            className="inline-block mt-2 text-xs font-semibold"
            style={{ color: 'var(--color-saffron)' }}
          >
            View all orders →
          </Link>
        </div>
      )}

      {/* Edit modal */}
      <EditCustomerModal
        customer={customer}
        open={editOpen}
        onClose={() => setEditOpen(false)}
        onSuccess={() => {
          router.refresh()
          setEditOpen(false)
        }}
        referralCustomers={referralCustomers}
      />

      {/* Record payment modal */}
      {paymentOpen && (
        <RecordPaymentModal
          customers={[{
            id: customer.id,
            full_name: customer.full_name,
            customer_code: customer.customer_code,
            mobile_number: customer.mobile_number,
            area: customer.area,
          }]}
          preselectedCustomer={{
            id: customer.id,
            full_name: customer.full_name,
            customer_code: customer.customer_code,
            mobile_number: customer.mobile_number,
            area: customer.area,
          }}
          onClose={() => { setPaymentOpen(false); router.refresh() }}
        />
      )}
    </div>
  )
}
