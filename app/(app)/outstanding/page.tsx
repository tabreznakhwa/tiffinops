export const dynamic = 'force-dynamic'

import { formatInTimeZone } from 'date-fns-tz'
import { requireAuth } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSettings } from '@/lib/settings/getSettings'
import { getCustomerBalancesInRange } from '@/lib/db/aggregates'
import { chargeForCustomer, groupSubscriptionsByCustomer } from '@/lib/billing/subscription-charge'
import { OutstandingModule } from '@/components/outstanding/outstanding-module'
import type { OutstandingRow } from '@/components/outstanding/outstanding-module'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export default async function OutstandingPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>
}) {
  const user = await requireAuth()
  const canView = ['owner', 'manager', 'accounts', 'data_entry'].includes(user.role)
  if (!canView) {
    return (
      <div className="flex items-center justify-center h-48">
        <p className="text-sm font-semibold" style={{ color: 'var(--color-muted)' }}>
          You don&apos;t have permission to view this report.
        </p>
      </div>
    )
  }

  const sp = await searchParams
  const today = formatInTimeZone(new Date(), 'Asia/Dubai', 'yyyy-MM-dd')

  const rangeFrom = sp.from && DATE_RE.test(sp.from) ? sp.from : ''
  const rangeTo   = sp.to   && DATE_RE.test(sp.to)   ? sp.to   : ''

  // Effective window used for every charge/payment aggregate below
  const effectiveFrom = rangeFrom || '2000-01-01'
  const effectiveTo   = rangeTo   || today

  const admin = createAdminClient()

  const [
    settings,
    { data: customers },
    { data: subsData },
    balances,
  ] = await Promise.all([
    getSettings(),
    admin
      .from('customers')
      .select('id, full_name, customer_code, customer_type, payment_terms, mobile_number, area, status')
      .in('status', ['active', 'paused'])
      .order('full_name', { ascending: true }),
    // Every subscription row — all statuses. Needed so overlapping rows can be
    // clamped before charges are summed.
    admin
      .from('customer_subscriptions')
      .select('id, customer_id, start_date, end_date, agreed_monthly_price, status'),
    // Per-customer order and payment totals, aggregated in Postgres
    getCustomerBalancesInRange(admin, effectiveFrom, effectiveTo),
  ])

  const customerList = customers ?? []
  const allSubs = (subsData ?? []) as {
    id: string
    customer_id: string
    start_date: string
    end_date: string | null
    agreed_monthly_price: string
    status: string
  }[]

  const balanceMap = new Map(balances.map(b => [b.customer_id, b]))
  const subsByCustomer = groupSubscriptionsByCustomer(allSubs)

  const rows: OutstandingRow[] = customerList
    .map(c => {
      const bal = balanceMap.get(c.id)
      const orderBilled = bal?.order_total ?? 0
      const totalPaid   = bal?.payment_total ?? 0

      const custSubs = subsByCustomer.get(c.id) ?? []
      const subCharge = chargeForCustomer(custSubs, effectiveFrom, effectiveTo)

      // The subscription shown in the table = the live one (active or paused),
      // preferring the most recently started.
      const current = custSubs
        .filter(s => s.status === 'active' || s.status === 'paused')
        .sort((a, b) => b.start_date.localeCompare(a.start_date))[0]

      const totalBilled = orderBilled + subCharge

      return {
        id:            c.id,
        full_name:     c.full_name,
        customer_code: c.customer_code,
        customer_type: c.customer_type,
        payment_terms: c.payment_terms,
        mobile_number: c.mobile_number ?? '',
        area:          c.area,
        orderBilled,
        subCharge,
        totalBilled,
        totalPaid,
        outstanding:   totalBilled - totalPaid,
        monthlyRate:   current ? parseFloat(String(current.agreed_monthly_price)) : 0,
        subPaused:     current?.status === 'paused',
        subId:         current?.id ?? null,
        subStartDate:  current?.start_date ?? null,
        subEndDate:    current?.end_date ?? null,
      }
    })
    .filter(r => r.outstanding > 0.005)
    .sort((a, b) => b.outstanding - a.outstanding)

  return (
    <OutstandingModule
      rows={rows}
      totalCustomers={customerList.length}
      currency={settings.currency}
      userRole={user.role}
      rangeFrom={rangeFrom}
      rangeTo={rangeTo}
    />
  )
}
