'use client'

import { useState, useTransition, useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { createSupplier, updateSupplier } from '@/lib/inventory/actions'
import type { Tables } from '@/lib/supabase/types'

type Supplier = Tables<'suppliers'>

const inputBase =
  'mt-1 w-full rounded-[11px] px-3 py-2.5 text-sm bg-surface text-ink focus:outline-none focus:ring-1 focus:ring-saffron'
const inputStyle = { border: '1px solid var(--color-border)' } as const

export function SupplierModal({
  supplier,
  open,
  onClose,
  onSuccess,
}: {
  supplier?: Supplier
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
      const result = supplier
        ? await updateSupplier(supplier.id, formData)
        : await createSupplier(formData)
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
            {supplier ? 'Edit Supplier' : 'Add Supplier'}
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
                  Supplier Name <span style={{ color: 'var(--color-red)' }}>*</span>
                </label>
                <input
                  name="name"
                  defaultValue={supplier?.name ?? ''}
                  required
                  className={inputBase}
                  style={inputStyle}
                  placeholder="e.g. Al Barakah Trading"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold" style={{ color: 'var(--color-ink)' }}>
                    Contact Person
                  </label>
                  <input
                    name="contact_person"
                    defaultValue={supplier?.contact_person ?? ''}
                    className={inputBase}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold" style={{ color: 'var(--color-ink)' }}>
                    Phone
                  </label>
                  <input
                    name="phone"
                    defaultValue={supplier?.phone ?? ''}
                    className={inputBase}
                    style={inputStyle}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold" style={{ color: 'var(--color-ink)' }}>
                    Email
                  </label>
                  <input
                    name="email"
                    type="email"
                    defaultValue={supplier?.email ?? ''}
                    className={inputBase}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold" style={{ color: 'var(--color-ink)' }}>
                    TRN
                  </label>
                  <input
                    name="trn"
                    defaultValue={supplier?.trn ?? ''}
                    className={inputBase}
                    style={inputStyle}
                    placeholder="1003…"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold" style={{ color: 'var(--color-ink)' }}>
                  Address
                </label>
                <textarea
                  name="address"
                  defaultValue={supplier?.address ?? ''}
                  rows={2}
                  className={`${inputBase} resize-none`}
                  style={inputStyle}
                />
              </div>

              <div>
                <label className="block text-sm font-semibold" style={{ color: 'var(--color-ink)' }}>
                  Notes
                </label>
                <textarea
                  name="notes"
                  defaultValue={supplier?.notes ?? ''}
                  rows={2}
                  className={`${inputBase} resize-none`}
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
                {isPending ? 'Saving…' : supplier ? 'Save Changes' : 'Add Supplier'}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
