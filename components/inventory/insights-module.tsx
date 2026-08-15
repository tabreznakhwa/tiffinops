'use client'

import { useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, AlertTriangle } from 'lucide-react'
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import { parseISO, startOfWeek, startOfMonth, startOfYear, format } from 'date-fns'
import { useAppSettings } from '@/components/settings/settings-context'

// ── Types ─────────────────────────────────────────────────────────────────────

export type InsightsData = {
  range: { from: string; to: string }
  transactions: {
    item_id: string
    transaction_type: string
    transaction_date: string
    quantity: number
    unit_price: number | null
    total_value: number | null
    item_name: string
    category: string | null
    unit_of_measure: string
  }[]
  items: {
    id: string
    name: string
    category: string | null
    unit_of_measure: string
    current_stock: number
    min_stock_level: number
    purchase_price: number
    is_active: boolean
  }[]
  purchases: {
    supplier_id: string
    supplier_name: string
    purchase_date: string
    total_amount: number
  }[]
}

type Granularity = 'day' | 'week' | 'month' | 'year'

// ── Color palette ─────────────────────────────────────────────────────────────

const C = {
  saffron: '#E76F2A', ember: '#8B2E1F', green: '#2E7D4F',
  blue: '#2C5E8F', purple: '#6B3FA0', gold: '#B7860B',
  red: '#C0392B', muted: '#7C7063', ink: '#221A13',
}
const PIE_COLORS = [C.saffron, C.blue, C.purple, C.green, C.gold, C.ember, C.red, C.muted]

// ── Bucketing ─────────────────────────────────────────────────────────────────

function bucketKey(dateStr: string, g: Granularity): string {
  const d = parseISO(dateStr)
  switch (g) {
    case 'day':   return dateStr
    case 'week':  return format(startOfWeek(d, { weekStartsOn: 1 }), 'yyyy-MM-dd')
    case 'month': return format(startOfMonth(d), 'yyyy-MM')
    case 'year':  return format(startOfYear(d), 'yyyy')
  }
}

function bucketLabel(key: string, g: Granularity): string {
  switch (g) {
    case 'day':   return format(parseISO(key), 'd MMM')
    case 'week':  return `Wk ${format(parseISO(key), 'd MMM')}`
    case 'month': return format(parseISO(`${key}-01`), 'MMM yyyy')
    case 'year':  return key
  }
}

// ── Unit-of-measure normalization ──────────────────────────────────────────────

function classifyUnit(uom: string): 'kg' | 'litres' | 'count' {
  const u = uom.trim().toLowerCase()
  if (['kg', 'g', 'gram', 'grams', 'kilogram', 'kilograms'].includes(u)) return 'kg'
  if (['l', 'litre', 'litres', 'liter', 'liters', 'ml'].includes(u)) return 'litres'
  return 'count'
}

function normalizeQty(qty: number, uom: string): number {
  const u = uom.trim().toLowerCase()
  if (u === 'g' || u === 'gram' || u === 'grams') return qty / 1000
  if (u === 'ml') return qty / 1000
  return qty
}

function isLowStock(item: InsightsData['items'][number]) {
  return item.current_stock <= item.min_stock_level
}

// ── Helper components (mirrors reports-module.tsx) ──────────────────────────────

