export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { formatInTimeZone } from 'date-fns-tz'
import { requireRole } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { PurchaseForm } from '@/components/inventory/purchase-form'
import type { Enums } from '@/lib/supabase/types'

const TXN_ROLES: Enums<'user_role'>[] = ['owner', 'manager', 'data_entry']

export default async function NewPurchasePage() {
  await requireRole(TXN_ROLES)

  const admin = createAdminClient()

  const [{ data: suppliers }, { data: items }] = await Promise.all([
    admin.from('suppliers').select('*').eq('is_active', true).order('name'),
    admin.from('inventory_items').select('*').eq('is_active', true).order('name'),
  ])

  const todayDubai = formatInTimeZone(new Date(), 'Asia/Dubai', 'yyyy-MM-dd')

  return (
    <div>
      <Link
        href="/inventory/purchases"
        className="inline-flex items-center gap-1.5 text-sm font-semibold mb-5 transition-opacity hover:opacity-70"
        style={{ color: 'var(--color-muted)' }}
      >
        <ArrowLeft size={15} />
        Purchases
      </Link>

      <div className="mb-5">
        <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--color-saffron)', letterSpacing: '.12em' }}>
          New Purchase
        </p>
        <h1 className="font-display font-bold text-[25px] mt-0.5" style={{ color: 'var(--color-ink)' }}>
          Record Purchase Invoice
        </h1>
      </div>

      <PurchaseForm suppliers={suppliers ?? []} items={items ?? []} todayDubai={todayDubai} />
    </div>
  )
}
