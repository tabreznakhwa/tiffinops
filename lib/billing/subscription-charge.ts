// Shared subscription billing math.
//
// One implementation used by the Outstanding report, the Dashboard and the
// Customers list so all three always agree on "what this customer owes".
// Previously the Dashboard and Customers page used the flat monthly rate,
// which over-billed anyone who joined mid-month.

export type ChargeableSubscription = {
  id?: string
  customer_id?: string
  start_date: string           // 'YYYY-MM-DD'
  end_date: string | null      // 'YYYY-MM-DD' — billing cutoff for paused/cancelled
  status: string
  agreed_monthly_price: string | number
}

const MS_PER_DAY = 86_400_000

function toMs(d: string): number {
  const [y, m, day] = d.split('-').map(Number)
  return Date.UTC(y, m - 1, day)
}

function toStr(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/**
 * Pro-rata charge for one subscription over [rangeFrom, rangeTo] (both inclusive).
 *
 * Partial months at either end are charged by the day:
 *   activeDaysInMonth / daysInThatMonth * monthlyPrice
 *
 * An end_date always caps billing, whatever `status` says. Real data is full of
 * rows left as 'active' with an end_date set — a subscription was replaced but
 * never closed out — and those must not keep billing past that date. A row with
 * no end_date bills through the end of the range.
 */
export function chargeForRange(
  subStart: string,
  subEnd: string | null,
  monthlyPrice: number,
  rangeFrom: string,
  rangeTo: string,
): number {
  if (!monthlyPrice || !subStart || subStart > rangeTo) return 0

  const subLastDay = subEnd ?? rangeTo

  // Active window = intersection of the subscription period and the range
  const wFrom = subStart > rangeFrom ? subStart : rangeFrom
  const wTo   = subLastDay < rangeTo ? subLastDay : rangeTo
  if (wFrom > wTo) return 0

  const wFromMs = toMs(wFrom)
  const wToMs   = toMs(wTo)

  let total = 0
  const firstDate = new Date(wFromMs)
  let yr = firstDate.getUTCFullYear()
  let mo = firstDate.getUTCMonth()   // 0-based

  while (true) {
    const monthFirstMs     = Date.UTC(yr, mo, 1)
    const nextMonthFirstMs = Date.UTC(yr, mo + 1, 1)
    const daysInMonth      = (nextMonthFirstMs - monthFirstMs) / MS_PER_DAY
    const monthLastMs      = nextMonthFirstMs - MS_PER_DAY

    const segFromMs = wFromMs > monthFirstMs ? wFromMs : monthFirstMs
    const segToMs   = wToMs   < monthLastMs  ? wToMs   : monthLastMs
    if (segFromMs > segToMs) break

    const activeDays = Math.round((segToMs - segFromMs) / MS_PER_DAY) + 1
    total += (activeDays / daysInMonth) * monthlyPrice

    mo++
    if (mo > 11) { mo = 0; yr++ }
    if (Date.UTC(yr, mo, 1) > wToMs) break
  }

  return total
}

/**
 * Total charge across ALL of a customer's subscriptions, with overlap protection.
 *
 * Real data contains cases where an old subscription was cancelled with an
 * end_date AFTER the replacement subscription already started — billing the
 * overlapping days twice. We clamp each subscription so it never bills past the
 * day before the next subscription begins.
 *
 * @param subs  every subscription row for ONE customer
 */
export function chargeForCustomer(
  subs: ChargeableSubscription[],
  rangeFrom: string,
  rangeTo: string,
): number {
  if (subs.length === 0) return 0

  const ordered = [...subs].sort((a, b) => a.start_date.localeCompare(b.start_date))

  let total = 0
  for (let i = 0; i < ordered.length; i++) {
    const sub  = ordered[i]
    const next = ordered[i + 1]
    const rate = parseFloat(String(sub.agreed_monthly_price)) || 0
    if (!rate) continue

    // Clamp this subscription so it stops the day before the next one starts.
    let effectiveEnd = sub.end_date
    if (next) {
      const dayBeforeNext = toStr(toMs(next.start_date) - MS_PER_DAY)
      if (!effectiveEnd || effectiveEnd > dayBeforeNext) effectiveEnd = dayBeforeNext
    }

    total += chargeForRange(sub.start_date, effectiveEnd, rate, rangeFrom, rangeTo)
  }

  return total
}

/** Group subscription rows by customer_id. */
export function groupSubscriptionsByCustomer<T extends { customer_id?: string }>(
  subs: T[],
): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const s of subs) {
    if (!s.customer_id) continue
    const list = map.get(s.customer_id)
    if (list) list.push(s)
    else map.set(s.customer_id, [s])
  }
  return map
}
