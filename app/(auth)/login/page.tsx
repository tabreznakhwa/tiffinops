'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export default function LoginPage() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleGoogleSignIn() {
    setLoading(true)
    setError(null)

    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    })

    if (error) {
      setError(error.message)
      setLoading(false)
    }
    // On success the browser redirects — no state update needed
  }

  return (
    <div
      className="w-full max-w-sm rounded-2xl overflow-hidden"
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        boxShadow: 'var(--shadow-card)',
      }}
    >
      {/* Header stripe */}
      <div className="px-7 pt-8 pb-6" style={{ background: 'var(--color-ink)' }}>
        <div className="flex items-center gap-3 mb-4">
          <div
            className="w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ background: 'var(--color-saffron)', boxShadow: '0 0 0 3px rgba(231,111,42,.25)' }}
          >
            <span
              className="text-sm font-bold leading-none"
              style={{ fontFamily: '"Saira Stencil One", sans-serif', color: '#221A13' }}
            >
              AC
            </span>
          </div>
          <div>
            <div className="font-display font-extrabold text-lg text-white leading-tight">TiffinOps</div>
            <div className="text-xs leading-tight" style={{ color: '#C9BEB1' }}>
              Apna Chulha Restaurant LLC · Dubai
            </div>
          </div>
        </div>
        <p className="text-sm" style={{ color: '#C9BEB1' }}>
          Internal operations platform. Access requires admin approval.
        </p>
      </div>

      {/* Body */}
      <div className="px-7 py-7">
        <h1 className="font-display font-bold text-xl mb-1" style={{ color: 'var(--color-ink)' }}>
          Sign in to your account
        </h1>
        <p className="text-sm mb-6" style={{ color: 'var(--color-muted)' }}>
          Use the Google account you were onboarded with.
        </p>

        {error && (
          <div
            className="text-sm rounded-lg px-4 py-3 mb-4"
            style={{ background: 'var(--color-red-soft)', color: 'var(--color-red)' }}
          >
            {error}
          </div>
        )}

        <button
          onClick={handleGoogleSignIn}
          disabled={loading}
          className="w-full flex items-center justify-center gap-3 rounded-xl font-semibold text-sm transition-opacity disabled:opacity-60"
          style={{
            minHeight: 48,
            border: '1.5px solid var(--color-border)',
            background: loading ? 'var(--color-cream)' : 'var(--color-surface)',
            color: 'var(--color-ink)',
          }}
        >
          {/* Google G icon */}
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615Z"/>
            <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z"/>
            <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332Z"/>
            <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58Z"/>
          </svg>
          {loading ? 'Redirecting…' : 'Continue with Google'}
        </button>

        <p className="text-xs text-center mt-5" style={{ color: 'var(--color-muted)' }}>
          New sign-ins are held for approval. Contact Tabrez if your account is pending.
        </p>
      </div>
    </div>
  )
}
