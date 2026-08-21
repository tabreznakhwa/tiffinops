'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAuth } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Enums } from '@/lib/supabase/types'

type Admin = ReturnType<typeof createAdminClient>

// Master data (items/suppliers) — owner/manager only, same tier as menu_write.
const MASTER_ROLES: Enums<'user_role'>[] = ['owner', 'manager']
// Day-to-day stock movement (purchases/consumption/adjustments) — same tier as orders.
const TXN_ROLES: Enums<'user_role'>[] = ['owner', 'manager', 'data_entry']

export type InventoryActionResult = { error?: string }

// ── Inventory items ─────────────────────────────────────────────────────────

const ItemSchema = z.object({
  name: z.string().min(1, 'Name is required').transform(v => v.trim()),
  category: z.string().optional().transform(v => v?.trim() || null),
  unit_of_measure: z.string().min(1, 'Unit is required').transform(v => v.trim()),
  min_stock_level: z
    .string()
    .optional()
    .transform(v => (v && v.trim() ? v.trim() : '0'))
    .refine(v => !isNaN(parseFloat(v)) && parseFloat(v) >= 0, 'Enter a valid minimum stock level'),
  purchase_price: z
    .string()
    .optional()
    .transform(v => (v && v.trim() ? v.trim() : '0'))
    .refine(v => !isNaN(parseFloat(v)) && parseFloat(v) >= 0, 'Enter a valid price'),
  storage_location: z.string().optional().transform(v => v?.trim() || null),
  notes: z.string().optional().transform(v => v?.trim() || null),
})

function formToRaw(formData: FormData): Record<string, string> {
  return Object.fromEntries([...formData.entries()].map(([k, v]) => [k, v.toString()]))
}

export async function createInventoryItem(formData: FormData): Promise<InventoryActionResult> {
  const user = await requireAuth()
  if (!MASTER_ROLES.includes(user.role)) return { error: 'Only owner/manager can manage inventory items' }

  const parsed = ItemSchema.safeParse(formToRaw(formData))
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Validation error' }

  const admin = createAdminClient()
  const { data: code, error: codeErr } = await admin.rpc('next_inventory_item_code')
  if (codeErr || !code) return { error: 'Could not generate item code — run migrations/032_inventory_module.sql' }

  const { error } = await admin.from('inventory_items').insert({
    ...parsed.data,
    item_code: code,
    created_by: user.id,
  })
  if (error) return { error: error.message }

  revalidatePath('/inventory')
  return {}
}

export async function updateInventoryItem(id: string, formData: FormData): Promise<InventoryActionResult> {
  const user = await requireAuth()
  if (!MASTER_ROLES.includes(user.role)) return { error: 'Only owner/manager can manage inventory items' }

  const parsed = ItemSchema.safeParse(formToRaw(formData))
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Validation error' }

  const admin = createAdminClient()
  const { error } = await admin.from('inventory_items').update(parsed.data).eq('id', id)
  if (error) return { error: error.message }

  revalidatePath('/inventory')
  revalidatePath(`/inventory/${id}`)
  return {}
}

export async function toggleItemActive(id: string, is_active: boolean): Promise<InventoryActionResult> {
  const user = await requireAuth()
  if (!MASTER_ROLES.includes(user.role)) return { error: 'Insufficient permissions' }

  const admin = createAdminClient()
  const { error } = await admin.from('inventory_items').update({ is_active }).eq('id', id)
  if (error) return { error: error.message }

  revalidatePath('/inventory')
  revalidatePath(`/inventory/${id}`)
  return {}
}

// ── Suppliers ────────────────────────────────────────────────────────────────

const SupplierSchema = z.object({
  name: z.string().min(1, 'Name is required').transform(v => v.trim()),
  contact_person: z.string().optional().transform(v => v?.trim() || null),
  phone: z.string().optional().transform(v => v?.trim() || null),
  email: z.string().optional().transform(v => v?.trim() || null),
  address: z.string().optional().transform(v => v?.trim() || null),
  trn: z.string().optional().transform(v => v?.trim() || null),
  notes: z.string().optional().transform(v => v?.trim() || null),
})

