export const dynamic = 'force-dynamic'

import { formatInTimeZone } from 'date-fns-tz'
import { requireAuth } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { previewSubscriptionApprovalImpact } from '@/lib/fixed-menu/subscription-approval'
import { ApprovalsModule } from '@/components/approvals/approvals-module'
import type { EnrichedRequest } from '@/components/approvals/approvals-module'

// ── Raw DB shapes ──────────────────────────────────────────────────────────────

type RawApprovalRequest = {
  id: string
  request_type: 'delete' | 'edit'
  target_table: 'order' | 'payment' | 'invoice' | 'subscription'
  target_id: string
  reason: string
  proposed_changes: unknown
  status: 'pending' | 'approved' | 'rejected'
  requested_by: string
  requested_at: string
  resolved_by: string | null
  resolved_at: string | null
  resolution_note: string | null
}

type RawPayment = {
  id: string
  payment_number: string
  payment_date: string
  amount: string
  mode: string
  customers: { full_name: string; customer_code: string } | null
}

type RawOrder = {
  id: string
  order_number: string
  order_date: string
  meal_period: string
  total_amount: string
  customers: { full_name: string; customer_code: string } | null
}

type RawUser = {
  id: string
  full_name: string
  role: string
}

type RawCustomer = {
  id: string
  full_name: string
  customer_code: string
}

