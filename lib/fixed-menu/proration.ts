// Pure billing math for Fixed Menu subscriptions with per-meal pauses.
// Used by both the Outstanding report (client) and the monthly invoice
// cron (server) so the "what they owe" figure always matches the real bill.

export type MealPeriod = 'breakfast' | 'lunch' | 'dinner'

export type MealPause = {
  meal_period: string
  pause_start: string
  pause_end: string | null
}

export type ProrationInput = {
  mealPeriods: string[]                        // from fixed_plans.meal_periods
  agreedMonthlyPrice: number
  mealPrices: Record<string, string | number> | null   // per-meal split, or null → even split
  subStart: string
  subEnd: string | null
  subStatus: string
  pauses: MealPause[]                           // pauses for this subscription only
  rangeFrom: string                             // 'YYYY-MM-DD'
  rangeTo: string                               // 'YYYY-MM-DD'
  // Total length (in days) of the billing cycle [rangeFrom, rangeTo] belongs
  // to, when that whole range IS one cycle — e.g. a prepaid anniversary cycle
  // (customer's start-day to the day before their next anniversary), which
  // routinely crosses two calendar months of different lengths. When set,
  // proration is done once against this fixed denominator instead of being
  // fragmented per calendar month — so an uninterrupted cycle always bills
  // the flat agreedMonthlyPrice, and only a genuinely partial cycle (cut
  // short by a pause or subEnd) is charged less, in proportion to the whole
  // cycle's own length. Omit for calls that span multiple/partial calendar
  // months by design (postpaid monthly billing, or a multi-month summary),
  // where per-calendar-month proration is the correct, existing behavior.
  cycleDays?: number
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function toUTCDate(d: string): Date {
  return new Date(d + 'T00:00:00Z')
}

export function addDaysStr(d: string, n: number): string {
  const date = toUTCDate(d)
  date.setUTCDate(date.getUTCDate() + n)
  return date.toISOString().slice(0, 10)
}

function maxStr(a: string, b: string): string {
  return a > b ? a : b
}

function minStr(a: string, b: string): string {
  return a < b ? a : b
}

// Per-meal monthly price share — custom split if provided, else even split.
function mealMonthlyPrice(meal: string, input: ProrationInput): number {
  if (input.mealPrices && input.mealPrices[meal] != null) {
    return parseFloat(String(input.mealPrices[meal]))
  }
  return input.mealPeriods.length > 0 ? input.agreedMonthlyPrice / input.mealPeriods.length : input.agreedMonthlyPrice
}

export function isMealPausedOn(pauses: MealPause[], meal: string, date: string): boolean {
  return pauses.some(p =>
    p.meal_period === meal &&
    p.pause_start <= date &&
    (p.pause_end == null || p.pause_end >= date)
  )
}

// Count days in [from, to] (inclusive) that fall inside a pause window for `meal`.
function pausedDaysInRange(pauses: MealPause[], meal: string, from: string, to: string): number {
  let paused = 0
  for (const p of pauses) {
    if (p.meal_period !== meal) continue
    const pStart = maxStr(p.pause_start, from)
    const pEnd   = minStr(p.pause_end ?? to, to)
    if (pStart > pEnd) continue
    const days = Math.round((toUTCDate(pEnd).getTime() - toUTCDate(pStart).getTime()) / 86400000) + 1
    paused += days
  }
  return paused
}

export function calcSubscriptionCharge(input: ProrationInput): number {
  // `end_date` is a billing cutoff in real data, even when old rows were left
  // as "active" after being replaced. Always cap by it to avoid billing past
  // the selected stop/pause date.
  const effectiveSubEnd = input.subEnd ?? input.rangeTo

  const clampedStart = maxStr(input.subStart, input.rangeFrom)
  const clampedEnd   = minStr(effectiveSubEnd, input.rangeTo)
  if (clampedStart > clampedEnd) return 0

  let total = 0

  if (input.cycleDays && input.cycleDays > 0) {
    // Whole-cycle proration: [rangeFrom, rangeTo] IS one billing cycle (e.g. a
    // prepaid anniversary month), so charge against that cycle's own fixed
    // length rather than fragmenting by calendar month — an uninterrupted
    // cycle bills the flat agreedMonthlyPrice no matter which/how-many
    // calendar months it crosses; only a pause or an early subEnd reduces it.
    const totalDaysInRange =
      Math.round((toUTCDate(clampedEnd).getTime() - toUTCDate(clampedStart).getTime()) / 86400000) + 1

    const meals = input.mealPeriods.length ? input.mealPeriods : ['__flat__']
    for (const meal of meals) {
      const monthlyPrice = mealMonthlyPrice(meal, input)
      const pausedDays   = Math.min(totalDaysInRange, pausedDaysInRange(input.pauses, meal, clampedStart, clampedEnd))
      const chargedDays  = Math.max(0, totalDaysInRange - pausedDays)
      total += (monthlyPrice * chargedDays) / input.cycleDays
    }

    return Math.round(total * 100) / 100
  }

  let cursor = clampedStart

  while (cursor <= clampedEnd) {
    const year  = toUTCDate(cursor).getUTCFullYear()
    const month = toUTCDate(cursor).getUTCMonth() + 1 // 1-12
    const monthLastDay = daysInMonth(year, month)
    const monthEnd = `${year}-${String(month).padStart(2, '0')}-${String(monthLastDay).padStart(2, '0')}`
    const windowEnd = minStr(monthEnd, clampedEnd)

    const activeDaysInMonth =
      Math.round((toUTCDate(windowEnd).getTime() - toUTCDate(cursor).getTime()) / 86400000) + 1

    const meals = input.mealPeriods.length ? input.mealPeriods : ['__flat__']
    for (const meal of meals) {
      const monthlyPrice = mealMonthlyPrice(meal, input)
      const pausedDays   = Math.min(activeDaysInMonth, pausedDaysInRange(input.pauses, meal, cursor, windowEnd))
      const chargedDays  = Math.max(0, activeDaysInMonth - pausedDays)
      total += (monthlyPrice * chargedDays) / monthLastDay
    }

    cursor = addDaysStr(windowEnd, 1)
  }

  return Math.round(total * 100) / 100
}
