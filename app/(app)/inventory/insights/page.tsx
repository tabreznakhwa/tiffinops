export const dynamic = 'force-dynamic'

import { formatInTimeZone } from 'date-fns-tz'
import { requireAuth } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { InsightsModule } from '@/components/inventory/insights-module'
import type { InsightsData } from '@/components/inventory/insights-module'

// Supabase caps a single select at 1,000 rows — a year of transactions can exceed that.
const PAGE = 1000

async function fetchAllPages<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null }>,
): Promise<T[]> {
  const out: T[] = []
  let offset = 0
  while (true) {
    const { data } = await build(offset, offset + PAGE - 1)
    const batch = data ?? []
    out.push(...batch)
    if (batch.length < PAGE) break
    offset += PAGE
  }
  return out
}

export default async function InventoryInsightsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>
}) {
  await requireAuth() // read-tier page, no role gate — same as /reports

  const { from: qFrom, to: qTo } = await searchParams

  const todayStr = formatInTimeZone(new Date(), 'Asia/Dubai', 'yyyy-MM-dd')
  const yearAgo = new Date()
  yearAgo.setUTCFullYear(yearAgo.getUTCFullYear() - 1)
  const yearAgoStr = yearAgo.toISOString().split('T')[0]

  const from = qFrom || yearAgoStr
  const to = qTo || todayStr

  const admin = createAdminClient()

  const [transactions, { data: items }, { data: purchases }] = await Promise.all([
    // Transactions in range — every purchase/consumption/adjustment/damaged/opening_stock row,
    // carrying its own unit_price/total_value snapshot (no need to hit purchase_items separately).
    fetchAllPages<{
      item_id: string
      transaction_type: string
      transaction_date: string
      quantity: string
      unit_price: string | null
      total_value: string | null
      inventory_items: { name: string; category: string | null; unit_of_measure: string } | null
    }>(
      (f, t) => admin.from('inventory_transactions')
        .select('item_id, transaction_type, transaction_date, quantity, unit_price, total_value, inventory_items(name, category, unit_of_measure)')
        .gte('transaction_date', from)
        .lte('transaction_date', to)
        .range(f, t) as never,
    ),

    // All items (active + inactive) — for current stock value and low-stock list.
    admin.from('inventory_items').select('*'),

    // Purchase headers in range with supplier name — for supplier-spend breakdown.
    admin.from('purchases')
      .select('supplier_id, purchase_date, total_amount, suppliers(name)')
      .gte('purchase_date', from)
      .lte('purchase_date', to),
  ])

  const data: InsightsData = {
    range: { from, to },
    transactions: transactions.map(t => ({
      item_id: t.item_id,
      transaction_type: t.transaction_type,
      transaction_date: t.transaction_date,
      quantity: parseFloat(t.quantity),
      unit_price: t.unit_price ? parseFloat(t.unit_price) : null,
      total_value: t.total_value ? parseFloat(t.total_value) : null,
      item_name: t.inventory_items?.name ?? 'Unknown',
      category: t.inventory_items?.category ?? null,
      unit_of_measure: t.inventory_items?.unit_of_measure ?? '',
    })),
    items: (items ?? []).map(i => ({
      id: i.id,
      name: i.name,
      category: i.category,
      unit_of_measure: i.unit_of_measure,
      current_stock: parseFloat(i.current_stock),
      min_stock_level: parseFloat(i.min_stock_level),
      purchase_price: parseFloat(i.purchase_price),
      is_active: i.is_active,
    })),
    purchases: (purchases ?? []).map(p => ({
      supplier_id: p.supplier_id,
      supplier_name: (p as unknown as { suppliers: { name: string } | null }).suppliers?.name ?? 'Unknown',
      purchase_date: p.purchase_date,
      total_amount: parseFloat(p.total_amount),
    })),
  }

  return <InsightsModule data={data} />
}
