import { NextRequest, NextResponse } from 'next/server'
import { formatInTimeZone } from 'date-fns-tz'
import { generatePrepaidAnniversaryInvoices } from '@/lib/invoices/generatePrepaidInvoices'

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

  // Allow ?date=YYYY-MM-DD override for a missed/manual run; default = today (Dubai)
  const url = new URL(req.url)
  const dateParam = url.searchParams.get('date')
  const today = dateParam ?? formatInTimeZone(new Date(), 'Asia/Dubai', 'yyyy-MM-dd')

  // Automatic generation is intentionally limited to Mai Dubai. The same
  // generator remains available without this scope through the owner-only UI.
  const result = await generatePrepaidAnniversaryInvoices(today, 'system-cron', {
    onlyArea: 'Mai Dubai',
  })

  return NextResponse.json({ ok: true, ...result })
}

// Also support POST for manual trigger from the UI (via server action, not this route)
export { GET as POST }
