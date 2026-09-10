import { NextRequest, NextResponse } from 'next/server'
import { formatInTimeZone } from 'date-fns-tz'
import { generateMonthlyInvoices } from '@/lib/invoices/generateMonthlyInvoices'

// Vercel Cron sends Authorization: Bearer <CRON_SECRET>
// Set CRON_SECRET in your environment variables.
function isAuthorized(req: NextRequest): boolean {
  const authHeader = req.headers.get('authorization')
  const secret = process.env.CRON_SECRET
  if (!secret) return false // deny if not configured
  return authHeader === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Allow ?month=YYYY-MM override; default = current Dubai month (the month
  // being closed — matches ala-carte-invoice-check, cron runs on the 26th
  // once the 26-25 cycle for this month is fully elapsed)
  const url = new URL(req.url)
  const monthParam = url.searchParams.get('month')

  const currentDubaiMonth = formatInTimeZone(new Date(), 'Asia/Dubai', 'yyyy-MM')
  const targetMonth = monthParam ?? currentDubaiMonth

  // System-initiated — no real user, use a sentinel ID
  const result = await generateMonthlyInvoices(targetMonth, 'system-cron')

  return NextResponse.json({ ok: true, ...result })
}

// Also support POST for manual trigger from the UI (via server action, not this route)
export { GET as POST }
