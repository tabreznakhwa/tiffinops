import { NextRequest, NextResponse } from 'next/server'
import { formatInTimeZone } from 'date-fns-tz'
import { sendScheduledMenu, type ScheduledMealPeriod } from '@/lib/whatsapp/scheduled-menu'

export const runtime = 'nodejs'
export const maxDuration = 60

const TZ = 'Asia/Dubai'
const MEALS = new Set<ScheduledMealPeriod>(['breakfast', 'lunch', 'dinner'])

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  return !!secret && req.headers.get('authorization') === `Bearer ${secret}`
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const mealParam = url.searchParams.get('meal') as ScheduledMealPeriod | null
  if (!mealParam || !MEALS.has(mealParam)) {
    return NextResponse.json({ error: 'meal must be breakfast, lunch, or dinner' }, { status: 400 })
  }

  const today = formatInTimeZone(new Date(), TZ, 'yyyy-MM-dd')
  // Breakfast is announced the previous evening, so its menu date is tomorrow.
  const menuDate = url.searchParams.get('date')
    ?? (mealParam === 'breakfast' ? addDays(today, 1) : today)

  if (!/^\d{4}-\d{2}-\d{2}$/.test(menuDate)) {
    return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 })
  }

  const result = await sendScheduledMenu(menuDate, mealParam)
  return NextResponse.json(result, { status: result.ok ? 200 : 500 })
}

export { GET as POST }
