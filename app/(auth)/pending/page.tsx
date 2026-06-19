'use client'

import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

export default function PendingPage() {
  const router = useRouter()

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <div
      className="w-full max-w-sm text-center rounded-2xl overflow-hidden"
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        boxShadow: 'var(--shadow-card)',
      }}
    >
      {/* Header */}
      <div className="px-7 pt-8 pb-6" style={{ background: 'var(--color-ink)' }}>
        <div className="flex justify-center mb-4">
          <div
            className="w-12 h-12 rounded-full flex items-center justify-center"
            style={{ background: 'var(--color-saffron)', boxShadow: '0 0 0 3px rgba(231,111,42,.25)' }}
          >
            <span
              className="text-sm font-bold leading-none"
              style={{ fontFamily: '"Saira Stencil One", sans-serif', color: '#221A13' }}
            >
              AC
            </span>
          </div>
        </div>
        <div className="font-display font-extrabold text-lg text-white">TiffinOps</div>
        <div className="text-xs mt-0.5" style={{ color: '#C9BEB1' }}>
          Apna Chulha Restaurant LLC · Dubai
        </div>
      </div>

      {/* Body */}
      <div className="px-7 py-8">
        {/* Hourglass icon */}
        <div
          className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-5"
          style={{ background: 'var(--color-saffron-soft)' }}
        >
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--color-ember)' }}>
            <path d="M5 2h14M5 22h14M17 2v3.5a6 6 0 0 1-2.4 4.8L12 12m0 0l-2.6-1.7A6 6 0 0 1 7 5.5V2m5 10 2.6 1.7A6 6 0 0 1 17 18.5V22M12 12l-2.4 1.7A6 6 0 0 0 7 18.5V22"/>
          </svg>
        </div>

        <h1 className="font-display font-bold text-xl mb-2" style={{ color: 'var(--color-ink)' }}>
          Access pending approval
        </h1>
        <p className="text-sm leading-relaxed mb-6" style={{ color: 'var(--color-muted)' }}>
          Your Google account has been registered. Tabrez (the Owner) needs to approve your access and assign your role before you can log in.
        </p>

        <div
          className="text-sm rounded-xl px-4 py-4 mb-6 text-left"
          style={{ background: 'var(--color-saffron-soft)', border: '1px solid #F3D6BD' }}
        >
          <p className="font-semibold mb-1" style={{ color: 'var(--color-ember)' }}>Contact to get approved:</p>
          <p style={{ color: 'var(--color-ink)' }}>Tabrez · <a href="tel:+971502255710" className="underline">+971 50 225 5710</a></p>
          <p style={{ color: 'var(--color-ink)' }}>
            <a href="mailto:orders@apnachulha.com" className="underline">orders@apnachulha.com</a>
          </p>
        </div>

        <button
          onClick={handleSignOut}
          className="w-full rounded-xl font-semibold text-sm transition-colors"
          style={{
            minHeight: 44,
            border: '1px solid var(--color-border)',
            background: 'var(--color-cream)',
            color: 'var(--color-muted)',
          }}
        >
          Sign out and try another account
        </button>
      </div>
    </div>
  )
}
