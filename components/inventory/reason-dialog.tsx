'use client'

// Small confirm dialog that forces a reason before a destructive inventory
// correction (void purchase / reverse entry). Owner-only actions use this so
// every correction carries a note for the audit trail.

import { useState } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function ReasonDialog({
  title,
  message,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  title: string
  message: string
  confirmLabel: string
  /** Returns an error string to display, or null/undefined on success. */
  onConfirm: (reason: string) => Promise<string | null | undefined>
  onClose: () => void
}) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const valid = reason.trim().length >= 3

  async function handleConfirm() {
    if (!valid || busy) return
    setBusy(true)
    setError(null)
    const err = await onConfirm(reason.trim())
    if (err) {
      setError(err)
      setBusy(false)
    } else {
      onClose()
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(34,26,19,0.45)' }} onClick={onClose}>
      <div
        className="w-full max-w-md rounded-[14px] p-5"
        style={{ background: 'var(--color-surface)', boxShadow: 'var(--shadow-card)' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start gap-2.5 mb-3">
          <AlertTriangle size={18} className="mt-0.5 flex-shrink-0" style={{ color: 'var(--color-red)' }} />
          <div>
            <p className="font-display font-bold text-[17px]" style={{ color: 'var(--color-ink)' }}>{title}</p>
            <p className="text-sm mt-1" style={{ color: 'var(--color-muted)' }}>{message}</p>
          </div>
        </div>

        <label className="block text-[11px] font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--color-muted)' }}>
          Reason (required)
        </label>
        <textarea
          value={reason}
          onChange={e => setReason(e.target.value)}
          rows={2}
          autoFocus
          placeholder="e.g. Scanned the same bill twice"
          className="w-full rounded-[11px] px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-saffron"
          style={{ border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-ink)' }}
        />

        {error && <p className="text-sm font-semibold mt-2" style={{ color: 'var(--color-red)' }}>{error}</p>}

        <div className="flex gap-2 mt-4">
          <Button variant="outline" onClick={onClose} disabled={busy} className="flex-1">Cancel</Button>
          <button
            onClick={handleConfirm}
            disabled={!valid || busy}
            className="flex-1 flex items-center justify-center gap-1.5 rounded-[11px] px-4 py-2.5 text-sm font-bold transition-opacity disabled:opacity-50"
            style={{ background: 'var(--color-red)', color: '#fff' }}
          >
            {busy && <Loader2 size={14} className="animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
