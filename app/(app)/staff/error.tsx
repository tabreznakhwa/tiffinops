'use client'

export default function StaffError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
      <p className="font-bold text-lg" style={{ color: 'var(--color-red)' }}>
        Staff page failed to load
      </p>
      <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
        {error.message || 'An unexpected error occurred.'}
      </p>
      {error.digest && (
        <p className="text-xs font-mono px-3 py-1 rounded" style={{ background: 'var(--color-border)', color: 'var(--color-muted)' }}>
          Digest: {error.digest}
        </p>
      )}
      <button
        onClick={reset}
        className="px-4 py-2 rounded-[10px] text-sm font-semibold"
        style={{ background: 'var(--color-saffron)', color: '#fff' }}
      >
        Try again
      </button>
    </div>
  )
}
