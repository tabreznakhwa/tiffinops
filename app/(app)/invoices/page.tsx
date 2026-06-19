import { requireAuth } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { InvoicesModule } from '@/components/invoices/invoices-module'
import { nextMonth } from '@/lib/invoices/generateMonthlyInvoices'
import { formatInTimeZone } from 'date-fns-tz'
import type { Enums } from '@/lib/supabase/types'

export type InvoiceWithCustomer = {
  id: string
  invoice_number: string
  customer_id: string
  invoice_date: string
  due_date: string
  invoice_type: Enums<'invoice_type'>
  billing_period_start: string | null
  billing_period_end: string | null
  subtotal: string
  discount_amount: string
  tax_amount: string
  total_amount: string
  status: Enums<'invoice_status'>
  notes: string | null
  created_at: string
  customers: {
    full_name: string
    customer_code: string
  } | null
}

export type StatusCounts = Record<Enums<'invoice_status'> | 'all', number>

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; search?: string }>
}) {
  const user = await requireAuth()
  await searchParams // params resolved in client component

  const admin = createAdminClient()

  const currentDubaiMonth = formatInTimeZone(new Date(), 'Asia/Dubai', 'yyyy-MM')
  const defaultGenerateMonth = nextMonth(currentDubaiMonth)

  const [{ data: rawInvoices }, { count: activeSubCount }] = await Promise.all([
    admin
      .from('invoices')
      .select(`
        id, invoice_number, customer_id, invoice_date, due_date,
        invoice_type, billing_period_start, billing_period_end,
        subtotal, discount_amount, tax_amount, total_amount,
        status, notes, created_at,
        customers(full_name, customer_code)
      `)
      .order('invoice_date', { ascending: false })
      .order('created_at', { ascending: false }),
    admin
      .from('customer_subscriptions')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'active'),
  ])

  const invoices = (rawInvoices ?? []) as unknown as InvoiceWithCustomer[]

  const STATUS_LIST: Enums<'invoice_status'>[] = [
    'draft', 'issued', 'partial', 'paid', 'overdue', 'cancelled', 'written_off',
  ]
  const counts: StatusCounts = { all: invoices.length } as StatusCounts
  for (const s of STATUS_LIST) {
    counts[s] = invoices.filter((inv) => inv.status === s).length
  }

  return (
    <InvoicesModule
      invoices={invoices}
      counts={counts}
      userRole={user.role}
      defaultGenerateMonth={defaultGenerateMonth}
      activeSubCount={activeSubCount ?? 0}
    />
  )
}
