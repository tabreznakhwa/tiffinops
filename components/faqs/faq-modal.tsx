'use client'

import { useState, useTransition, useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { createFaqFact, updateFaqFact } from '@/lib/faqs/actions'
import type { Tables } from '@/lib/supabase/types'

type FaqFact = Tables<'faq_facts'>

const inputBase =
  'mt-1 w-full rounded-[11px] px-3 py-2.5 text-sm bg-surface text-ink focus:outline-none focus:ring-1 focus:ring-saffron'
const inputStyle = { border: '1px solid var(--color-border)' } as const

export function FaqModal({
  fact,
  open,
  onClose,
  onSuccess,
}: {
  fact?: FaqFact
  open: boolean
  onClose: () => void
  onSuccess: () => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const backdropRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [open])

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const formData = new FormData(e.currentTarget)
    startTransition(async () => {
      const result = fact
        ? await updateFaqFact(fact.id, formData)
        : await createFaqFact(formData)
      if (result?.error) {
        setError(result.error)
      } else {
        onSuccess()
        onClose()
      }
    })
  }

  if (!open) return null

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4"
      style={{ background: 'rgba(34,26,19,0.5)', backdropFilter: 'blur(3px)' }}
      onMouseDown={(e) => { if (e.target === backdropRef.current) onClose() }}
    >
      <div
        className="w-full sm:max-w-lg flex flex-col rounded-t-[20px] sm:rounded-[20px] overflow-hidden"
        style={{
          background: 'var(--color-surface)',
          maxHeight: '92dvh',
          boxShadow: '0 -4px 40px rgba(34,26,19,.22)',
        }}
      >
        <div
          className="flex items-center justify-between px-5 pt-5 pb-4 flex-shrink-0"
          style={{ borderBottom: '1px solid var(--color-border)' }}
        >
          <h2 className="font-display font-bold text-[17px]" style={{ color: 'var(--color-ink)' }}>
            {fact ? 'Edit Fact' : 'Add Fact'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="h-8 w-8 rounded-full flex items-center justify-center transition-colors hover:bg-cream"
            style={{ color: 'var(--color-muted)' }}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-5">
          <form onSubmit={handleSubmit}>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-semibold" style={{ color: 'var(--color-ink)' }}>
                  Fact <span style={{ color: 'var(--color-red)' }}>*</span>
                </label>
                <p className="text-xs mt-0.5 mb-1" style={{ color: 'var(--color-muted)' }}>
                  The WhatsApp agent may quote this verbatim to customers — keep it
                  short, factual, and current.
                </p>
                <textarea
                  name="fact"
                  defaultValue={fact?.fact ?? ''}
                  required
                  rows={3}
                  className={`${inputBase} resize-none`}
                  style={inputStyle}
                  placeholder="e.g. Delivery hours are 9am–9pm daily, including public holidays."
                />
              </div>

              <div>
                <label className="block text-sm font-semibold" style={{ color: 'var(--color-ink)' }}>
                  Sort Order
                </label>
                <p className="text-xs mt-0.5 mb-1" style={{ color: 'var(--color-muted)' }}>
                  Lower numbers are listed (and shown to the agent) first.
                </p>
                <input
                  name="sort_order"
                  type="number"
                  step="1"
                  defaultValue={fact?.sort_order ?? 0}
                  className={inputBase}
                  style={inputStyle}
                />
              </div>
            </div>

            {error && (
              <p className="mt-4 text-sm font-semibold" style={{ color: 'var(--color-red)' }}>
                {error}
              </p>
            )}

            <div className="mt-5 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
              <Button type="button" variant="ghost" onClick={onClose} disabled={isPending} className="w-full sm:w-auto">
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={isPending} className="w-full sm:w-auto">
                {isPending ? 'Saving…' : fact ? 'Save Changes' : 'Add Fact'}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
