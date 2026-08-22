'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ChefHat,
  ClipboardList,
  Edit2,
  Plus,
  Receipt,
  ScanLine,
  Search,
  ShoppingCart,
  Sparkles,
  Truck,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ItemModal } from './item-modal'
import { useAppSettings } from '@/components/settings/settings-context'
import type { Tables } from '@/lib/supabase/types'

type InventoryItem = Tables<'inventory_items'>

function isLowStock(item: InventoryItem) {
  return parseFloat(item.current_stock) <= parseFloat(item.min_stock_level)
}

// ── Dashboard building blocks ────────────────────────────────────────────────

function KPICard({
  label,
  value,
  sub,
  accent,
}: {
  label: string
  value: string
  sub?: string
  accent: string
}) {
  return (
    <div
      className="relative rounded-[14px] p-4 overflow-hidden"
      style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}
    >
      <div className="absolute left-0 top-0 bottom-0 w-1" style={{ background: accent }} />
      <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>{label}</p>
      <p className="font-display font-bold text-[19px] mt-1 num" style={{ color: 'var(--color-ink)' }}>{value}</p>
      {sub && <p className="text-[11px] font-semibold mt-0.5" style={{ color: 'var(--color-muted)' }}>{sub}</p>}
    </div>
  )
}

function ActionTile({
  href,
  icon,
  label,
  accent,
}: {
  href: string
  icon: React.ReactNode
  label: string
  accent?: boolean
}) {
  return (
    <Link
      href={href}
      className="flex flex-col items-center justify-center gap-1.5 rounded-[14px] py-3.5 px-2 text-center transition-transform hover:-translate-y-0.5"
      style={{
        background: accent ? 'linear-gradient(135deg, var(--color-saffron), var(--color-ember))' : 'var(--color-surface)',
        border: accent ? 'none' : '1px solid var(--color-border)',
        boxShadow: 'var(--shadow-card)',
        color: accent ? '#fff' : 'var(--color-ink)',
      }}
    >
      {icon}
      <span className="text-[12px] font-bold leading-tight">{label}</span>
    </Link>
  )
}

