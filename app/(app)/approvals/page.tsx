import { formatInTimeZone } from 'date-fns-tz'
import { requireAuth } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { ApprovalsModule } from '@/components/approvals/approvals-module'
import type { EnrichedRequest } from '@/components/approvals/approvals-module'

// ── Raw DB shapes ──────────────────────────────────────────────────────────────

type RawApprovalRequest = {
  id: string
  request_type: 'delete' | 'edit'
  target_table: 'order' | 'payment' | 'invoice'
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
  ])

  const payments = (rawPayments ?? []) as unknown as RawPayment[]
  const orders   = (rawOrders   ?? []) as unknown as RawOrder[]
  const users    = (rawUsers    ?? []) as unknown as RawUser[]

  // 5. Build lookup maps
  const paymentMap = new Map(payments.map(p => [p.id, p]))
  const orderMap   = new Map(orders.map(o => [o.id, o]))
  const userMap    = new Map(users.map(u => [u.id, u]))

  function fmtDate(iso: string) {
    return formatInTimeZone(new Date(iso), 'Asia/Dubai', 'd MMM yyyy')
  }

  // 6. Enrich requests
  const enriched: EnrichedRequest[] = requests.map(req => {
    const requestor = userMap.get(req.requested_by)
    const resolver  = req.resolved_by ? userMap.get(req.resolved_by) : null

    let target_label    = req.target_id
    let target_customer = '—'
    let target_date     = '—'

    if (req.target_table === 'payment') {
      const p = paymentMap.get(req.target_id)
      if (p) {
        target_label    = `${p.payment_number} · AED ${parseFloat(String(p.amount)).toFixed(2)}`
        target_customer = p.customers?.full_name ?? '—'
        target_date     = fmtDate(p.payment_date + 'T00:00:00Z')
      }
    } else if (req.target_table === 'order') {
      const o = orderMap.get(req.target_id)
      if (o) {
        target_label    = `${o.order_number} · AED ${parseFloat(String(o.total_amount)).toFixed(2)}`
        target_customer = o.customers?.full_name ?? '—'
        target_date     = fmtDate(o.order_date + 'T00:00:00Z')
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
  })

  const pendingCount = enriched.filter(r => r.status === 'pending').length
  const isOwnerOrManager = ['owner', 'manager'].includes(user.role)

  return (
    <ApprovalsModule
      requests={enriched}
      pendingCount={pendingCount}
      isOwnerOrManager={isOwnerOrManager}
    />
  )
}
