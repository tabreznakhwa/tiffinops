'use server'

import { revalidatePath } from 'next/cache'
import { formatInTimeZone } from 'date-fns-tz'
import { requireAuth } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { parseWhatsAppOrders } from '@/lib/orders/parse-whatsapp'
import type { Enums } from '@/lib/supabase/types'
import type { MealPeriod, MenuItemRef, CustomerRef, ParseResult } from '@/lib/orders/parse-whatsapp'

const WRITE_ROLES: Enums<'user_role'>[] = ['owner', 'manager', 'data_entry']

type Admin = ReturnType<typeof createAdminClient>

// ── Menu loading ─────────────────────────────────────────────────────────────

/**
 * Available menu items with the price that applies on `date` — a daily menu
 * override when one is published, otherwise the item's default price.
 *
 * Scoped to `meal` when that meal has any items, so "Rumali Roti" listed under
 * both lunch and dinner doesn't come back as an ambiguous match. Falls back to
 * the whole menu when the meal has nothing configured.
 */
async function loadMenu(admin: Admin, date: string, meal: MealPeriod | null): Promise<MenuItemRef[]> {
  const [{ data: items }, { data: dailyMenu }] = await Promise.all([
    admin.from('menu_items').select('id, name, meal_period, default_price').eq('is_available', true),
    admin.from('daily_menus').select('id').eq('menu_date', date).eq('is_published', true).maybeSingle(),
  ])

  const overrides = new Map<string, number>()
  const unavailable = new Set<string>()
  if (dailyMenu?.id) {
    const { data: dmi } = await admin
      .from('daily_menu_items')
      .select('menu_item_id, price_override, is_available')
      .eq('daily_menu_id', dailyMenu.id)
    for (const d of dmi ?? []) {
      if (d.price_override != null) overrides.set(d.menu_item_id, parseFloat(String(d.price_override)))
      if (d.is_available === false) unavailable.add(d.menu_item_id)
    }
  }

  const all = (items ?? [])
    .filter(m => !unavailable.has(m.id))
    .map(m => ({
      id: m.id,
      name: m.name,
      meal_period: String(m.meal_period),
      price: overrides.get(m.id) ?? parseFloat(String(m.default_price)),
    }))

  if (!meal) return all
  const forMeal = all.filter(m => m.meal_period === meal)
  return forMeal.length ? forMeal : all
}

async function loadCustomers(admin: Admin): Promise<CustomerRef[]> {
  const { data } = await admin
    .from('customers')
    .select('id, full_name, customer_code, mobile_number')
    .in('status', ['active', 'paused'])
  return (data ?? []) as CustomerRef[]
}

// ── Parse ────────────────────────────────────────────────────────────────────

export type ParsePasteResult = {
  error?: string
  result?: ParseResult
  /** The menu the parse ran against — powers the correction dropdowns. */
  menu?: MenuItemRef[]
  /** Active customers, for reassigning an unmatched block. */
  customers?: CustomerRef[]
}

export async function parseOrderPaste(
  raw: string,
  overrides?: { date?: string; meal?: MealPeriod },
): Promise<ParsePasteResult> {
  const user = await requireAuth()
  if (!WRITE_ROLES.includes(user.role)) return { error: 'Insufficient permissions' }
  if (!raw.trim()) return { error: 'Paste the WhatsApp messages first' }

  const admin = createAdminClient()
  const today = formatInTimeZone(new Date(), 'Asia/Dubai', 'yyyy-MM-dd')

  // First pass with the full menu, purely to read the date/meal out of the
  // header, then reload the menu scoped to that meal and parse for real.
  const customers = await loadCustomers(admin)
  const probeMenu = await loadMenu(admin, overrides?.date ?? today, null)
  const probe = parseWhatsAppOrders(raw, { menu: probeMenu, customers, today })

  const date = overrides?.date ?? probe.orderDate ?? today
  const meal = overrides?.meal ?? probe.mealPeriod ?? null

  const menu = await loadMenu(admin, date, meal)
  const result = parseWhatsAppOrders(raw, {
    menu,
    customers,
    today: date,
    defaultMeal: meal ?? undefined,
  })

  return {
    result: { ...result, orderDate: date, mealPeriod: meal },
    menu,
    customers,
  }
}

/** Menu items for the review screen's correction dropdowns. */
export async function getMenuForMeal(date: string, meal: MealPeriod | null): Promise<MenuItemRef[]> {
  await requireAuth()
  return loadMenu(createAdminClient(), date, meal)
}

// ── Commit ───────────────────────────────────────────────────────────────────