export function InventoryModule({
  items,
  canManageItems,
  canRecordTxns,
  stats,
}: {
  items: InventoryItem[]
  canManageItems: boolean
  canRecordTxns: boolean
  stats: { purchasesMonth: number; consumptionMonth: number; wastageMonth: number }
}) {
  const router = useRouter()
  const { currency } = useAppSettings()
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [addOpen, setAddOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null)

  const categories = useMemo(
    () => [...new Set(items.map(i => i.category).filter(Boolean))] as string[],
    [items]
  )

  const filtered = useMemo(() => {
    let base = items
    if (categoryFilter !== 'all') base = base.filter(i => i.category === categoryFilter)
    if (search.trim()) {
      const q = search.toLowerCase()
      base = base.filter(i =>
        i.name.toLowerCase().includes(q) ||
        i.item_code.toLowerCase().includes(q) ||
        (i.category ?? '').toLowerCase().includes(q)
      )
    }
    return base
  }, [items, categoryFilter, search])

  const lowStockCount = items.filter(isLowStock).length
  const stockValue = useMemo(
    () => items.filter(i => i.is_active).reduce((s, i) => s + parseFloat(i.current_stock) * parseFloat(i.purchase_price), 0),
    [items],
  )

  function handleDone() {
    router.refresh()
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--color-saffron)', letterSpacing: '.12em' }}>
            Inventory
          </p>
          <h1 className="font-display font-bold text-[25px] mt-0.5" style={{ color: 'var(--color-ink)' }}>
            {items.length}
            <span className="text-[15px] font-semibold ml-1.5" style={{ color: 'var(--color-muted)' }}>
              items
              {lowStockCount > 0 && (
                <span style={{ color: 'var(--color-red)' }}> · {lowStockCount} low stock</span>
              )}
            </span>
          </h1>
        </div>
        {canManageItems && (
          <Button variant="primary" size="sm" onClick={() => setAddOpen(true)} className="flex-shrink-0 mt-1">
            <Plus size={15} />
            Add Item
          </Button>
        )}
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <KPICard
          label="Stock Value"
          value={`${currency} ${stockValue.toFixed(0)}`}
          sub="active items, at last cost"
          accent="var(--color-saffron)"
        />
        <KPICard
          label="Purchases · This Month"
          value={`${currency} ${stats.purchasesMonth.toFixed(0)}`}
          accent="var(--color-green)"
        />
        <KPICard
          label="Consumption · This Month"
          value={`${currency} ${stats.consumptionMonth.toFixed(0)}`}
          sub={stats.wastageMonth > 0 ? `+ ${currency} ${stats.wastageMonth.toFixed(0)} wasted` : undefined}
          accent="var(--color-ember)"
        />
        <KPICard
          label="Low Stock"
          value={String(lowStockCount)}
          sub={lowStockCount > 0 ? 'items below minimum' : 'all items above minimum'}
          accent={lowStockCount > 0 ? 'var(--color-red)' : 'var(--color-green)'}
        />
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-7 gap-2.5 mb-6">
        {canRecordTxns && (
          <>
            <ActionTile href="/scan-bill" icon={<ScanLine size={19} />} label="Scan Bill" accent />
            <ActionTile href="/inventory/purchases/new" icon={<ShoppingCart size={19} style={{ color: 'var(--color-saffron)' }} />} label="Record Purchase" />
            <ActionTile href="/inventory/consumption" icon={<ChefHat size={19} style={{ color: 'var(--color-ember)' }} />} label="Log Consumption" />
            <ActionTile href="/inventory/opening-stock" icon={<ClipboardList size={19} style={{ color: 'var(--color-blue)' }} />} label="Stock Count" />
          </>
        )}
        {canRecordTxns && (
          <ActionTile href="/inventory/purchases" icon={<Receipt size={19} style={{ color: 'var(--color-green)' }} />} label="Purchases" />
        )}
        <ActionTile href="/inventory/suppliers" icon={<Truck size={19} style={{ color: 'var(--color-muted)' }} />} label="Suppliers" />
        <ActionTile href="/inventory/insights" icon={<Sparkles size={19} style={{ color: 'var(--color-gold)' }} />} label="Insights" />
      </div>

      {/* Search + category filter */}
      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--color-muted)' }} />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name or code…"
            className="w-full h-9 pl-9 pr-8 rounded-[10px] text-sm outline-none"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-ink)' }}
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2">
              <X size={13} style={{ color: 'var(--color-muted)' }} />
            </button>
          )}
        </div>
        {categories.length > 0 && (
          <select
            value={categoryFilter}
            onChange={e => setCategoryFilter(e.target.value)}
            className="text-sm rounded-[10px] px-3 py-2 cursor-pointer focus:outline-none"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-ink)' }}
          >
            <option value="all">All Categories</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
      </div>

      {items.length === 0 ? (
        <div className="py-16 text-center" style={{ color: 'var(--color-muted)' }}>
          <p className="font-semibold text-[15px]">No inventory items yet</p>
          {canManageItems && <p className="text-sm mt-1">Click <strong>Add Item</strong> to add your first raw material.</p>}
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-16 text-center" style={{ color: 'var(--color-muted)' }}>
          <p className="font-semibold text-[15px]">No items match your filters</p>
        </div>
      ) : (
        <div
          className="rounded-[14px] overflow-hidden"
          style={{ border: '1px solid var(--color-border)', background: 'var(--color-surface)', boxShadow: 'var(--shadow-card)' }}
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr style={{ background: 'var(--color-cream)', borderBottom: '1px solid var(--color-border)' }}>
                  {['Item', 'Category', 'Unit', 'Stock', 'Price', ''].map((h, i) => (
                    <th
                      key={i}
                      className={`text-left px-4 py-3 text-[11px] font-bold uppercase tracking-wide ${h === 'Category' ? 'hidden md:table-cell' : ''}`}
                      style={{ color: 'var(--color-muted)' }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((item, i) => {
                  const low = isLowStock(item)
                  return (
                    <tr
                      key={item.id}
                      className="transition-colors hover:bg-cream"
                      style={{ borderTop: i > 0 ? '1px solid var(--color-border)' : undefined, opacity: item.is_active ? 1 : 0.55 }}
                    >
                      <td className="px-4 py-3">
                        <Link href={`/inventory/${item.id}`} className="font-semibold hover:underline" style={{ color: 'var(--color-ink)' }}>
                          {item.name}
                        </Link>
                        <div className="text-[11px] font-mono mt-0.5" style={{ color: 'var(--color-muted)' }}>
                          {item.item_code}
                        </div>
                      </td>
                      <td className="hidden md:table-cell px-4 py-3" style={{ color: 'var(--color-muted)' }}>
                        {item.category || '—'}
                      </td>
                      <td className="px-4 py-3" style={{ color: 'var(--color-muted)' }}>
                        {item.unit_of_measure}
                      </td>
                      <td className="px-4 py-3">
                        <span className="num font-semibold" style={{ color: low ? 'var(--color-red)' : 'var(--color-ink)' }}>
                          {parseFloat(item.current_stock).toFixed(3).replace(/\.?0+$/, '') || '0'}
                        </span>
                        {low && (
                          <span
                            className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded-pill text-[10px] font-bold"
                            style={{ background: 'var(--color-red-soft)', color: 'var(--color-red)' }}
                          >
                            Low
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 num" style={{ color: 'var(--color-muted)' }}>
                        {currency} {parseFloat(item.purchase_price).toFixed(2)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          {canManageItems && (
                            <button
                              onClick={() => setEditingItem(item)}
                              className="h-8 w-8 flex items-center justify-center rounded-lg transition-colors hover:bg-cream"
                              title="Edit"
                              aria-label={`Edit ${item.name}`}
                            >
                              <Edit2 size={14} style={{ color: 'var(--color-muted)' }} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <ItemModal open={addOpen} onClose={() => setAddOpen(false)} onSuccess={handleDone} />
      {editingItem && (
        <ItemModal
          item={editingItem}
          open
          onClose={() => setEditingItem(null)}
          onSuccess={() => { handleDone(); setEditingItem(null) }}
        />
      )}
    </div>
  )
}