const SUBSCRIPTION_KIND_LABELS: Record<string, string> = {
  meal_pause:   'Stop a meal',
  meal_resume:  'Resume a meal',
  status_change: 'Pause/cancel subscription',
  pause_date:   'Change pause/end date',
  start_date:   'Change start date',
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default async function ApprovalsPage() {
  const user = await requireAuth()
  const admin = createAdminClient()

  // 1. Fetch all approval_requests ordered newest first
  const { data: rawRequests } = await admin
    .from('approval_requests')
    .select('*')
    .order('requested_at', { ascending: false })

  const requests = (rawRequests ?? []) as unknown as RawApprovalRequest[]

  // 2. Collect unique target IDs by table
  const paymentIds = [...new Set(
    requests.filter(r => r.target_table === 'payment').map(r => r.target_id)
  )]
  const orderIds = [...new Set(
    requests.filter(r => r.target_table === 'order').map(r => r.target_id)
  )]
  const subscriptionCustomerIds = [...new Set(
    requests
      .filter(r => r.target_table === 'subscription')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map(r => (r.proposed_changes as any)?.customer_id)
      .filter((id): id is string => !!id)
  )]

  // 3. Collect unique user IDs (requestors + resolvers)
  const userIds = [...new Set([
    ...requests.map(r => r.requested_by),
    ...requests.filter(r => r.resolved_by).map(r => r.resolved_by as string),
  ])]

  // 4. Batch fetch payments, orders, users in parallel
  const [
    { data: rawPayments },
    { data: rawOrders },
    { data: rawUsers },
    { data: rawCustomers },
  ] = await Promise.all([
    paymentIds.length > 0
      ? admin
          .from('payments')
          .select('id, payment_number, payment_date, amount, mode, customers(full_name, customer_code)')
          .in('id', paymentIds)
      : { data: [] },

    orderIds.length > 0
      ? admin
          .from('orders')
          .select('id, order_number, order_date, meal_period, total_amount, customers(full_name, customer_code)')
          .in('id', orderIds)
      : { data: [] },

    userIds.length > 0
      ? admin
          .from('users')
          .select('id, full_name, role')
          .in('id', userIds)
      : { data: [] },

    subscriptionCustomerIds.length > 0
      ? admin
          .from('customers')
          .select('id, full_name, customer_code')
          .in('id', subscriptionCustomerIds)
      : { data: [] },
  ])

  const payments  = (rawPayments  ?? []) as unknown as RawPayment[]
  const orders    = (rawOrders    ?? []) as unknown as RawOrder[]
  const users     = (rawUsers     ?? []) as unknown as RawUser[]
  const customers = (rawCustomers ?? []) as unknown as RawCustomer[]

  // 5. Build lookup maps
  const paymentMap  = new Map(payments.map(p => [p.id, p]))
  const orderMap    = new Map(orders.map(o => [o.id, o]))
  const userMap     = new Map(users.map(u => [u.id, u]))
  const customerMap = new Map(customers.map(c => [c.id, c]))

  // Fetch currency for display
  const { data: settingsRow } = await admin.from('app_settings').select('currency').eq('id', 1).single()
  const currency = (settingsRow as { currency?: string } | null)?.currency ?? 'AED'

  function fmtDate(iso: string) {
    return formatInTimeZone(new Date(iso), 'Asia/Dubai', 'd MMM yyyy')
  }

  // 6. Enrich requests
  const enriched: EnrichedRequest[] = await Promise.all(requests.map(async req => {
    const requestor = userMap.get(req.requested_by)
    const resolver  = req.resolved_by ? userMap.get(req.resolved_by) : null

    let target_label    = req.target_id
    let target_customer = '—'
    let target_date     = '—'

    if (req.target_table === 'payment') {
      const p = paymentMap.get(req.target_id)
      if (p) {
        target_label    = `${p.payment_number} · ${currency} ${parseFloat(String(p.amount)).toFixed(2)}`
        target_customer = p.customers?.full_name ?? '—'
        target_date     = fmtDate(p.payment_date + 'T00:00:00Z')
      }
    } else if (req.target_table === 'order') {
      const o = orderMap.get(req.target_id)
      if (o) {
        target_label    = `${o.order_number} · ${currency} ${parseFloat(String(o.total_amount)).toFixed(2)}`
        target_customer = o.customers?.full_name ?? '—'
        target_date     = fmtDate(o.order_date + 'T00:00:00Z')
      }
    } else if (req.target_table === 'invoice') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const changes = req.proposed_changes as any
      if (changes?.type === 'ala_carte_batch') {
        target_label    = `A La Carte batch — ${changes.month} · ${changes.customer_count} customers · ${currency} ${Number(changes.total_amount).toFixed(2)}`
        target_customer = `${changes.customer_count} customers`
        target_date     = changes.month
      }
    } else if (req.target_table === 'subscription') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const changes = req.proposed_changes as any
      const kindLabel = SUBSCRIPTION_KIND_LABELS[changes?.kind] ?? 'Subscription change'
      const c = changes?.customer_id ? customerMap.get(changes.customer_id) : null
      target_customer = c?.full_name ?? '—'
      switch (changes?.kind) {
        case 'meal_pause':
          target_label = `${kindLabel} — ${changes.meal_period} from ${changes.pause_start}${changes.pause_end ? ` to ${changes.pause_end}` : ''}`
          target_date  = changes.pause_start
          break
        case 'meal_resume':
          target_label = `${kindLabel} from ${changes.resume_date}`
          target_date  = changes.resume_date
          break
        case 'status_change':
          target_label = `${changes.status} — effective ${changes.effective_date}`
          target_date  = changes.effective_date
          break
        case 'pause_date':
          target_label = `${kindLabel} to ${changes.end_date}`
          target_date  = changes.end_date
          break
        case 'start_date':
          target_label = `${kindLabel} to ${changes.start_date}`
          target_date  = changes.start_date
          break
        default:
          target_label = kindLabel
      }

      // Preview the "staff-error credit" side effect (see
      // finalizeBackdatedSubscriptionChange) so the owner can see, before
      // approving, that orders logged after the requested stop date will be
      // voided rather than billed — only worth computing while still pending.
      if (req.status === 'pending') {
        const impact = await previewSubscriptionApprovalImpact(admin, req.target_id, changes)
        if (impact) {
          target_label += ` · ⚠ ${impact.count} order(s) already logged after the stop date (${currency} ${impact.total.toFixed(2)}) will be voided as a staff-error credit, not billed`
        }
      }
    }

    return {
      id:              req.id,
      request_type:    req.request_type,
      target_table:    req.target_table,
      target_id:       req.target_id,
      reason:          req.reason,
      status:          req.status,
      requested_at:    req.requested_at,
      resolved_at:     req.resolved_at,
      resolution_note: req.resolution_note,
      requestor_name:  requestor?.full_name ?? 'Unknown',
      resolver_name:   resolver?.full_name ?? null,
      target_label,
      target_customer,
      target_date,
    }
  }))

  const pendingCount = enriched.filter(r => r.status === 'pending').length
  const isOwnerOrManager = ['owner', 'manager'].includes(user.role)
  const isOwner = user.role === 'owner'

  return (
    <ApprovalsModule
      requests={enriched}
      pendingCount={pendingCount}
      isOwnerOrManager={isOwnerOrManager}
      isOwner={isOwner}
    />
  )
}
