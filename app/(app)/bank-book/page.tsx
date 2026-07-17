import { requireAuth } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSettings } from '@/lib/settings/getSettings'
import { BankBookModule } from '@/components/bank-book/bank-book-module'
import type { BankRow } from '@/components/bank-book/bank-book-module'

export const dynamic = 'force-dynamic'

const BANK_MODES = ['bank_transfer', 'card', 'online', 'cheque', 'wallet', 'other'] as const

export default async function BankBookPage() {
  const user = await requireAuth()
  const canView = ['owner', 'manager', 'accounts'].includes(user.role)
  if (!canView) {
    return (
      <div className="flex items-center justify-center h-48">
        <p className="text-sm font-semibold" style={{ color: 'var(--color-muted)' }}>
          You don't have permission to view the Bank Book.
        </p>
      </div>
    )
  }

  const admin = createAdminClient()
  const [settings, { data: payments }] = await Promise.all([
    getSettings(),
    admin
      .from('payments')
      .select('id, payment_number, payment_date, amount, mode, reference_number, notes, is_advance, customers(full_name, customer_code)')
      .in('mode', BANK_MODES)
      .is('voided_at', null)
      .order('payment_date', { ascending: true })
      .order('created_at', { ascending: true }),
  ])

  return (
    <BankBookModule
      rows={(payments ?? []) as unknown as BankRow[]}
      openingBalance={parseFloat(settings.bank_opening_balance ?? '0')}
      openingDate={settings.opening_balance_date ?? null}
      currency={settings.currency}
    />
  )
}
