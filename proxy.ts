import { createServerClient } from '@supabase/ssr'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse, type NextRequest } from 'next/server'

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  // SSR client — needed only to validate the session (getUser).
  // DO NOT use this client to query public.users; the anon key hits RLS and
  // is_active_user() can recursively block the read. Use the admin client instead.
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          // Forward any refreshed tokens to both the mutated request and the response.
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // IMPORTANT: Do not add logic between createServerClient and getUser().
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl

  // ── diagnostic ──────────────────────────────────────────────────────────────
  console.log('[mw]', pathname, 'user:', user?.id ?? 'none')
  // ────────────────────────────────────────────────────────────────────────────

  const isPublicPath =
    pathname.startsWith('/login') ||
    pathname.startsWith('/pending') ||
    pathname.startsWith('/auth/')

  if (!user) {
    if (isPublicPath) return supabaseResponse
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // Use the service-role admin client to read the user's status so we bypass
  // RLS entirely. The anon-key client can't reliably read public.users in the
  // proxy because is_active_user() creates a recursive RLS evaluation.
  let status: string | null = null
  try {
    const serviceKeyPresent = !!process.env.SUPABASE_SERVICE_ROLE_KEY
    console.log('[proxy] uid:', user.id, '| path:', pathname, '| service key present:', serviceKeyPresent)

    const admin = createAdminClient()
    const { data, error } = await admin
      .from('users')
      .select('status')
      .eq('id', user.id)
      .single()

    console.log('[proxy] users query → data:', JSON.stringify(data), '| error:', error?.message ?? 'none')
    status = data?.status ?? null
  } catch (err) {
    // If SUPABASE_SERVICE_ROLE_KEY is missing or the query fails, fail safe:
    // treat the user as pending so they can't access app data.
    console.error('[proxy] admin client threw:', err instanceof Error ? err.message : String(err))
    status = null
  }

  console.log('[proxy] resolved status:', status, '→ isPending:', !status || status === 'pending')

  const isPending = !status || status === 'pending'
  const isInactive = status === 'inactive'

  if (isPending) {
    if (pathname.startsWith('/pending')) return supabaseResponse
    const url = request.nextUrl.clone()
    url.pathname = '/pending'
    return NextResponse.redirect(url)
  }

  if (isInactive) {
    if (pathname.startsWith('/login')) return supabaseResponse
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // Active user hitting auth pages — send to the app.
  if (pathname.startsWith('/login') || pathname.startsWith('/pending')) {
    const url = request.nextUrl.clone()
    url.pathname = '/'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
