import { requireAuth } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { InvoicesModule } from '@/components/invoices/invoices-module'
import { nextMonth } from '@/lib/invoices/generateMonthlyInvoices'
import { formatInTimeZone } from 'date-fns-tz'
import type { Enums } from '@/lib/supabase/types'

export const dynamic = 'force-dynamic'

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
    area: string | null
  } | null
  invoice_items?: {
    description: string
    quantity: string
    unit_price: string
    order_id: string | null
  }[]
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

  // Supabase caps a select at 1,000 rows. Without paging the list silently
  // truncated once the business passed 1,000 invoices, which also made the
  // status tab counts wrong.
  const PAGE = 1000

  async function fetchAllInvoices(): Promise<InvoiceWithCustomer[]> {
    const out: InvoiceWithCustomer[] = []
    let offset = 0
    while (true) {
      const { data } = await admin
        .from('invoices')
        .select(`
          id, invoice_number, customer_id, invoice_date, due_date,
          invoice_type, billing_period_start, billing_period_end,
          subtotal, discount_amount, tax_amount, total_amount,
          status, notes, created_at,
          customers(full_name, customer_code, area)
        `)
        .order('invoice_date', { ascending: false })
        .order('created_at', { ascending: false })
        .range(offset, offset + PAGE - 1)
      const batch = (data ?? []) as unknown as InvoiceWithCustomer[]
      out.push(...batch)
      if (batch.length < PAGE) break
      offset += PAGE
    }
    return out
  }

  const [invoices, { count: activeSubCount }] = await Promise.all([
    fetchAllInvoices(),
    admin
      .from('customer_subscriptions')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'active'),
  ])

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
