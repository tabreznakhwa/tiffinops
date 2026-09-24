export const dynamic = 'force-dynamic'

import { formatInTimeZone } from 'date-fns-tz'
import { requireAuth } from '@/lib/auth'
import { loadDailyReportData } from '@/lib/daily-report/data'
import { DailyReportModule } from '@/components/daily-report/daily-report-module'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export default async function DailyReportPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>
}) {
  await requireAuth()

  const { date } = await searchParams
  const todayDubai = formatInTimeZone(new Date(), 'Asia/Dubai', 'yyyy-MM-dd')
  const reportDate = date && DATE_RE.test(date) ? date : todayDubai

  const { orders, fixedMenuCounts } = await loadDailyReportData(reportDate)

  return (
    <DailyReportModule
      orders={orders}
      fixedMenuCounts={fixedMenuCounts}
      reportDate={reportDate}
      todayDubai={todayDubai}
    />
  )
}
