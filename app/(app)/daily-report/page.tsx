export const dynamic = 'force-dynamic'

import { formatInTimeZone } from 'date-fns-tz'
import { requireAuth } from '@/lib/auth'
import { loadDailyReportData } from '@/lib/daily-report/data'
import { DailyReportModule } from '@/components/daily-report/daily-report-module'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export default async function DailyReportPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; from?: string; to?: string }>
}) {
  await requireAuth()

  const { date, from, to } = await searchParams
  const todayDubai = formatInTimeZone(new Date(), 'Asia/Dubai', 'yyyy-MM-dd')

  let rangeFrom: string
  let rangeTo: string
  if (from && to && DATE_RE.test(from) && DATE_RE.test(to)) {
    rangeFrom = from <= to ? from : to
    rangeTo = from <= to ? to : from
  } else {
    const single = date && DATE_RE.test(date) ? date : todayDubai
    rangeFrom = single
    rangeTo = single
  }

  const { orders, fixedMenuCounts, costByItem } = await loadDailyReportData(rangeFrom, rangeTo)

  return (
    <DailyReportModule
      orders={orders}
      fixedMenuCounts={fixedMenuCounts}
      costByItem={costByItem}
      from={rangeFrom}
      to={rangeTo}
      todayDubai={todayDubai}
    />
  )
}
