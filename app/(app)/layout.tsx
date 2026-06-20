import { requireAuth } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { Topbar } from '@/components/app-shell/topbar'
import { Nav } from '@/components/app-shell/nav'
import { getSettings, FALLBACK } from '@/lib/settings/getSettings'
import { SettingsProvider } from '@/components/settings/settings-context'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAuth()

  let count = 0
  let settings = FALLBACK

  try {
    const [approvalResult, s] = await Promise.all([
      createClient()
        .then(supabase =>
          supabase
            .from('approval_requests')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'pending')
        )
        .catch(() => ({ count: 0 as number | null })),
      getSettings(),
    ])
    count = approvalResult?.count ?? 0
    settings = s
  } catch (err) {
    console.error('[AppLayout] secondary data failed:', err)
  }

  return (
    <SettingsProvider
      currency={settings.currency}
      vatRate={parseFloat(String(settings.vat_percent ?? '5'))}
      businessName={settings.business_name}
    >
      <div className="flex flex-col min-h-screen">
        <Topbar user={user} />
        <Nav pendingApprovals={count ?? 0} isOwner={user.role === 'owner'} userRole={user.role} />
        <main className="flex-1 mx-auto w-full max-w-[1180px] px-4 py-5 pb-24">
          {children}
        </main>
      </div>
    </SettingsProvider>
  )
}
