export const dynamic = 'force-dynamic'

import { formatInTimeZone } from 'date-fns-tz'
import { requireAuth } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { ExpensesModule, type ExpenseRow } from '@/components/expenses/expenses-module'

export default async function ExpensesPage() {
  const user = await requireAuth()
  const canView = ['owner', 'manager', 'accounts'].includes(user.role)
  if (!canView) {
    return (
      <div className="flex items-center justify-center h-48">
        <p className="text-sm font-semibold" style={{ color: 'var(--color-muted)' }}>
          You don&apos;t have permission to view Expenses.
        </p>
      </div>
    )
  }

  const admin = createAdminClient()
  const { data: expenses } = await admin
    .from('expenses')
    .select('id, expense_number, expense_date, category, vendor_name, description, amount, payment_method, receipt_path, notes')
    .order('expense_date', { ascending: false })
    .order('created_at', { ascending: false })

  return (
    <ExpensesModule
      rows={(expenses ?? []) as ExpenseRow[]}
      todayDubai={formatInTimeZone(new Date(), 'Asia/Dubai', 'yyyy-MM-dd')}
      isOwner={user.role === 'owner'}
    />
  )
}
