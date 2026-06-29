export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { requireAuth } from '@/lib/auth'
import { getSettings } from '@/lib/settings/getSettings'
import { SettingsModule } from '@/components/settings/settings-module'

export default async function SettingsPage() {
  const user = await requireAuth()
  if (user.role !== 'owner') redirect('/')

  const settings = await getSettings()

  return <SettingsModule settings={settings} />
}
