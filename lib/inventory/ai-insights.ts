'use server'

// AI Cost Advisor for the inventory module.
//
// generateInventoryInsights() aggregates the last 90 days of stock movement
// server-side (no AI involved in the numbers), sends the compact summary to
// Claude and stores the structured recommendations in ai_insight_reports.
// The AI only interprets pre-computed figures — it never touches the database.

import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { formatInTimeZone } from 'date-fns-tz'
import { requireAuth } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Enums, Json } from '@/lib/supabase/types'

// Same model as lib/scan/extract.ts and lib/whatsapp — keep in sync.
const MODEL = 'claude-opus-5'

const ADVISOR_ROLES: Enums<'user_role'>[] = ['owner', 'manager']

// ── Report contract ──────────────────────────────────────────────────────────

// Not exported — 'use server' files may only export async functions.
const INSIGHT_CATEGORIES = [
  'price_rise',
  'supplier_switch',
  'wastage',
  'overstock',
  'consumption',
  'low_stock',
  'other',
] as const

const InsightReportSchema = z.object({
  /** 2-3 sentence plain-language overview for the owner. */
  summary: z.string().min(1),
  insights: z.array(
    z.object({
      severity: z.enum(['high', 'medium', 'info']),
      category: z.enum(INSIGHT_CATEGORIES),
      title: z.string().min(1),
      detail: z.string().min(1),
      /** Realistic estimate, null when a number would be a guess. */
      potential_monthly_saving_aed: z.number().min(0).nullable(),
      item_names: z.array(z.string()),
    }),
  ),
})

export type InsightReport = z.infer<typeof InsightReportSchema>

export type InsightReportRow = {
  id: string
  report: InsightReport
  period_from: string | null
  period_to: string | null
  created_at: string
}

