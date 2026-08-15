'use client'

import { useState, useMemo, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Plus, Search, Edit2, X, ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SupplierModal } from './supplier-modal'
import { toggleSupplierActive } from '@/lib/inventory/actions'
import type { Tables } from '@/lib/supabase/types'

type Supplier = Tables<'suppliers'>

export function SupplierModule({
  suppliers,
  canWrite,
}: {
  suppliers: Supplier[]
  canWrite: boolean
}) {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null)
  const [isPending, startTransition] = useTransition()

  const filtered = useMemo(() => {
    if (!search.trim()) return suppliers
    const q = search.toLowerCase()
    return suppliers.filter(s =>
      s.name.toLowerCase().includes(q) ||
      s.supplier_code.toLowerCase().includes(q) ||
      (s.contact_person ?? '').toLowerCase().includes(q) ||
      (s.phone ?? '').toLowerCase().includes(q)
    )
  }, [suppliers, search])

  function handleToggle(supplier: Supplier) {
    startTransition(async () => {
      await toggleSupplierActive(supplier.id, !supplier.is_active)
      router.refresh()
    })
  }

  function handleDone() {
    router.refresh()
  }

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

      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--color-saffron)', letterSpacing: '.12em' }}>
            Inventory
          </p>
          <h1 className="font-display font-bold text-[25px] mt-0.5" style={{ color: 'var(--color-ink)' }}>
            {suppliers.length}
            <span className="text-[15px] font-semibold ml-1.5" style={{ color: 'var(--color-muted)' }}>
              suppliers
            </span>
          </h1>
        </div>
        {canWrite && (
          <div className="flex gap-2 flex-shrink-0 mt-1">
            <Button variant="primary" size="sm" onClick={() => setAddOpen(true)}>
              <Plus size={15} />
              Add Supplier
            </Button>
          </div>
        )}
      </div>

      <div className="relative mb-4">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--color-muted)' }} />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by name, code or contact…"
          className="w-full h-9 pl-9 pr-8 rounded-[10px] text-sm outline-none"
          style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-ink)' }}
        />
        {search && (
          <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2">
            <X size={13} style={{ color: 'var(--color-muted)' }} />
          </button>
        )}
      </div>

      {suppliers.length === 0 ? (
        <div className="py-16 text-center" style={{ color: 'var(--color-muted)' }}>
          <p className="font-semibold text-[15px]">No suppliers yet</p>
          {canWrite && <p className="text-sm mt-1">Click <strong>Add Supplier</strong> to add your first vendor.</p>}
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-16 text-center" style={{ color: 'var(--color-muted)' }}>
          <p className="font-semibold text-[15px]">No suppliers match your search</p>
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
                  {['Supplier', 'Contact', 'Phone', 'Status', ''].map((h, i) => (
                    <th
                      key={i}
                      className={`text-left px-4 py-3 text-[11px] font-bold uppercase tracking-wide ${h === 'Contact' ? 'hidden md:table-cell' : ''}`}
                      style={{ color: 'var(--color-muted)' }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((supplier, i) => (
                  <tr
                    key={supplier.id}
                    className="transition-colors hover:bg-cream"
                    style={{ borderTop: i > 0 ? '1px solid var(--color-border)' : undefined, opacity: supplier.is_active ? 1 : 0.55 }}
                  >
                    <td className="px-4 py-3">
                      <span className="font-semibold" style={{ color: 'var(--color-ink)' }}>{supplier.name}</span>
                      <div className="text-[11px] font-mono mt-0.5" style={{ color: 'var(--color-muted)' }}>
                        {supplier.supplier_code}
                      </div>
                    </td>
                    <td className="hidden md:table-cell px-4 py-3" style={{ color: 'var(--color-muted)' }}>
                      {supplier.contact_person || '—'}
                    </td>
                    <td className="px-4 py-3" style={{ color: 'var(--color-muted)' }}>
                      {supplier.phone || '—'}
                    </td>
                    <td className="px-4 py-3">
                      {canWrite ? (
                        <button
                          onClick={() => handleToggle(supplier)}
                          disabled={isPending}
                          className="inline-flex items-center px-2 py-0.5 rounded-pill text-[11px] font-bold transition-opacity hover:opacity-70"
                          style={{
                            background: supplier.is_active ? 'var(--color-green-soft)' : 'var(--color-red-soft)',
                            color: supplier.is_active ? 'var(--color-green)' : 'var(--color-red)',
                          }}
                        >
                          {supplier.is_active ? 'Active' : 'Inactive'}
                        </button>
                      ) : (
                        <span
                          className="inline-flex items-center px-2 py-0.5 rounded-pill text-[11px] font-bold"
                          style={{
                            background: supplier.is_active ? 'var(--color-green-soft)' : 'var(--color-red-soft)',
                            color: supplier.is_active ? 'var(--color-green)' : 'var(--color-red)',
                          }}
                        >
                          {supplier.is_active ? 'Active' : 'Inactive'}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {canWrite && (
                          <button
                            onClick={() => setEditingSupplier(supplier)}
                            className="h-8 w-8 flex items-center justify-center rounded-lg transition-colors hover:bg-cream"
                            title="Edit"
                            aria-label={`Edit ${supplier.name}`}
                          >
                            <Edit2 size={14} style={{ color: 'var(--color-muted)' }} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <SupplierModal open={addOpen} onClose={() => setAddOpen(false)} onSuccess={handleDone} />
      {editingSupplier && (
        <SupplierModal
          supplier={editingSupplier}
          open
          onClose={() => setEditingSupplier(null)}
          onSuccess={() => { handleDone(); setEditingSupplier(null) }}
        />
      )}
    </div>
  )
}
