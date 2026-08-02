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
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function toUTCDate(d: string): Date {
  return new Date(d + 'T00:00:00Z')
}

function addDaysStr(d: string, n: number): string {
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
  return input.mealPeriods.length > 0 ? input.agreedMonthlyPrice / input.mealPeriods.length : 0
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
  const effectiveSubEnd =
    (input.subStatus === 'cancelled' || input.subStatus === 'completed') && input.subEnd
      ? input.subEnd
      : input.rangeTo

  const clampedStart = maxStr(input.subStart, input.rangeFrom)
  const clampedEnd   = minStr(effectiveSubEnd, input.rangeTo)
  if (clampedStart > clampedEnd) return 0

  let total = 0
  let cursor = clampedStart

  while (cursor <= clampedEnd) {
    const year  = toUTCDate(cursor).getUTCFullYear()
    const month = toUTCDate(cursor).getUTCMonth() + 1 // 1-12
    const monthLastDay = daysInMonth(year, month)
    const monthEnd = `${year}-${String(month).padStart(2, '0')}-${String(monthLastDay).padStart(2, '0')}`
    const windowEnd = minStr(monthEnd, clampedEnd)

    const activeDaysInMonth =
      Math.round((toUTCDate(windowEnd).getTime() - toUTCDate(cursor).getTime()) / 86400000) + 1

    for (const meal of input.mealPeriods) {
      const monthlyPrice = mealMonthlyPrice(meal, input)
      const pausedDays   = Math.min(activeDaysInMonth, pausedDaysInRange(input.pauses, meal, cursor, windowEnd))
      const chargedDays  = Math.max(0, activeDaysInMonth - pausedDays)
      total += (monthlyPrice * chargedDays) / monthLastDay
    }

    cursor = addDaysStr(windowEnd, 1)
  }

  return Math.round(total * 100) / 100
}
