export const dynamic = 'force-dynamic'

import { formatInTimeZone } from 'date-fns-tz'
import { requireRole } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { ScanBillModule } from '@/components/scan/scan-bill-module'

export default async function ScanBillPage() {
  const user = await requireRole(['owner', 'manager', 'data_entry', 'accounts'])
  const admin = createAdminClient()

  const [{ data: suppliers }, { data: items }] = await Promise.all([
    admin.from('suppliers').select('id, name, supplier_code, phone').eq('is_active', true).order('name'),
    admin
      .from('inventory_items')
      .select('id, name, unit_of_measure, category, purchase_price, pack_unit, pack_size')
      .eq('is_active', true)
      .order('name'),
  ])

  return (
    <ScanBillModule
      suppliers={suppliers ?? []}
      items={items ?? []}
      todayDubai={formatInTimeZone(new Date(), 'Asia/Dubai', 'yyyy-MM-dd')}
      canCreateMasters={['owner', 'manager'].includes(user.role)}
      canRecordPurchase={['owner', 'manager', 'data_entry'].includes(user.role)}
      canRecordExpense={['owner', 'manager', 'accounts'].includes(user.role)}
    />
  )
}
