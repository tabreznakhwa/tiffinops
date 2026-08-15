export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import { requireAuth } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { ItemDetail } from '@/components/inventory/item-detail'

const MASTER_ROLES = ['owner', 'manager']
const TXN_ROLES = ['owner', 'manager', 'data_entry']

export default async function InventoryItemPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const user = await requireAuth()
  const admin = createAdminClient()

  const { data: item } = await admin
    .from('inventory_items')
    .select('*')
    .eq('id', id)
    .single()

  if (!item) notFound()

  const { data: transactions } = await admin
    .from('inventory_transactions')
    .select('*')
    .eq('item_id', id)
    .order('transaction_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(200)

  return (
    <ItemDetail
      item={item}
      transactions={transactions ?? []}
      canManageItem={MASTER_ROLES.includes(user.role)}
      canRecordTxns={TXN_ROLES.includes(user.role)}
    />
  )
}