const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'insights'],
  properties: {
    summary: { type: 'string' },
    insights: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['severity', 'category', 'title', 'detail', 'potential_monthly_saving_aed', 'item_names'],
        properties: {
          severity: { type: 'string', enum: ['high', 'medium', 'info'] },
          category: { type: 'string', enum: [...INSIGHT_CATEGORIES] },
          title: { type: 'string' },
          detail: { type: 'string' },
          potential_monthly_saving_aed: { anyOf: [{ type: 'number' }, { type: 'null' }] },
          item_names: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
} as const

// ── Aggregation (deterministic, server-side) ────────────────────────────────

type ItemAgg = {
  name: string
  category: string | null
  unit: string
  current_stock: number
  min_stock_level: number
  price: number
  stock_value: number
  consumed_qty: number
  consumed_value: number
  wasted_value: number
  /** Per-supplier average unit price paid in the period. */
  supplier_prices: Map<string, { total: number; qty: number }>
  first_price: number | null
  last_price: number | null
}

async function buildAggregation(admin: ReturnType<typeof createAdminClient>, from: string, to: string) {
  const [{ data: items }, { data: txns }, { data: purchaseLines }] = await Promise.all([
    admin
      .from('inventory_items')
      .select('id, name, category, unit_of_measure, current_stock, min_stock_level, purchase_price')
      .eq('is_active', true),
    admin
      .from('inventory_transactions')
      .select('item_id, transaction_type, transaction_date, quantity, total_value')
      .gte('transaction_date', from)
      .lte('transaction_date', to)
      .in('transaction_type', ['consumption', 'damaged']),
    admin
      .from('purchase_items')
      .select('inventory_item_id, quantity, unit_price, purchases!inner(purchase_date, voided_at, suppliers(name))')
      .gte('purchases.purchase_date', from)
      .lte('purchases.purchase_date', to),
  ])

  const byId = new Map<string, ItemAgg>()
  for (const i of items ?? []) {
    const stock = parseFloat(String(i.current_stock))
    const price = parseFloat(String(i.purchase_price))
    byId.set(i.id, {
      name: i.name,
      category: i.category,
      unit: i.unit_of_measure,
      current_stock: stock,
      min_stock_level: parseFloat(String(i.min_stock_level)),
      price,
      stock_value: stock * price,
      consumed_qty: 0,
      consumed_value: 0,
      wasted_value: 0,
      supplier_prices: new Map(),
      first_price: null,
      last_price: null,
    })
  }

  for (const t of txns ?? []) {
    const agg = byId.get(t.item_id)
    if (!agg) continue
    const value = t.total_value != null ? parseFloat(String(t.total_value)) : 0
    if (t.transaction_type === 'consumption') {
      agg.consumed_qty += Math.abs(parseFloat(String(t.quantity)))
      agg.consumed_value += value
    } else {
      agg.wasted_value += value
    }
  }

  type JoinedLine = {
    inventory_item_id: string
    quantity: string
    unit_price: string
    purchases: { purchase_date: string; voided_at: string | null; suppliers: { name: string } | null }
  }
  const sortedLines = ((purchaseLines ?? []) as unknown as JoinedLine[])
    .filter(l => !l.purchases.voided_at)
    .sort((a, b) => a.purchases.purchase_date.localeCompare(b.purchases.purchase_date))
  for (const line of sortedLines) {
    const agg = byId.get(line.inventory_item_id)
    if (!agg) continue
    const price = parseFloat(String(line.unit_price))
    const qty = parseFloat(String(line.quantity))
    if (agg.first_price == null) agg.first_price = price
    agg.last_price = price
    const supplier = line.purchases.suppliers?.name ?? 'Unknown supplier'
    const s = agg.supplier_prices.get(supplier) ?? { total: 0, qty: 0 }
    s.total += price * qty
    s.qty += qty
    agg.supplier_prices.set(supplier, s)
  }

  // Keep the prompt small: top 40 items by money moved (consumption + stock value).
  const ranked = [...byId.values()].sort(
    (a, b) => b.consumed_value + b.wasted_value + b.stock_value - (a.consumed_value + a.wasted_value + a.stock_value),
  )
  const top = ranked.slice(0, 40).map(a => ({
    name: a.name,
    category: a.category,
    unit: a.unit,
    current_stock: +a.current_stock.toFixed(2),
    min_stock_level: +a.min_stock_level.toFixed(2),
    current_price_aed: +a.price.toFixed(2),
    stock_value_aed: +a.stock_value.toFixed(0),
    consumed_qty_period: +a.consumed_qty.toFixed(2),
    consumed_value_aed_period: +a.consumed_value.toFixed(0),
    wasted_value_aed_period: +a.wasted_value.toFixed(0),
    first_price_paid_aed: a.first_price != null ? +a.first_price.toFixed(2) : null,
    last_price_paid_aed: a.last_price != null ? +a.last_price.toFixed(2) : null,
    avg_price_by_supplier: Object.fromEntries(
      [...a.supplier_prices.entries()].map(([name, s]) => [name, +(s.total / (s.qty || 1)).toFixed(2)]),
    ),
  }))

  const totals = {
    period_from: from,
    period_to: to,
    total_stock_value_aed: +ranked.reduce((s, a) => s + a.stock_value, 0).toFixed(0),
    total_consumed_value_aed: +ranked.reduce((s, a) => s + a.consumed_value, 0).toFixed(0),
    total_wasted_value_aed: +ranked.reduce((s, a) => s + a.wasted_value, 0).toFixed(0),
    low_stock_items: ranked.filter(a => a.current_stock <= a.min_stock_level && a.min_stock_level > 0).map(a => a.name),
    slow_movers_with_stock: ranked
      .filter(a => a.consumed_qty === 0 && a.stock_value > 20)
      .slice(0, 15)
      .map(a => ({ name: a.name, stock_value_aed: +a.stock_value.toFixed(0) })),
  }

  return { totals, items: top }
}

// ── Prompt ───────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are the cost advisor for Apna Chulha, a home-style Indian tiffin (meal delivery) kitchen in Dubai. You receive pre-computed inventory figures for the last ~90 days: per-item consumption, wastage, stock values, and the purchase prices paid (first vs last price, and average price per supplier).

Write practical, money-focused advice for the owner. Rules:
- Plain simple English a busy kitchen owner reads in 30 seconds. No jargon.
- Every insight must point at specific items or suppliers from the data. Never invent items, suppliers or numbers not in the data.
- Look for: prices that went up between first and last purchase (price_rise); the same item bought cheaper from another supplier (supplier_switch); wastage worth real money (wastage); cash locked in stock that is not being consumed (overstock); unusually expensive consumption patterns (consumption); items running low (low_stock).
- potential_monthly_saving_aed: a realistic monthly estimate derived from the data (e.g. price difference × monthly consumption). Use null when any number would be a guess. Never inflate.
- severity: "high" = clear money being lost now; "medium" = worth acting on this month; "info" = good to know.
- 3 to 8 insights, most valuable first. If the data is too thin for a category, skip it — do not pad.
- summary: 2-3 sentences: overall spend health and the single biggest opportunity.

Respond only with the structured JSON.`

// ── Actions ──────────────────────────────────────────────────────────────────

export type GenerateInsightsResult = { report?: InsightReportRow; error?: string }

export async function generateInventoryInsights(): Promise<GenerateInsightsResult> {
  const user = await requireAuth()
  if (!ADVISOR_ROLES.includes(user.role)) return { error: 'Only owner/manager can generate AI insights' }
  if (!process.env.ANTHROPIC_API_KEY) return { error: 'ANTHROPIC_API_KEY is not set' }

  const admin = createAdminClient()
  const to = formatInTimeZone(new Date(), 'Asia/Dubai', 'yyyy-MM-dd')
  const from = formatInTimeZone(new Date(Date.now() - 90 * 86400_000), 'Asia/Dubai', 'yyyy-MM-dd')

  const data = await buildAggregation(admin, from, to)
  if (!data.items.length) {
    return { error: 'Not enough inventory activity yet — record some purchases and consumption first.' }
  }

  const client = new Anthropic()
  let parsedReport: InsightReport
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: `Inventory data (AED, last 90 days):\n${JSON.stringify(data)}` }],
        },
      ],
      output_config: { format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
    })
    const textBlock = response.content.find(b => b.type === 'text')
    if (!textBlock || textBlock.type !== 'text') return { error: 'No response from AI — try again' }
    const validated = InsightReportSchema.safeParse(JSON.parse(textBlock.text))
    if (!validated.success) return { error: 'AI returned an unexpected format — try again' }
    parsedReport = validated.data
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) return { error: 'AI is busy right now — try again in a minute' }
    if (err instanceof Anthropic.APIConnectionError) return { error: 'Could not reach the AI service — check the connection' }
    return { error: err instanceof Error ? err.message : 'AI analysis failed' }
  }

  const { data: row, error } = await admin
    .from('ai_insight_reports')
    .insert({
      scope: 'inventory',
      report: parsedReport as unknown as Json,
      period_from: from,
      period_to: to,
      created_by: user.id,
    })
    .select('id, report, period_from, period_to, created_at')
    .single()
  if (error || !row) return { error: error?.message ?? 'Could not save the report' }

  return {
    report: {
      id: row.id,
      report: parsedReport,
      period_from: row.period_from,
      period_to: row.period_to,
      created_at: row.created_at,
    },
  }
}