function KPICard({
  label, value, sub, color = C.ink,
}: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div
      className="rounded-[14px] px-4 py-4 relative overflow-hidden"
      style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}
    >
      <div className="absolute left-0 top-0 bottom-0 w-[3px]" style={{ background: color }} />
      <p className="text-[11px] font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--color-muted)' }}>{label}</p>
      <p className="font-display font-extrabold text-[22px] num leading-none" style={{ color }}>{value}</p>
      {sub && <p className="text-[11px] mt-0.5" style={{ color: 'var(--color-muted)' }}>{sub}</p>}
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-bold uppercase tracking-wide mb-3" style={{ color: 'var(--color-muted)' }}>
      {children}
    </p>
  )
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-[14px] p-4 ${className}`}
      style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}
    >
      {children}
    </div>
  )
}

const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: { value: number; name?: string; color?: string }[]; label?: string }) => {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-[10px] px-3 py-2 text-sm shadow-lg" style={{ background: '#221A13', color: '#fff' }}>
      <p className="font-semibold mb-1">{label}</p>
      {payload.map((p, i) => (
        <p key={i} className="num">{p.name ? `${p.name}: ` : ''}{typeof p.value === 'number' ? p.value.toFixed(2) : p.value}</p>
      ))}
    </div>
  )
}

// ── Main module ───────────────────────────────────────────────────────────────

const GRANULARITIES: { id: Granularity; label: string }[] = [
  { id: 'day', label: 'Day' }, { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' }, { id: 'year', label: 'Year' },
]

export function InsightsModule({ data }: { data: InsightsData }) {
  const { currency } = useAppSettings()
  const router = useRouter()
  const searchParams = useSearchParams()

  const [from, setFrom] = useState(data.range.from)
  const [to, setTo] = useState(data.range.to)
  const [granularity, setGranularity] = useState<Granularity>('month')

  function applyDateRange() {
    const params = new URLSearchParams(searchParams.toString())
    params.set('from', from)
    params.set('to', to)
    router.push(`/inventory/insights?${params.toString()}`)
  }

  function setQuickRange(days: number) {
    const t = new Date()
    const f = new Date(t.getTime() - (days - 1) * 86400000)
    const toStr = t.toISOString().split('T')[0]
    const fromStr = f.toISOString().split('T')[0]
    setFrom(fromStr); setTo(toStr)
    const params = new URLSearchParams(searchParams.toString())
    params.set('from', fromStr); params.set('to', toStr)
    router.push(`/inventory/insights?${params.toString()}`)
  }

  function setThisYear() {
    const now = new Date()
    const fromStr = `${now.getFullYear()}-01-01`
    const toStr = now.toISOString().split('T')[0]
    setFrom(fromStr); setTo(toStr)
    const params = new URLSearchParams(searchParams.toString())
    params.set('from', fromStr); params.set('to', toStr)
    router.push(`/inventory/insights?${params.toString()}`)
  }

  // ── Item spend ranking (for price-trend selector) ──────────────────────────

  const itemSpendRanked = useMemo(() => {
    const map = new Map<string, { name: string; total: number }>()
    for (const t of data.transactions) {
      if (t.transaction_type !== 'purchase' || t.total_value == null) continue
      const cur = map.get(t.item_id) ?? { name: t.item_name, total: 0 }
      map.set(t.item_id, { name: cur.name, total: cur.total + t.total_value })
    }
    return [...map.entries()].sort((a, b) => b[1].total - a[1].total).map(([id, v]) => ({ id, ...v }))
  }, [data.transactions])

  const [selectedItemIds, setSelectedItemIds] = useState<string[]>(
    () => itemSpendRanked.slice(0, 5).map(i => i.id),
  )

  function toggleItem(id: string) {
    setSelectedItemIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  // ── Aggregation (re-buckets client-side whenever granularity changes) ───────

  const agg = useMemo(() => {
    const priceMap = new Map<string, Map<string, { sum: number; count: number }>>() // bucket -> item_id -> avg accum
    const consumptionQty = new Map<string, { kg: number; litres: number; count: number }>()
    const consumptionValue = new Map<string, number>()
    const purchaseValue = new Map<string, number>()
    const categoryValue = new Map<string, number>()
    const consumptionCategoryValue = new Map<string, number>()
    const consumedItems = new Map<string, { name: string; category: string; uom: string; qty: number; value: number }>()
    const buckets = new Set<string>()

    for (const t of data.transactions) {
      const bucket = bucketKey(t.transaction_date, granularity)
      buckets.add(bucket)
      const category = t.category ?? 'Uncategorized'

      if (t.transaction_type === 'purchase') {
        if (t.unit_price != null) {
          const byItem = priceMap.get(bucket) ?? new Map()
          const cur = byItem.get(t.item_id) ?? { sum: 0, count: 0 }
          byItem.set(t.item_id, { sum: cur.sum + t.unit_price, count: cur.count + 1 })
          priceMap.set(bucket, byItem)
        }
        if (t.total_value != null) {
          purchaseValue.set(bucket, (purchaseValue.get(bucket) ?? 0) + t.total_value)
          categoryValue.set(category, (categoryValue.get(category) ?? 0) + t.total_value)
        }
      }

      if (t.transaction_type === 'consumption') {
        const family = classifyUnit(t.unit_of_measure)
        const qty = Math.abs(normalizeQty(t.quantity, t.unit_of_measure))
        const cur = consumptionQty.get(bucket) ?? { kg: 0, litres: 0, count: 0 }
        cur[family] += qty
        consumptionQty.set(bucket, cur)

        const value = Math.abs(t.total_value ?? 0)
        consumptionValue.set(bucket, (consumptionValue.get(bucket) ?? 0) + value)
        categoryValue.set(category, (categoryValue.get(category) ?? 0) + value)
        consumptionCategoryValue.set(category, (consumptionCategoryValue.get(category) ?? 0) + value)

        const itemCur = consumedItems.get(t.item_id) ?? { name: t.item_name, category, uom: t.unit_of_measure, qty: 0, value: 0 }
        consumedItems.set(t.item_id, {
          name: itemCur.name, category: itemCur.category, uom: itemCur.uom,
          qty: itemCur.qty + Math.abs(t.quantity), value: itemCur.value + value,
        })
      }
    }

    const sortedBuckets = [...buckets].sort()

    const priceTrend = sortedBuckets.map(b => {
      const row: Record<string, string | number> = { bucket: b, label: bucketLabel(b, granularity) }
      const byItem = priceMap.get(b)
      for (const id of selectedItemIds) {
        const v = byItem?.get(id)
        if (v) row[id] = v.sum / v.count
      }
      return row
    })

    const consumptionTrend = sortedBuckets.map(b => {
      const q = consumptionQty.get(b) ?? { kg: 0, litres: 0, count: 0 }
      return { bucket: b, label: bucketLabel(b, granularity), kg: q.kg, litres: q.litres, count: q.count }
    })

    const consumptionValueTrend = sortedBuckets.map(b => ({
      bucket: b, label: bucketLabel(b, granularity), value: consumptionValue.get(b) ?? 0,
    }))

    const purchaseVsConsumption = sortedBuckets.map(b => ({
      bucket: b, label: bucketLabel(b, granularity),
      purchases: purchaseValue.get(b) ?? 0, consumption: consumptionValue.get(b) ?? 0,
    }))

    const categorySpendRanked = [...categoryValue.entries()].sort((a, b) => b[1] - a[1])
    const categorySpend = categorySpendRanked.slice(0, 7).map(([category, value]) => ({ category, value }))
    const otherTotal = categorySpendRanked.slice(7).reduce((s, [, v]) => s + v, 0)
    if (otherTotal > 0.005) categorySpend.push({ category: 'Other', value: otherTotal })

    const consumptionByCategoryRanked = [...consumptionCategoryValue.entries()].sort((a, b) => b[1] - a[1])
    const consumptionByCategory = consumptionByCategoryRanked.slice(0, 8).map(([category, value]) => ({ category, value }))
    const consumptionByCategoryOther = consumptionByCategoryRanked.slice(8).reduce((s, [, v]) => s + v, 0)
    if (consumptionByCategoryOther > 0.005) consumptionByCategory.push({ category: 'Other', value: consumptionByCategoryOther })

    const consumedItemsAll = [...consumedItems.entries()]
      .sort((a, b) => b[1].value - a[1].value)
      .map(([id, v]) => ({ id, ...v }))

    return {
      priceTrend, consumptionTrend, consumptionValueTrend, purchaseVsConsumption,
      categorySpend, consumptionByCategory, consumedItemsAll,
    }
  }, [data.transactions, granularity, selectedItemIds])

  // ── Supplier spend ───────────────────────────────────────────────────────────

  const supplierSpend = useMemo(() => {
    const map = new Map<string, number>()
    for (const p of data.purchases) map.set(p.supplier_name, (map.get(p.supplier_name) ?? 0) + p.total_amount)
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, total]) => ({ name, total }))
  }, [data.purchases])

  // ── Consumed-items category filter ──────────────────────────────────────────

  const [itemCategoryFilter, setItemCategoryFilter] = useState('all')

  const consumedCategories = useMemo(
    () => [...new Set(agg.consumedItemsAll.map(i => i.category))].sort(),
    [agg.consumedItemsAll],
  )

  const filteredConsumedItems = useMemo(
    () => itemCategoryFilter === 'all' ? agg.consumedItemsAll : agg.consumedItemsAll.filter(i => i.category === itemCategoryFilter),
    [agg.consumedItemsAll, itemCategoryFilter],
  )
  const displayedConsumedItems = filteredConsumedItems.slice(0, 20)

  // ── KPIs ──────────────────────────────────────────────────────────────────

  const kpis = useMemo(() => {
    const stockValue = data.items.filter(i => i.is_active).reduce((s, i) => s + i.current_stock * i.purchase_price, 0)
    const consumptionAED = data.transactions.filter(t => t.transaction_type === 'consumption').reduce((s, t) => s + Math.abs(t.total_value ?? 0), 0)
    const purchasesAED = data.purchases.reduce((s, p) => s + p.total_amount, 0)
    const wastageAED = data.transactions.filter(t => t.transaction_type === 'damaged').reduce((s, t) => s + Math.abs(t.total_value ?? 0), 0)
    const lowStock = data.items.filter(i => i.is_active && isLowStock(i))
    return { stockValue, consumptionAED, purchasesAED, wastageAED, lowStockCount: lowStock.length, lowStock }
  }, [data.items, data.transactions, data.purchases])

  const fmtAED = (n: number) => `${currency} ${n.toFixed(2)}`

  return (
    <div>
      <Link
        href="/inventory"
        className="inline-flex items-center gap-1.5 text-sm font-semibold transition-opacity hover:opacity-70 mb-4"
        style={{ color: 'var(--color-muted)' }}
      >
        <ArrowLeft size={15} />
        Inventory
      </Link>

      <div className="mb-5">
        <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--color-saffron)', letterSpacing: '.12em' }}>
          Inventory
        </p>
        <h1 className="font-display font-bold text-[25px] mt-0.5" style={{ color: 'var(--color-ink)' }}>
          Insights
        </h1>
      </div>

      {/* Controls */}
      <div
        className="flex flex-wrap items-center gap-2 px-4 py-3 rounded-[12px] mb-5"
        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
      >
        <div className="flex items-center gap-2">
          <input
            type="date" value={from} onChange={e => setFrom(e.target.value)}
            className="rounded-[8px] px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-saffron"
            style={{ background: 'var(--color-cream)', border: '1px solid var(--color-border)', color: 'var(--color-ink)' }}
          />
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>to</span>
          <input
            type="date" value={to} onChange={e => setTo(e.target.value)}
            className="rounded-[8px] px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-saffron"
            style={{ background: 'var(--color-cream)', border: '1px solid var(--color-border)', color: 'var(--color-ink)' }}
          />
          <button
            onClick={applyDateRange}
            className="px-3 py-1.5 rounded-[8px] text-xs font-bold"
            style={{ background: 'var(--color-saffron)', color: '#fff' }}
          >
            Apply
          </button>
        </div>
        <div className="flex gap-1.5 ml-1">
          {[30, 90].map(d => (
            <button key={d} onClick={() => setQuickRange(d)}
              className="px-2.5 py-1 rounded-[7px] text-[11px] font-bold"
              style={{ background: 'var(--color-border)', color: 'var(--color-muted)' }}
            >
              {d}d
            </button>
          ))}
          <button onClick={setThisYear}
            className="px-2.5 py-1 rounded-[7px] text-[11px] font-bold"
            style={{ background: 'var(--color-border)', color: 'var(--color-muted)' }}
          >
            This Year
          </button>
        </div>

        <div className="flex gap-0.5 ml-auto rounded-[9px] p-0.5" style={{ background: 'var(--color-cream)' }}>
          {GRANULARITIES.map(g => (
            <button
              key={g.id}
              onClick={() => setGranularity(g.id)}
              className="px-2.5 py-1.5 rounded-[7px] text-[11px] font-bold transition-colors"
              style={{
                background: granularity === g.id ? 'var(--color-ink)' : 'transparent',
                color: granularity === g.id ? '#fff' : 'var(--color-muted)',
              }}
            >
              {g.label}
            </button>
          ))}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid gap-3 mb-5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
        <KPICard label="Current Stock Value" value={fmtAED(kpis.stockValue)} color={C.blue} sub="active items, at last cost" />
        <KPICard label="Purchases This Period" value={fmtAED(kpis.purchasesAED)} color={C.saffron} />
        <KPICard label="Consumption This Period" value={fmtAED(kpis.consumptionAED)} color={C.ember} />
        <KPICard label="Wastage This Period" value={fmtAED(kpis.wastageAED)} color={C.red} />
        <KPICard label="Low Stock Items" value={String(kpis.lowStockCount)} color={kpis.lowStockCount > 0 ? C.red : C.green} />
      </div>

      {/* Price trend */}
      <Card className="mb-5">
        <SectionTitle>Raw Material Price Trend ({currency})</SectionTitle>
        {itemSpendRanked.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--color-muted)' }}>No purchases recorded in this period.</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {itemSpendRanked.slice(0, 10).map(item => {
                const active = selectedItemIds.includes(item.id)
                return (
                  <button
                    key={item.id}
                    onClick={() => toggleItem(item.id)}
                    className="px-2.5 py-1 rounded-pill text-[11px] font-bold transition-colors"
                    style={{
                      background: active ? 'var(--color-ink)' : 'var(--color-cream)',
                      color: active ? '#fff' : 'var(--color-muted)',
                      border: '1px solid', borderColor: active ? 'var(--color-ink)' : 'var(--color-border)',
                    }}
                  >
                    {item.name}
                  </button>
                )
              })}
            </div>
            {selectedItemIds.length === 0 ? (
              <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Select an item above to see its price trend.</p>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={agg.priceTrend} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#ECE2D3" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: C.muted }} />
                  <YAxis tick={{ fontSize: 11, fill: C.muted }} width={55} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {selectedItemIds.map((id, i) => {
                    const item = itemSpendRanked.find(x => x.id === id)
                    return (
                      <Line
                        key={id} type="monotone" dataKey={id} name={item?.name ?? id}
                        stroke={PIE_COLORS[i % PIE_COLORS.length]} strokeWidth={2}
                        dot={{ r: 2.5 }} connectNulls
                      />
                    )
                  })}
                </LineChart>
              </ResponsiveContainer>
            )}
          </>
        )}
      </Card>

      {/* Consumption trend */}
      <div className="grid gap-4 md:grid-cols-2 mb-5">
        <Card>
          <SectionTitle>Consumption Volume</SectionTitle>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={agg.consumptionTrend} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#ECE2D3" />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: C.muted }} />
              <YAxis tick={{ fontSize: 11, fill: C.muted }} width={45} />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="kg" name="KG" fill={C.green} radius={[3, 3, 0, 0]} />
              <Bar dataKey="litres" name="Litres" fill={C.blue} radius={[3, 3, 0, 0]} />
              <Bar dataKey="count" name="Count" fill={C.gold} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card>
          <SectionTitle>Consumption Value ({currency})</SectionTitle>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={agg.consumptionValueTrend} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#ECE2D3" />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: C.muted }} />
              <YAxis tick={{ fontSize: 11, fill: C.muted }} width={55} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="value" name="Consumption" fill={C.ember} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {/* Purchases vs consumption */}
      <Card className="mb-5">
        <SectionTitle>Purchases vs Consumption ({currency})</SectionTitle>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={agg.purchaseVsConsumption} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#ECE2D3" />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: C.muted }} />
            <YAxis tick={{ fontSize: 11, fill: C.muted }} width={55} />
            <Tooltip content={<CustomTooltip />} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="purchases" name="Purchases" fill={C.saffron} radius={[3, 3, 0, 0]} />
            <Bar dataKey="consumption" name="Consumption" fill={C.ember} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 mb-5">
        {/* Category spend */}
        <Card>
          <SectionTitle>Category Spend ({currency})</SectionTitle>
          {agg.categorySpend.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--color-muted)' }}>No purchase or consumption value in this period.</p>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={agg.categorySpend} dataKey="value" nameKey="category" cx="50%" cy="50%"
                    innerRadius={50} outerRadius={80}
                    label={(props: { name?: string; percent?: number }) => `${props.name ?? ''} ${((props.percent ?? 0) * 100).toFixed(0)}%`}
                    labelLine={false} fontSize={11}>
                    {agg.categorySpend.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
              <div className="mt-2 space-y-1.5">
                {agg.categorySpend.map((c, i) => (
                  <div key={c.category} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                      <span style={{ color: 'var(--color-ink)' }}>{c.category}</span>
                    </div>
                    <span className="num font-semibold" style={{ color: 'var(--color-ink)' }}>{fmtAED(c.value)}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </Card>

        {/* Supplier spend */}
        <Card>
          <SectionTitle>Top Suppliers by Spend ({currency})</SectionTitle>
          {supplierSpend.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--color-muted)' }}>No purchases in this period.</p>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(180, supplierSpend.length * 32)}>
              <BarChart data={supplierSpend} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#ECE2D3" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11, fill: C.muted }} />
                <YAxis dataKey="name" type="category" tick={{ fontSize: 10, fill: C.muted }} width={100} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="total" name={`Spend (${currency})`} fill={C.purple} radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      {/* Consumption by category */}
      <Card className="mb-5">
        <SectionTitle>Consumption by Category ({currency})</SectionTitle>
        {agg.consumptionByCategory.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--color-muted)' }}>No consumption recorded in this period.</p>
        ) : (
          <ResponsiveContainer width="100%" height={Math.max(180, agg.consumptionByCategory.length * 32)}>
            <BarChart data={agg.consumptionByCategory} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#ECE2D3" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11, fill: C.muted }} />
              <YAxis dataKey="category" type="category" tick={{ fontSize: 10, fill: C.muted }} width={110} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="value" name={`Consumption (${currency})`} fill={C.ember} radius={[0, 3, 3, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </Card>

      {/* Consumption by item */}
      <Card className="mb-5">
        <div className="flex items-center justify-between gap-3 mb-3">
          <SectionTitle>Consumption by Item ({currency})</SectionTitle>
          {consumedCategories.length > 0 && (
            <select
              value={itemCategoryFilter}
              onChange={e => setItemCategoryFilter(e.target.value)}
              className="rounded-[8px] px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-saffron -mt-3"
              style={{ background: 'var(--color-cream)', border: '1px solid var(--color-border)', color: 'var(--color-ink)' }}
            >
              <option value="all">All categories</option>
              {consumedCategories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
            </select>
          )}
        </div>
        {filteredConsumedItems.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--color-muted)' }}>No consumption recorded in this period.</p>
        ) : (
          <>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--color-border)' }}>
                  {['#', 'Item', 'Category', 'Quantity Used', 'Value'].map((h, i) => (
                    <th key={h} style={{ textAlign: i > 2 ? 'right' : 'left', padding: '6px 8px', color: 'var(--color-muted)', fontWeight: 700, fontSize: 10, textTransform: 'uppercase', letterSpacing: '.06em' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {displayedConsumedItems.map((item, i) => (
                  <tr key={item.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <td style={{ padding: '7px 8px', color: 'var(--color-muted)', fontWeight: 700 }}>{i + 1}</td>
                    <td style={{ padding: '7px 8px', fontWeight: 600, color: 'var(--color-ink)' }}>{item.name}</td>
                    <td style={{ padding: '7px 8px', color: 'var(--color-muted)' }}>{item.category}</td>
                    <td style={{ padding: '7px 8px', textAlign: 'right', color: 'var(--color-muted)' }}>{item.qty.toFixed(2)} {item.uom}</td>
                    <td style={{ padding: '7px 8px', textAlign: 'right', fontWeight: 700, color: C.ember }}>{fmtAED(item.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filteredConsumedItems.length > displayedConsumedItems.length && (
              <p className="text-[11px] mt-2" style={{ color: 'var(--color-muted)' }}>
                Showing top {displayedConsumedItems.length} of {filteredConsumedItems.length} items.
              </p>
            )}
          </>
        )}
      </Card>

      {/* Low stock */}
      <Card>
        <SectionTitle>Low Stock</SectionTitle>
        {kpis.lowStock.length === 0 ? (
          <p className="text-sm" style={{ color: C.green }}>All active items are above their minimum stock level.</p>
        ) : (
          <div className="space-y-1.5">
            {kpis.lowStock.map(item => (
              <Link
                key={item.id}
                href={`/inventory/${item.id}`}
                className="flex items-center justify-between px-3 py-2 rounded-[9px] text-sm transition-colors hover:bg-cream"
                style={{ border: '1px solid var(--color-border)' }}
              >
                <span className="flex items-center gap-2 min-w-0">
                  <AlertTriangle size={13} style={{ color: C.red, flexShrink: 0 }} />
                  <span className="font-semibold truncate" style={{ color: 'var(--color-ink)' }}>{item.name}</span>
                </span>
                <span className="num flex-shrink-0" style={{ color: C.red }}>
                  {item.current_stock.toFixed(2)} / {item.min_stock_level.toFixed(2)} {item.unit_of_measure}
                </span>
              </Link>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
