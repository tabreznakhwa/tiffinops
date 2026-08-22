export const dynamic = 'force-dynamic'

import { formatInTimeZone } from 'date-fns-tz'
import { requireAuth } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { PurchasesModule } from '@/components/inventory/purchases-module'
import type { PurchaseRow } from '@/components/inventory/purchases-module'

const TXN_ROLES = ['owner', 'manager', 'data_entry']

export default async function PurchasesPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>
}) {
  const user = await requireAuth()
  const params = await searchParams

  const now = new Date()
  const todayDubai = formatInTimeZone(now, 'Asia/Dubai', 'yyyy-MM-dd')
  const monthStr = formatInTimeZone(now, 'Asia/Dubai', 'yyyy-MM')
  const monthStart = `${monthStr}-01`

  const from = params.from ?? monthStart
  const to = params.to ?? todayDubai

  const admin = createAdminClient()

  const { data } = await admin
    .from('purchases')
    .select(`
      id,
      purchase_number,
      purchase_date,
      payment_status,
      total_amount,
      notes,
      receipt_path,
      voided_at,
      void_reason,
      edited_at,
      suppliers ( name, supplier_code ),
      purchase_items ( quantity )
    `)
    .gte('purchase_date', from)
    .lte('purchase_date', to)
    .order('purchase_date', { ascending: false })
    .order('created_at', { ascending: false })

  return (
    <PurchasesModule
      purchases={(data ?? []) as unknown as PurchaseRow[]}
      canWrite={TXN_ROLES.includes(user.role)}
      isOwner={user.role === 'owner'}
      initialFrom={from}
      initialTo={to}
    />
  )
}
