import { requireAuth } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { Topbar } from '@/components/app-shell/topbar'
import { Nav } from '@/components/app-shell/nav'
import { Sidebar } from '@/components/app-shell/sidebar'
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
        <div className="flex flex-1 min-h-0">
          {/* Desktop: vertical sidebar */}
          <Sidebar pendingApprovals={count ?? 0} isOwner={user.role === 'owner'} userRole={user.role} />
          <div className="flex flex-col flex-1 min-w-0">
            {/* Mobile: horizontal scrollable nav */}
            <div className="md:hidden">
              <Nav pendingApprovals={count ?? 0} isOwner={user.role === 'owner'} userRole={user.role} />
            </div>
            <main className="flex-1 px-4 md:px-6 py-5 pb-24">
              {children}
            </main>
          </div>
        </div>
      </div>
    </SettingsProvider>
  )
}
