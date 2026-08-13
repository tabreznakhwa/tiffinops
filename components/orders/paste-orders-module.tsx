'use client'

import { useState, useMemo, useTransition } from 'react'
import Link from 'next/link'
import { ArrowLeft, ClipboardPaste, AlertTriangle, Check, X, Trash2 } from 'lucide-react'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { parseOrderPaste, commitParsedOrders } from '@/lib/orders/whatsapp-actions'
import type { CommitResult } from '@/lib/orders/whatsapp-actions'
import type { MealPeriod, MenuItemRef, CustomerRef, ParsedOrder } from '@/lib/orders/parse-whatsapp'
import { useAppSettings } from '@/components/settings/settings-context'

// Editable copy of a parsed order — the parser's output is a starting point,
// everything here can be corrected before it is written.
type DraftItem = {
  menu_item_id: string | null
  name: string
  quantity: number
  unit_price: number
  note: string | null
  raw: string
  needsAttention: boolean
}

type Draft = {
  ref: number
  include: boolean
  rawBlock: string
  rawCustomer: string
  customer_id: string | null
  customerNeedsCheck: boolean
  candidates: CustomerRef[]
  items: DraftItem[]
  issues: string[]
}

function toDraft(o: ParsedOrder): Draft {
  return {
    ref: o.index,
    include: true,
    rawBlock: o.rawBlock,
    rawCustomer: o.rawCustomer,
    customer_id: o.customer_id,
    customerNeedsCheck: o.customerMatch !== 'exact',
    candidates: o.candidates,
    items: o.items.map(i => ({
      menu_item_id: i.menu_item_id,
      name: i.name,
      quantity: i.quantity,
      unit_price: i.unit_price,
      note: i.note,
      raw: i.raw,
      needsAttention: i.match !== 'exact',
    })),
    issues: o.issues,
  }
}

const MEALS: MealPeriod[] = ['breakfast', 'lunch', 'dinner']

