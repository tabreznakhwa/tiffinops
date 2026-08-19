'use client'

import { useState, useMemo, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Search, Edit2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FaqModal } from './faq-modal'
import { toggleFaqActive } from '@/lib/faqs/actions'
import type { Tables } from '@/lib/supabase/types'

type FaqFact = Tables<'faq_facts'>

export function FaqsModule({
  facts,
  canWrite,
}: {
  facts: FaqFact[]
  canWrite: boolean
}) {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [editingFact, setEditingFact] = useState<FaqFact | null>(null)
  const [isPending, startTransition] = useTransition()

  const filtered = useMemo(() => {
    if (!search.trim()) return facts
    const q = search.toLowerCase()
    return facts.filter(f => f.fact.toLowerCase().includes(q))
  }, [facts, search])

  function handleToggle(fact: FaqFact) {
    startTransition(async () => {
      await toggleFaqActive(fact.id, !fact.is_active)
      router.refresh()
    })
  }

  function handleDone() {
    router.refresh()
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--color-saffron)', letterSpacing: '.12em' }}>
            Admin
          </p>
          <h1 className="font-display font-bold text-[25px] mt-0.5" style={{ color: 'var(--color-ink)' }}>
            {facts.length}
            <span className="text-[15px] font-semibold ml-1.5" style={{ color: 'var(--color-muted)' }}>
              FAQ facts
            </span>
          </h1>
          <p className="text-sm mt-1.5" style={{ color: 'var(--color-muted)' }}>
            Facts the WhatsApp agent may state directly to customers — hours,
            zones, holidays, capacity. Only <strong style={{ color: 'var(--color-ink)' }}>active</strong> facts
            are shown to the agent; anything not listed here, it will decline
            to guess about.
          </p>
        </div>
        {canWrite && (
          <div className="flex gap-2 flex-shrink-0 mt-1">
            <Button variant="primary" size="sm" onClick={() => setAddOpen(true)}>
              <Plus size={15} />
              Add Fact
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
          placeholder="Search facts…"
          className="w-full h-9 pl-9 pr-8 rounded-[10px] text-sm outline-none"
          style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-ink)' }}
        />
        {search && (
          <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2">
            <X size={13} style={{ color: 'var(--color-muted)' }} />
          </button>
        )}
      </div>

      {facts.length === 0 ? (
        <div className="py-16 text-center" style={{ color: 'var(--color-muted)' }}>
          <p className="font-semibold text-[15px]">No FAQ facts yet</p>
          {canWrite && <p className="text-sm mt-1">Click <strong>Add Fact</strong> to teach the agent its first fact.</p>}
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-16 text-center" style={{ color: 'var(--color-muted)' }}>
          <p className="font-semibold text-[15px]">No facts match your search</p>
        </div>
      ) : (
        <div
          className="rounded-[14px] overflow-hidden"
          style={{ border: '1px solid var(--color-border)', background: 'var(--color-surface)', boxShadow: 'var(--shadow-card)' }}
        >
          {filtered.map((fact, i) => (
            <div
              key={fact.id}
              className="flex items-start gap-3 px-4 py-3"
              style={{ borderTop: i > 0 ? '1px solid var(--color-border)' : undefined, opacity: fact.is_active ? 1 : 0.55 }}
            >
              <span className="flex-1 min-w-0 text-sm" style={{ color: 'var(--color-ink)' }}>
                {fact.fact}
              </span>
              <span className="flex-shrink-0 text-[11px] font-mono mt-0.5" style={{ color: 'var(--color-muted)' }}>
                #{fact.sort_order}
              </span>
              {canWrite ? (
                <button
                  onClick={() => handleToggle(fact)}
                  disabled={isPending}
                  className="flex-shrink-0 inline-flex items-center px-2 py-0.5 rounded-pill text-[11px] font-bold transition-opacity hover:opacity-70"
                  style={{
                    background: fact.is_active ? 'var(--color-green-soft)' : 'var(--color-red-soft)',
                    color: fact.is_active ? 'var(--color-green)' : 'var(--color-red)',
                  }}
                >
                  {fact.is_active ? 'Active' : 'Inactive'}
                </button>
              ) : (
                <span
                  className="flex-shrink-0 inline-flex items-center px-2 py-0.5 rounded-pill text-[11px] font-bold"
                  style={{
                    background: fact.is_active ? 'var(--color-green-soft)' : 'var(--color-red-soft)',
                    color: fact.is_active ? 'var(--color-green)' : 'var(--color-red)',
                  }}
                >
                  {fact.is_active ? 'Active' : 'Inactive'}
                </span>
              )}
              {canWrite && (
                <button
                  onClick={() => setEditingFact(fact)}
                  className="flex-shrink-0 h-8 w-8 flex items-center justify-center rounded-lg transition-colors hover:bg-cream"
                  title="Edit"
                  aria-label="Edit fact"
                >
                  <Edit2 size={14} style={{ color: 'var(--color-muted)' }} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <FaqModal open={addOpen} onClose={() => setAddOpen(false)} onSuccess={handleDone} />
      {editingFact && (
        <FaqModal
          fact={editingFact}
          open
          onClose={() => setEditingFact(null)}
          onSuccess={() => { handleDone(); setEditingFact(null) }}
        />
      )}
    </div>
  )
}