export async function createSupplier(formData: FormData): Promise<InventoryActionResult> {
  const user = await requireAuth()
  if (!MASTER_ROLES.includes(user.role)) return { error: 'Only owner/manager can manage suppliers' }

  const parsed = SupplierSchema.safeParse(formToRaw(formData))
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Validation error' }

  const admin = createAdminClient()
  const { data: code, error: codeErr } = await admin.rpc('next_supplier_code')
  if (codeErr || !code) return { error: 'Could not generate supplier code — run migrations/032_inventory_module.sql' }

  const { error } = await admin.from('suppliers').insert({
    ...parsed.data,
    supplier_code: code,
    created_by: user.id,
  })
  if (error) return { error: error.message }

  revalidatePath('/inventory/suppliers')
  return {}
}

export async function updateSupplier(id: string, formData: FormData): Promise<InventoryActionResult> {
  const user = await requireAuth()
  if (!MASTER_ROLES.includes(user.role)) return { error: 'Only owner/manager can manage suppliers' }

  const parsed = SupplierSchema.safeParse(formToRaw(formData))
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Validation error' }

  const admin = createAdminClient()
  const { error } = await admin.from('suppliers').update(parsed.data).eq('id', id)
  if (error) return { error: error.message }

  revalidatePath('/inventory/suppliers')
  return {}
}

export async function toggleSupplierActive(id: string, is_active: boolean): Promise<InventoryActionResult> {
  const user = await requireAuth()
  if (!MASTER_ROLES.includes(user.role)) return { error: 'Insufficient permissions' }

  const admin = createAdminClient()
  const { error } = await admin.from('suppliers').update({ is_active }).eq('id', id)
  if (error) return { error: error.message }

  revalidatePath('/inventory/suppliers')
  return {}
}

// ── Stock movement helpers ──────────────────────────────────────────────────

type StockInfo = { stock: number; price: number }

/** Fetch current_stock + purchase_price for a set of items in one query, keyed by id. */
async function fetchStockMap(admin: Admin, itemIds: string[]): Promise<Map<string, StockInfo>> {
  const { data } = await admin.from('inventory_items').select('id, current_stock, purchase_price').in('id', itemIds)
  const map = new Map<string, StockInfo>()
  for (const row of data ?? []) {
    map.set(row.id, { stock: parseFloat(String(row.current_stock)), price: parseFloat(String(row.purchase_price)) })
  }
  return map
}

// ── Purchases ────────────────────────────────────────────────────────────────

export type RecordPurchaseLine = {
  inventory_item_id: string
  quantity: number
  unit_price: number
}

export type RecordPurchaseInput = {
  supplier_id: string
  purchase_date: string
  payment_status: 'unpaid' | 'partial' | 'paid'
  payment_method?: Enums<'payment_mode'> | null
  notes?: string | null
  /** Storage path of a scanned bill in the receipts bucket (from /scan-bill). */
  receipt_path?: string | null
  items: RecordPurchaseLine[]
}