export function PasteOrdersModule() {
  const { currency } = useAppSettings()
  const [raw, setRaw] = useState('')
  const [dateOverride, setDateOverride] = useState('')
  const [mealOverride, setMealOverride] = useState<MealPeriod | ''>('')

  const [drafts, setDrafts]       = useState<Draft[] | null>(null)
  const [menu, setMenu]           = useState<MenuItemRef[]>([])
  const [customers, setCustomers] = useState<CustomerRef[]>([])
  const [parsedDate, setParsedDate] = useState('')
  const [parsedMeal, setParsedMeal] = useState<MealPeriod | null>(null)

  const [error, setError]   = useState('')
  const [result, setResult] = useState<CommitResult | null>(null)
  const [isParsing, startParse]   = useTransition()
  const [isSaving,  startSave]    = useTransition()

  function handleParse() {
    setError('')
    setResult(null)
    startParse(async () => {
      const res = await parseOrderPaste(raw, {
        date: dateOverride || undefined,
        meal: mealOverride || undefined,
      })
      if (res.error || !res.result) { setError(res.error ?? 'Could not parse'); return }
      setDrafts(res.result.orders.map(toDraft))
      setMenu(res.menu ?? [])
      setCustomers(res.customers ?? [])
      setParsedDate(res.result.orderDate ?? '')
      setParsedMeal(res.result.mealPeriod)
    })
  }

  function update(ref: number, patch: Partial<Draft>) {
    setDrafts(d => d?.map(o => (o.ref === ref ? { ...o, ...patch } : o)) ?? null)
  }

  function updateItem(ref: number, idx: number, patch: Partial<DraftItem>) {
    setDrafts(d => d?.map(o => {
      if (o.ref !== ref) return o
      return { ...o, items: o.items.map((it, i) => (i === idx ? { ...it, ...patch } : it)) }
    }) ?? null)
  }

  function removeItem(ref: number, idx: number) {
    setDrafts(d => d?.map(o => (o.ref === ref ? { ...o, items: o.items.filter((_, i) => i !== idx) } : o)) ?? null)
  }

  const included = useMemo(() => drafts?.filter(d => d.include) ?? [], [drafts])

  // Unmatched lines grouped by what the customer actually wrote. "pulao" on its
  // own is genuinely ambiguous — the menu carries a dozen of them — and which
  // one it means changes daily, so it is resolved per import rather than being
  // baked into the parser as a permanent rule.
  const unresolved = useMemo(() => {
    const map = new Map<string, { raw: string; spots: { ref: number; idx: number }[] }>()
    for (const d of drafts ?? []) {
      if (!d.include) continue
      d.items.forEach((it, idx) => {
        if (it.menu_item_id) return
        const key = it.raw.toLowerCase().replace(/\s+/g, ' ').trim()
        const g = map.get(key) ?? { raw: it.raw, spots: [] }
        g.spots.push({ ref: d.ref, idx })
        map.set(key, g)
      })
    }
    return [...map.values()].sort((a, b) => b.spots.length - a.spots.length)
  }, [drafts])

  const [bulkPick, setBulkPick] = useState<Record<string, string>>({})

  // Built once rather than per row — there are ~90 menu items and ~190
  // customers, and the review screen renders a dropdown for every single line.
  const menuOptions = useMemo(
    () => menu.map(m => ({ value: m.id, label: m.name, hint: `${currency} ${m.price.toFixed(2)}` })),
    [menu, currency],
  )
  const customerOptions = useMemo(
    () => customers.map(c => ({ value: c.id, label: c.full_name, hint: c.customer_code })),
    [customers],
  )

  function resolveAll(spots: { ref: number; idx: number }[], menuItemId: string) {
    const m = menu.find(x => x.id === menuItemId)
    if (!m) return
    setDrafts(d => d?.map(o => {
      const mine = spots.filter(s => s.ref === o.ref)
      if (!mine.length) return o
      return {
        ...o,
        items: o.items.map((it, i) =>
          mine.some(s => s.idx === i)
            ? { ...it, menu_item_id: m.id, name: m.name, unit_price: m.price, needsAttention: false }
            : it,
        ),
      }
    }) ?? null)
  }

  const blockers = useMemo(
    () => included.filter(d => !d.customer_id || !d.items.length || d.items.some(i => !i.menu_item_id)),
    [included],
  )

  const grandTotal = included.reduce(
    (s, d) => s + d.items.reduce((t, i) => t + i.quantity * i.unit_price, 0), 0,
  )

  // The kitchen view — what to actually cook and pack.
  const packing = useMemo(() => {
    const map = new Map<string, number>()
    for (const d of included) {
      for (const it of d.items) {
        const key = it.name + (it.note ? ` (${it.note})` : '')
        map.set(key, (map.get(key) ?? 0) + it.quantity)
      }
    }
    return [...map.entries()]
      .map(([name, qty]) => ({ name, qty }))
      .sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name))
  }, [included])

  function handleCommit() {
    if (!drafts) return
    if (!parsedMeal) { setError('Meal period was not detected — set it above before importing.'); return }
    setError('')
    startSave(async () => {
      const res = await commitParsedOrders(
        included.map(d => ({
          ref: d.ref,
          customer_id: d.customer_id!,
          order_date: parsedDate,
          meal_period: parsedMeal,
          notes: null,
          items: d.items.map(i => ({
            menu_item_id: i.menu_item_id!,
            item_name_snapshot: i.name + (i.note ? ` (${i.note})` : ''),
            quantity: i.quantity,
            unit_price: i.unit_price.toFixed(2),
          })),
        })),
      )
      if (res.error) { setError(res.error); return }
      setResult(res)
      // Drop the rows that were written so a second click can't duplicate them
      const done = new Set([...(res.created ?? []), ...(res.skipped ?? [])].map(r => r.ref))
      setDrafts(d => d?.filter(o => !done.has(o.ref)) ?? null)
    })
  }

  const flaggedCount = drafts?.filter(d => d.issues.length).length ?? 0

  return (
    <div>
      <Link
        href="/orders"
        className="inline-flex items-center gap-1.5 text-sm font-semibold mb-5 transition-opacity hover:opacity-70"
        style={{ color: 'var(--color-muted)' }}
      >
        <ArrowLeft size={15} />
        Orders
      </Link>

      <div className="mb-5">
        <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--color-saffron)', letterSpacing: '.12em' }}>
          Orders
        </p>
        <h1 className="font-display font-bold text-[25px] mt-0.5" style={{ color: 'var(--color-ink)' }}>
          Import from WhatsApp
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--color-muted)' }}>
          Paste the messages exactly as they arrive. Anything the parser is unsure about is flagged for you to confirm.
        </p>
      </div>

      {/* Paste box */}
      <div
        className="rounded-[14px] p-4 mb-4"
        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}
      >
        <textarea
          value={raw}
          onChange={e => setRaw(e.target.value)}
          rows={drafts ? 4 : 12}
          placeholder={'11 Aug  dinner\n\nShoaib27\nRumali 2\nkhema\n\nsylvista\nwhite rice+ korma'}
          className="w-full rounded-[10px] px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-saffron font-mono"
          style={{ background: 'var(--color-cream)', border: '1px solid var(--color-border)', color: 'var(--color-ink)' }}
        />
        <div className="flex flex-wrap items-end gap-2 mt-3">
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--color-muted)' }}>
              Date (optional)
            </label>
            <input
              type="date"
              value={dateOverride}
              onChange={e => setDateOverride(e.target.value)}
              className="rounded-[8px] px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1"
              style={{ background: 'var(--color-cream)', border: '1px solid var(--color-border)', color: 'var(--color-ink)' }}
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--color-muted)' }}>
              Meal (optional)
            </label>
            <select
              value={mealOverride}
              onChange={e => setMealOverride(e.target.value as MealPeriod | '')}
              className="rounded-[8px] px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1"
              style={{ background: 'var(--color-cream)', border: '1px solid var(--color-border)', color: 'var(--color-ink)' }}
            >
              <option value="">From message</option>
              {MEALS.map(m => <option key={m} value={m}>{m[0].toUpperCase() + m.slice(1)}</option>)}
            </select>
          </div>
          <button
            onClick={handleParse}
            disabled={isParsing || !raw.trim()}
            className="flex items-center gap-1.5 px-4 py-2 rounded-[10px] text-sm font-bold transition-opacity"
            style={{ background: 'var(--color-saffron)', color: '#fff', opacity: isParsing || !raw.trim() ? 0.6 : 1 }}
          >
            <ClipboardPaste size={14} />
            {isParsing ? 'Reading…' : 'Read Orders'}
          </button>
        </div>
      </div>

      {error && (
        <p className="text-xs font-semibold mb-3" style={{ color: 'var(--color-red)' }}>{error}</p>
      )}

      {/* Import result */}
      {result && (
        <div
          className="rounded-[14px] p-4 mb-4"
          style={{ background: 'var(--color-green-soft)', border: '1px solid var(--color-green)' }}
        >
          <p className="font-bold text-sm mb-1" style={{ color: 'var(--color-green)' }}>
            {result.created?.length ?? 0} order{(result.created?.length ?? 0) !== 1 ? 's' : ''} created
          </p>
          {!!result.skipped?.length && (
            <p className="text-xs" style={{ color: 'var(--color-gold)' }}>
              {result.skipped.length} skipped — already had an order for this date and meal
            </p>
          )}
          {!!result.failed?.length && (
            <p className="text-xs" style={{ color: 'var(--color-red)' }}>
              {result.failed.length} could not be created
            </p>
          )}
          <Link href="/orders" className="text-xs font-bold underline mt-1 inline-block" style={{ color: 'var(--color-green)' }}>
            View orders
          </Link>
        </div>
      )}

      {drafts && drafts.length > 0 && (
        <>
          {/* Summary strip */}
          <div
            className="flex flex-wrap items-center gap-4 px-4 py-3 rounded-[12px] mb-4"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
          >
            <Stat label="Orders" value={String(included.length)} />
            <Divider />
            <Stat label="Date" value={parsedDate || '—'} />
            <Divider />
            {parsedMeal ? (
              <Stat label="Meal" value={parsedMeal[0].toUpperCase() + parsedMeal.slice(1)} />
            ) : (
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-red)' }}>
                  Meal — not detected
                </p>
                <select
                  value=""
                  onChange={e => setParsedMeal(e.target.value as MealPeriod)}
                  className="mt-0.5 rounded-[6px] px-1.5 py-1 text-xs font-bold focus:outline-none focus:ring-1"
                  style={{ background: 'var(--color-red-soft)', border: '1px solid var(--color-red)', color: 'var(--color-red)' }}
                >
                  <option value="" disabled>Pick meal…</option>
                  {MEALS.map(m => <option key={m} value={m}>{m[0].toUpperCase() + m.slice(1)}</option>)}
                </select>
              </div>
            )}
            <Divider />
            <Stat label="Value" value={`${currency} ${grandTotal.toFixed(2)}`} />
            {flaggedCount > 0 && (
              <>
                <Divider />
                <Stat label="Need a look" value={String(flaggedCount)} color="var(--color-gold)" />
              </>
            )}
          </div>

          {/* Packing totals */}
          {packing.length > 0 && (
            <div
              className="rounded-[14px] p-4 mb-4"
              style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
            >
              <p className="text-[10px] font-bold uppercase tracking-wide mb-2" style={{ color: 'var(--color-muted)' }}>
                Packing totals
              </p>
              <div className="flex flex-wrap gap-2">
                {packing.map(p => (
                  <span
                    key={p.name}
                    className="text-xs font-semibold px-2.5 py-1 rounded-full"
                    style={{ background: 'var(--color-cream)', border: '1px solid var(--color-border)', color: 'var(--color-ink)' }}
                  >
                    {p.name} <strong className="num">×{p.qty}</strong>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Resolve repeated unknowns once */}
          {unresolved.length > 0 && (
            <div
              className="rounded-[14px] p-4 mb-4"
              style={{ background: 'var(--color-surface)', border: '1px solid var(--color-gold, #D4A96A)' }}
            >
              <p className="text-[10px] font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--color-muted)' }}>
                Needs a menu item
              </p>
              <p className="text-xs mb-3" style={{ color: 'var(--color-muted)' }}>
                Set each one once and it applies to every line that says the same thing. This is for
                today&apos;s import only — nothing is remembered for next time.
              </p>
              <div className="space-y-2">
                {unresolved.map(g => {
                  const key = g.raw.toLowerCase().trim()
                  return (
                    <div key={key} className="flex flex-wrap items-center gap-2">
                      <span
                        className="text-xs font-mono px-2 py-1 rounded"
                        style={{ background: 'var(--color-red-soft)', color: 'var(--color-red)' }}
                      >
                        {g.raw}
                      </span>
                      <span
                        className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                        style={{ background: 'var(--color-border)', color: 'var(--color-muted)' }}
                      >
                        {g.spots.length} line{g.spots.length !== 1 ? 's' : ''}
                      </span>
                      <span style={{ color: 'var(--color-muted)' }}>→</span>
                      <SearchableSelect
                        options={menuOptions}
                        value={bulkPick[key] ?? ''}
                        onChange={v => setBulkPick(p => ({ ...p, [key]: v }))}
                        placeholder="— pick menu item —"
                        width={240}
                      />
                      <button
                        onClick={() => { resolveAll(g.spots, bulkPick[key]); setBulkPick(p => ({ ...p, [key]: '' })) }}
                        disabled={!bulkPick[key]}
                        className="px-3 py-1 rounded-[8px] text-xs font-bold transition-opacity"
                        style={{ background: '#1A6B6B', color: '#fff', opacity: bulkPick[key] ? 1 : 0.45 }}
                      >
                        Apply to all {g.spots.length}
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Review rows */}
          <div className="space-y-2 mb-4">
            {drafts.map(d => {
              const rowTotal = d.items.reduce((s, i) => s + i.quantity * i.unit_price, 0)
              const blocked  = d.include && (!d.customer_id || !d.items.length || d.items.some(i => !i.menu_item_id))
              return (
                <div
                  key={d.ref}
                  className="rounded-[12px] p-3"
                  style={{
                    background: 'var(--color-surface)',
                    border: `1px solid ${blocked ? 'var(--color-red)' : d.issues.length ? 'var(--color-gold)' : 'var(--color-border)'}`,
                    opacity: d.include ? 1 : 0.5,
                  }}
                >
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={d.include}
                      onChange={e => update(d.ref, { include: e.target.checked })}
                      className="mt-1 w-4 h-4 cursor-pointer flex-shrink-0"
                      style={{ accentColor: 'var(--color-saffron)' }}
                    />

                    <div className="flex-1 min-w-0">
                      {/* Customer */}
                      <div className="flex flex-wrap items-center gap-2 mb-2">
                        <span className="text-[11px] font-mono px-1.5 py-0.5 rounded" style={{ background: 'var(--color-cream)', color: 'var(--color-muted)' }}>
                          {d.rawCustomer}
                        </span>
                        <span style={{ color: 'var(--color-muted)' }}>→</span>
                        <SearchableSelect
                          options={customerOptions}
                          value={d.customer_id ?? ''}
                          onChange={v => update(d.ref, { customer_id: v || null, customerNeedsCheck: false })}
                          placeholder="— pick customer —"
                          invalid={!d.customer_id}
                          width={240}
                        />
                        {d.customerNeedsCheck && d.customer_id && (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: '#FEF3C7', color: '#92400E' }}>
                            CONFIRM
                          </span>
                        )}
                      </div>

                      {/* Items */}
                      <div className="space-y-1.5">
                        {d.items.map((it, idx) => (
                          <div key={idx} className="flex flex-wrap items-center gap-2">
                            <span className="text-[11px] font-mono px-1.5 py-0.5 rounded" style={{ background: 'var(--color-cream)', color: 'var(--color-muted)' }}>
                              {it.raw}
                            </span>
                            <span style={{ color: 'var(--color-muted)' }}>→</span>
                            <SearchableSelect
                              options={menuOptions}
                              value={it.menu_item_id ?? ''}
                              onChange={v => {
                                const m = menu.find(x => x.id === v)
                                updateItem(d.ref, idx, {
                                  menu_item_id: m?.id ?? null,
                                  name: m?.name ?? it.name,
                                  unit_price: m?.price ?? it.unit_price,
                                  needsAttention: false,
                                })
                              }}
                              placeholder="— pick item —"
                              invalid={!it.menu_item_id}
                              width={210}
                            />
                            <input
                              type="number"
                              min={1}
                              value={it.quantity}
                              onChange={e => updateItem(d.ref, idx, { quantity: Math.max(1, parseInt(e.target.value) || 1) })}
                              className="w-14 rounded-[8px] px-2 py-1 text-xs text-center focus:outline-none focus:ring-1"
                              style={{ background: 'var(--color-cream)', border: '1px solid var(--color-border)', color: 'var(--color-ink)' }}
                            />
                            <span className="text-xs num" style={{ color: 'var(--color-muted)' }}>
                              × {it.unit_price.toFixed(2)}
                            </span>
                            {it.note && (
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: 'var(--color-purple-soft)', color: 'var(--color-purple)' }}>
                                {it.note}
                              </span>
                            )}
                            <button
                              onClick={() => removeItem(d.ref, idx)}
                              className="p-1 rounded hover:opacity-70"
                              style={{ color: 'var(--color-red)' }}
                              title="Remove line"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        ))}
                      </div>

                      {/* Issues */}
                      {d.issues.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {d.issues.map((iss, i) => (
                            <span
                              key={i}
                              className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded"
                              style={{ background: '#FEF3C7', color: '#92400E' }}
                            >
                              <AlertTriangle size={9} />
                              {iss}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    <p className="num font-bold text-sm flex-shrink-0" style={{ color: 'var(--color-ink)' }}>
                      {currency} {rowTotal.toFixed(2)}
                    </p>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Commit bar */}
          <div
            className="sticky bottom-4 flex flex-wrap items-center justify-between gap-3 px-4 py-3 rounded-[12px]"
            style={{ background: 'var(--color-ink)', boxShadow: 'var(--shadow-card)' }}
          >
            <div>
              <p className="text-sm font-bold" style={{ color: '#fff' }}>
                {included.length} order{included.length !== 1 ? 's' : ''} · {currency} {grandTotal.toFixed(2)}
              </p>
              {!parsedMeal && (
                <p className="text-[11px] flex items-center gap-1" style={{ color: '#FCA5A5' }}>
                  <X size={11} /> Pick a meal period above before importing
                </p>
              )}
              {blockers.length > 0 && (
                <p className="text-[11px] flex items-center gap-1" style={{ color: '#FCA5A5' }}>
                  <X size={11} /> {blockers.length} still need a customer or item
                </p>
              )}
              {parsedMeal && blockers.length === 0 && included.length > 0 && (
                <p className="text-[11px] flex items-center gap-1" style={{ color: '#86EFAC' }}>
                  <Check size={11} /> ready to import
                </p>
              )}
            </div>
            <button
              onClick={handleCommit}
              disabled={isSaving || included.length === 0 || blockers.length > 0 || !parsedMeal}
              className="px-5 py-2.5 rounded-[10px] text-sm font-bold transition-opacity"
              style={{
                background: 'var(--color-saffron)',
                color: '#fff',
                opacity: isSaving || included.length === 0 || blockers.length > 0 || !parsedMeal ? 0.5 : 1,
              }}
            >
              {isSaving ? 'Importing…' : `Import ${included.length} Order${included.length !== 1 ? 's' : ''}`}
            </button>
          </div>
        </>
      )}

      {drafts && drafts.length === 0 && !result && (
        <p className="text-sm text-center py-8" style={{ color: 'var(--color-muted)' }}>
          Nothing recognised in that paste.
        </p>
      )}
    </div>
  )
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>{label}</p>
      <p className="font-display font-bold text-[18px] num" style={{ color: color ?? 'var(--color-ink)' }}>{value}</p>
    </div>
  )
}

function Divider() {
  return <div className="w-px self-stretch" style={{ background: 'var(--color-border)' }} />
}
