import { requireAuth } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSettings } from '@/lib/settings/getSettings'
import { CashBookModule } from '@/components/cash-book/cash-book-module'
import type { CashRow } from '@/components/cash-book/cash-book-module'

export const dynamic = 'force-dynamic'

export default async function CashBookPage() {
  const user = await requireAuth()
  const canView = ['owner', 'manager', 'accounts'].includes(user.role)
  if (!canView) {
    return (
      <div className="flex items-center justify-center h-48">
        <p className="text-sm font-semibold" style={{ color: 'var(--color-muted)' }}>
          You don't have permission to view the Cash Book.
        </p>
      </div>
    )
  }

  const admin = createAdminClient()
  const [settings, { data: payments }] = await Promise.all([
    getSettings(),
    admin
      .from('payments')
      .select('id, payment_number, payment_date, amount, mode, notes, is_advance, customers(full_name, customer_code)')
      .eq('mode', 'cash')
      .is('voided_at', null)
      .order('payment_date', { ascending: true })
      .order('created_at', { ascending: true }),
  ])

  return (
    <CashBookModule
      rows={(payments ?? []) as unknown as CashRow[]}
      openingBalance={parseFloat(settings.cash_opening_balance ?? '0')}
      openingDate={settings.opening_balance_date ?? null}
      currency={settings.currency}
    />
  )
}