export async function recordPurchase(input: RecordPurchaseInput): Promise<InventoryActionResult> {
  const user = await requireAuth()
  if (!TXN_ROLES.includes(user.role)) return { error: 'Insufficient permissions' }
  if (!input.supplier_id) return { error: 'Select a supplier' }
  if (!input.items.length) return { error: 'Add at least one item' }
  if (input.items.some(i => !i.inventory_item_id || i.quantity <= 0 || i.unit_price < 0)) {
    return { error: 'Every line needs an item, a positive quantity and a valid price' }
  }

  const admin = createAdminClient()

  const { data: number, error: numErr } = await admin.rpc('next_purchase_number')
  if (numErr || !number) return { error: 'Could not generate purchase number — run migrations/032_inventory_module.sql' }

  const subtotal = input.items.reduce((s, i) => s + i.quantity * i.unit_price, 0)

  const { data: purchase, error: purchaseErr } = await admin
    .from('purchases')
    .insert({
      purchase_number: number,
      supplier_id: input.supplier_id,
      purchase_date: input.purchase_date,
      payment_status: input.payment_status,
      payment_method: input.payment_method ?? null,
      subtotal: subtotal.toFixed(2),
      total_amount: subtotal.toFixed(2),
      notes: input.notes?.trim() || null,
      receipt_path: input.receipt_path ?? null,
      created_by: user.id,
    })
    .select('id')
    .single()
  if (purchaseErr || !purchase) return { error: purchaseErr?.message ?? 'Could not create purchase' }

  const { error: itemsErr } = await admin.from('purchase_items').insert(
    input.items.map(i => ({
      purchase_id: purchase.id,
      inventory_item_id: i.inventory_item_id,
      quantity: i.quantity.toFixed(3),
      unit_price: i.unit_price.toFixed(2),
      total_price: (i.quantity * i.unit_price).toFixed(2),
    })),
  )
  if (itemsErr) {
    await admin.from('purchases').delete().eq('id', purchase.id)
    return { error: `Items failed, purchase was not created: ${itemsErr.message}` }
  }

  // Post stock — one transaction row per line, running from a fresh stock read.
  const stock = await fetchStockMap(admin, [...new Set(input.items.map(i => i.inventory_item_id))])
  const txnRows: {
    item_id: string
    transaction_type: 'purchase'
    transaction_date: string
    quantity: string
    stock_before: string
    stock_after: string
    unit_price: string
    total_value: string
    reference_table: string
    reference_id: string
    created_by: string
  }[] = []
  for (const line of input.items) {
    const before = stock.get(line.inventory_item_id)?.stock ?? 0
    const after = before + line.quantity
    // Last-cost costing: this purchase line becomes the item's current price,
    // so consumption/wastage recorded after it snapshots an up-to-date cost.
    stock.set(line.inventory_item_id, { stock: after, price: line.unit_price })
    txnRows.push({
      item_id: line.inventory_item_id,
      transaction_type: 'purchase',
      transaction_date: input.purchase_date,
      quantity: line.quantity.toFixed(3),
      stock_before: before.toFixed(3),
      stock_after: after.toFixed(3),
      unit_price: line.unit_price.toFixed(2),
      total_value: (line.quantity * line.unit_price).toFixed(2),
      reference_table: 'purchases',
      reference_id: purchase.id,
      created_by: user.id,
    })
  }

  const { error: txnErr } = await admin.from('inventory_transactions').insert(txnRows)
  if (txnErr) {
    await admin.from('purchases').delete().eq('id', purchase.id) // cascades purchase_items
    return { error: `Stock could not be updated, purchase was not created: ${txnErr.message}` }
  }

  for (const [item_id, info] of stock) {
    await admin.from('inventory_items')
      .update({ current_stock: info.stock.toFixed(3), purchase_price: info.price.toFixed(2) })
      .eq('id', item_id)
  }

  revalidatePath('/inventory')
  revalidatePath('/inventory/purchases')
  return {}
}

// ── Daily consumption ────────────────────────────────────────────────────────

export type RecordConsumptionLine = {
  inventory_item_id: string
  quantity: number
  notes?: string | null
}

export type RecordConsumptionInput = {
  consumption_date: string
  entries: RecordConsumptionLine[]
}

export async function recordConsumption(input: RecordConsumptionInput): Promise<InventoryActionResult> {
  const user = await requireAuth()
  if (!TXN_ROLES.includes(user.role)) return { error: 'Insufficient permissions' }
  if (!input.entries.length) return { error: 'Add at least one item' }
  if (input.entries.some(e => !e.inventory_item_id || e.quantity <= 0)) {
    return { error: 'Every line needs an item and a positive quantity' }
  }

  const admin = createAdminClient()
  const stock = await fetchStockMap(admin, [...new Set(input.entries.map(e => e.inventory_item_id))])

  const txnRows = input.entries.map(entry => {
    const info = stock.get(entry.inventory_item_id)
    const before = info?.stock ?? 0
    const price = info?.price ?? 0
    const after = before - entry.quantity
    stock.set(entry.inventory_item_id, { stock: after, price })
    return {
      item_id: entry.inventory_item_id,
      transaction_type: 'consumption' as const,
      transaction_date: input.consumption_date,
      quantity: (-entry.quantity).toFixed(3),
      stock_before: before.toFixed(3),
      stock_after: after.toFixed(3),
      // Snapshot current cost so "consumption in AED" is computable from this row alone.
      unit_price: price.toFixed(2),
      total_value: (entry.quantity * price).toFixed(2),
      notes: entry.notes?.trim() || null,
      created_by: user.id,
    }
  })

  const { error: txnErr } = await admin.from('inventory_transactions').insert(txnRows)
  if (txnErr) return { error: txnErr.message }

  for (const [item_id, info] of stock) {
    await admin.from('inventory_items').update({ current_stock: info.stock.toFixed(3) }).eq('id', item_id)
  }

  revalidatePath('/inventory')
  revalidatePath('/inventory/consumption')
  return {}
}