export type CommitOrderInput = {
  /** Parsed order index, echoed back so the UI can mark the right row. */
  ref: number
  customer_id: string
  order_date: string
  meal_period: MealPeriod
  notes?: string | null
  items: {
    menu_item_id: string
    item_name_snapshot: string
    quantity: number
    unit_price: string
  }[]
}

export type CommitResult = {
  error?: string
  created?: { ref: number; order_number: string }[]
  /** Already had an order for that customer/date/meal — not written again. */
  skipped?: { ref: number; reason: string }[]
  failed?: { ref: number; reason: string }[]
}

export async function commitParsedOrders(orders: CommitOrderInput[]): Promise<CommitResult> {
  const user = await requireAuth()
  if (!WRITE_ROLES.includes(user.role)) return { error: 'Insufficient permissions' }
  if (!orders.length) return { error: 'Nothing selected to import' }

  const admin = createAdminClient()
  const failed: { ref: number; reason: string }[] = []
  const skipped: { ref: number; reason: string }[] = []

  // Validate up front
  const valid = orders.filter(o => {
    if (!o.customer_id) { failed.push({ ref: o.ref, reason: 'No customer selected' }); return false }
    if (!o.items.length) { failed.push({ ref: o.ref, reason: 'No items' }); return false }
    if (o.items.some(i => !i.menu_item_id)) {
      failed.push({ ref: o.ref, reason: 'An item is not linked to the menu' }); return false
    }
    return true
  })
  if (!valid.length) return { failed, skipped, created: [] }

  // Guard against a double click, or the same list being pasted twice: skip any
  // customer who already has an order for this date and meal.
  const dates = [...new Set(valid.map(o => o.order_date))]
  const meals = [...new Set(valid.map(o => o.meal_period))]
  const { data: existing } = await admin
    .from('orders')
    .select('customer_id, order_date, meal_period')
    .in('customer_id', [...new Set(valid.map(o => o.customer_id))])
    .in('order_date', dates)
    .in('meal_period', meals)
    .not('order_status', 'in', '(cancelled,voided)')

  const taken = new Set((existing ?? []).map(e => `${e.customer_id}|${e.order_date}|${e.meal_period}`))

  const toInsert = valid.filter(o => {
    if (taken.has(`${o.customer_id}|${o.order_date}|${o.meal_period}`)) {
      skipped.push({ ref: o.ref, reason: 'Already has an order for this date and meal' })
      return false
    }
    return true
  })
  if (!toInsert.length) return { failed, skipped, created: [] }

  // next_order_number() is backed by nextval(), so parallel calls are safe and
  // each returns a distinct number.
  const numbers = await Promise.all(
    toInsert.map(async () => {
      const { data, error } = await admin.rpc('next_order_number')
      return error ? null : (data as string)
    }),
  )
  if (numbers.some(n => !n)) {
    return { error: 'Could not generate order numbers — run 03_order_enhancements.sql', failed, skipped }
  }

  // Explicit ids so order_items can be batched without relying on insert order.
  const rows = toInsert.map((o, i) => {
    const subtotal = o.items.reduce((s, it) => s + it.quantity * parseFloat(it.unit_price), 0)
    return {
      id: crypto.randomUUID(),
      order_number: numbers[i] as string,
      customer_id: o.customer_id,
      order_date: o.order_date,
      meal_period: o.meal_period,
      subtotal: subtotal.toFixed(2),
      discount_amount: '0.00',
      delivery_charge: '0.00',
      total_amount: subtotal.toFixed(2),
      payment_status: 'unpaid' as const,
      order_status: 'confirmed' as const,
      is_credit: true,
      notes: o.notes?.trim() || null,
      created_by: user.id,
      _ref: o.ref,
      _items: o.items,
    }
  })

  const { error: orderErr } = await admin.from('orders').insert(
    rows.map(({ _ref, _items, ...r }) => { void _ref; void _items; return r }),
  )
  if (orderErr) return { error: orderErr.message, failed, skipped }

  const { error: itemErr } = await admin.from('order_items').insert(
    rows.flatMap(r =>
      r._items.map(it => ({
        order_id: r.id,
        menu_item_id: it.menu_item_id,
        item_name_snapshot: it.item_name_snapshot,
        quantity: String(it.quantity),
        unit_price: it.unit_price,
        total_price: (it.quantity * parseFloat(it.unit_price)).toFixed(2),
      })),
    ),
  )
  if (itemErr) {
    // Roll back the orders so we never leave an order with no lines.
    await admin.from('orders').delete().in('id', rows.map(r => r.id))
    return { error: `Items failed, no orders were created: ${itemErr.message}`, failed, skipped }
  }

  revalidatePath('/orders')
  revalidatePath('/bills')
  revalidatePath('/customers')

  return {
    created: rows.map(r => ({ ref: r._ref, order_number: r.order_number })),
    skipped,
    failed,
  }
}
