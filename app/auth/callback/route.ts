import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { createAdminClient } from '@/lib/supabase/admin'
import { cookies } from 'next/headers'
import { NextResponse, type NextRequest } from 'next/server'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/'

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`)
  }

  const cookieStore = await cookies()

  // Collect every cookie Supabase wants to set during the code exchange so we
  // can stamp them directly onto the redirect response. Using only
  // cookieStore.set() risks losing them if Next.js doesn't merge route-handler
  // cookie mutations into a subsequent NextResponse.redirect() object.
  const pendingCookies: Array<{ name: string; value: string; options: CookieOptions }> = []

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          // Stash for the redirect response AND set on the server-side store so
          // any subsequent server-component reads in this handler see them.
          cookiesToSet.forEach(({ name, value, options }) => {
            pendingCookies.push({ name, value, options })
            try {
              cookieStore.set(name, value, options)
            } catch {
              // Swallow — we rely on pendingCookies for the response anyway.
            }
          })
        },
      },
    }
  )

  const { data, error } = await supabase.auth.exchangeCodeForSession(code)

  if (error || !data.user) {
    console.error('[auth/callback] exchangeCodeForSession error:', error?.message)
    const url = new URL('/login', origin)
    url.searchParams.set('error', 'auth_failed')
    return NextResponse.redirect(url)
  }

  const authUser = data.user

  // Use the admin client so we bypass RLS entirely for user provisioning.
  const admin = createAdminClient()

  // Upsert: create the public.users row on first sign-in, leave it alone on
  // subsequent sign-ins. on_conflict(id) do nothing is idempotent.
  const { error: upsertError } = await admin.from('users').upsert(
    {
      id: authUser.id,
      email: authUser.email!,
      full_name:
        authUser.user_metadata?.full_name ??
        authUser.user_metadata?.name ??
        authUser.email!.split('@')[0],
      role: 'viewer',
      status: 'pending',
    },
    { onConflict: 'id', ignoreDuplicates: true }
  )

  if (upsertError) {
    console.error('[auth/callback] upsert public.users error:', upsertError.message)
  }

  // Read the canonical status (may differ from 'pending' if already approved).
  const { data: appUser } = await admin
    .from('users')
    .select('status')
    .eq('id', authUser.id)
    .single()

  console.log('[callback] uid:', authUser.id, '| appUser from admin:', JSON.stringify(appUser), '| pendingCookies count:', pendingCookies.length)

  const destination =
    appUser?.status === 'active' ? `${origin}${next}` : `${origin}/pending`

  console.log('[callback] redirecting to:', destination)

  // Build the redirect and apply the session cookies collected above.
  const response = NextResponse.redirect(destination)
  pendingCookies.forEach(({ name, value, options }) => {
    response.cookies.set(name, value, options as Parameters<typeof response.cookies.set>[2])
  })

  return response
}