// ── Adjustments (corrections / damaged goods) ───────────────────────────────

export type RecordAdjustmentInput = {
  inventory_item_id: string
  transaction_date: string
  transaction_type: 'adjustment' | 'damaged'
  /** Signed for 'adjustment' (+/-); always treated as a reduction for 'damaged'. */
  quantity: number
  notes?: string | null
}

export async function recordAdjustment(input: RecordAdjustmentInput): Promise<InventoryActionResult> {
  const user = await requireAuth()
  if (!TXN_ROLES.includes(user.role)) return { error: 'Insufficient permissions' }
  if (!input.inventory_item_id || input.quantity === 0) return { error: 'Select an item and a non-zero quantity' }

  const admin = createAdminClient()
  const stock = await fetchStockMap(admin, [input.inventory_item_id])
  const info = stock.get(input.inventory_item_id)
  const before = info?.stock ?? 0
  const price = info?.price ?? 0
  const signed = input.transaction_type === 'damaged' ? -Math.abs(input.quantity) : input.quantity
  const after = before + signed
  // Wastage has a cost; a plain correction is just fixing the count, not a cost event.
  const isDamaged = input.transaction_type === 'damaged'

  const { error: txnErr } = await admin.from('inventory_transactions').insert({
    item_id: input.inventory_item_id,
    transaction_type: input.transaction_type,
    transaction_date: input.transaction_date,
    quantity: signed.toFixed(3),
    stock_before: before.toFixed(3),
    stock_after: after.toFixed(3),
    unit_price: isDamaged ? price.toFixed(2) : null,
    total_value: isDamaged ? (Math.abs(signed) * price).toFixed(2) : null,
    notes: input.notes?.trim() || null,
    created_by: user.id,
  })
  if (txnErr) return { error: txnErr.message }

  const { error: stockErr } = await admin
    .from('inventory_items')
    .update({ current_stock: after.toFixed(3) })
    .eq('id', input.inventory_item_id)
  if (stockErr) return { error: stockErr.message }

  revalidatePath('/inventory')
  revalidatePath(`/inventory/${input.inventory_item_id}`)
  return {}
}

// ── Opening stock (initial rollout + periodic physical-count corrections) ──

export type RecordOpeningStockInput = {
  as_of_date: string
  entries: { inventory_item_id: string; quantity: number }[]
}

export async function recordOpeningStock(input: RecordOpeningStockInput): Promise<InventoryActionResult> {
  const user = await requireAuth()
  if (!TXN_ROLES.includes(user.role)) return { error: 'Insufficient permissions' }
  if (!input.entries.length) return { error: 'Add at least one item' }
  if (input.entries.some(e => !e.inventory_item_id || e.quantity < 0)) {
    return { error: 'Every line needs an item and a stock count of zero or more' }
  }

  const admin = createAdminClient()
  const stock = await fetchStockMap(admin, [...new Set(input.entries.map(e => e.inventory_item_id))])

  // Absolute set — quantity given IS the new stock level, not a delta.
  const txnRows = input.entries
    .map(entry => {
      const before = stock.get(entry.inventory_item_id)?.stock ?? 0
      const delta = entry.quantity - before
      return { entry, before, delta }
    })
    .filter(({ delta }) => delta !== 0)
    .map(({ entry, before, delta }) => ({
      item_id: entry.inventory_item_id,
      transaction_type: 'opening_stock' as const,
      transaction_date: input.as_of_date,
      quantity: delta.toFixed(3),
      stock_before: before.toFixed(3),
      stock_after: entry.quantity.toFixed(3),
      created_by: user.id,
    }))

  if (txnRows.length) {
    const { error: txnErr } = await admin.from('inventory_transactions').insert(txnRows)
    if (txnErr) return { error: txnErr.message }
  }

  for (const entry of input.entries) {
    await admin.from('inventory_items').update({ current_stock: entry.quantity.toFixed(3) }).eq('id', entry.inventory_item_id)
  }

  revalidatePath('/inventory')
  revalidatePath('/inventory/opening-stock')
  return {}
}
