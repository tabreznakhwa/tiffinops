export const dynamic = 'force-dynamic'

import { formatInTimeZone } from 'date-fns-tz'
import { requireAuth } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { DayWiseMenuModule } from '@/components/day-wise-menu/day-wise-menu-module'

// Matches daily_menus_write / daily_menu_items_write RLS exactly (01_schema.sql:519,521).
const WRITE_ROLES = ['owner', 'manager']
const TZ = 'Asia/Dubai'
const UPCOMING_DAYS = 14

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export default async function DayWiseMenuPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>
}) {
  const user = await requireAuth()
  const params = await searchParams
  const admin = createAdminClient()

  const today = formatInTimeZone(new Date(), TZ, 'yyyy-MM-dd')
  const date = params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : today
  const rangeEnd = addDays(today, UPCOMING_DAYS - 1)

  const [{ data: items }, { data: dailyMenu }, { data: upcoming }] = await Promise.all([
    admin.from('menu_items').select('id, name, meal_period, default_price').eq('is_available', true).order('name'),
    admin.from('daily_menus').select('id, is_published').eq('menu_date', date).maybeSingle(),
    admin.from('daily_menus').select('menu_date, is_published').gte('menu_date', today).lte('menu_date', rangeEnd),
  ])

  const { data: dailyMenuItems } = dailyMenu?.id
    ? await admin
        .from('daily_menu_items')
        .select('menu_item_id, is_available, price_override')
        .eq('daily_menu_id', dailyMenu.id)
    : { data: [] }

  return (
    <DayWiseMenuModule
      date={date}
      today={today}
      items={items ?? []}
      isPublished={dailyMenu?.is_published ?? false}
      overrides={dailyMenuItems ?? []}
      upcoming={upcoming ?? []}
      canWrite={WRITE_ROLES.includes(user.role)}
    />
  )
}
