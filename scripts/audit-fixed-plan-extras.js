// Audit: fixed_menu customers who ordered from a meal period NOT covered by
// their plan (e.g. a Lunch-only plan customer also ordering breakfast).
// ROOT CAUSE: buildFixedPlanLineItems/computeFixedInvoiceAmounts (used by both
// generateMonthlyInvoices.ts and generatePrepaidInvoices.ts) lump ALL credit
// orders in the billing period into "usage" and fully discount it back to the
// flat plan rate — with no check that the order's meal_period is one the plan
// actually covers. An out-of-plan order (different meal entirely) should be
// billed in full, not absorbed into the flat rate.
// READ-ONLY — reports every fixed_monthly invoice where this happened and the
// AED amount that should have been billed as an extra charge.
const fs = require('fs')
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/)
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '')
}
const { createClient } = require('@supabase/supabase-js')
const a = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

const PAGE = 1000
async function fetchAll(build) {
  const out = []; let o = 0
  while (true) { const { data, error } = await build(o, o + PAGE - 1); if (error) throw error; out.push(...(data ?? [])); if ((data ?? []).length < PAGE) break; o += PAGE }
  return out
}

async function main() {
  const fixedCustomers = await fetchAll((f, t) => a.from('customers')
    .select('id, full_name, customer_code').eq('customer_type', 'fixed_menu').range(f, t))
  const custById = new Map(fixedCustomers.map(c => [c.id, c]))
  const custIds = fixedCustomers.map(c => c.id)
  if (!custIds.length) { console.log('no fixed_menu customers'); return }

  const subs = await fetchAll((f, t) => a.from('customer_subscriptions')
    .select('customer_id, start_date, end_date, fixed_plans(plan_name, meal_periods)')
    .in('customer_id', custIds).range(f, t))
  const subsByCustomer = new Map()
  for (const s of subs) (subsByCustomer.get(s.customer_id) ?? subsByCustomer.set(s.customer_id, []).get(s.customer_id)).push(s)
  for (const list of subsByCustomer.values()) list.sort((x, y) => x.start_date.localeCompare(y.start_date))

  function planForPeriod(customerId, periodStart) {
    const list = subsByCustomer.get(customerId) ?? []
    // most recent sub that had started by periodStart
    let best = null
    for (const s of list) if (s.start_date <= periodStart) best = s
    return best?.fixed_plans ?? null
  }

  const invoices = await fetchAll((f, t) => a.from('invoices')
    .select('id, invoice_number, customer_id, billing_period_start, billing_period_end, total_amount, status')
    .eq('invoice_type', 'fixed_monthly').in('customer_id', custIds)
    .not('status', 'in', '(cancelled,written_off)').order('billing_period_start').range(f, t))

  const orders = await fetchAll((f, t) => a.from('orders')
    .select('id, customer_id, order_date, meal_period, total_amount')
    .in('customer_id', custIds).eq('is_credit', true)
    .not('order_status', 'in', '(cancelled,voided,draft)').range(f, t))
  const ordersByCustomer = new Map()
  for (const o of orders) (ordersByCustomer.get(o.customer_id) ?? ordersByCustomer.set(o.customer_id, []).get(o.customer_id)).push(o)

  const flagged = []
  for (const inv of invoices) {
    const plan = planForPeriod(inv.customer_id, inv.billing_period_start)
    if (!plan || !plan.meal_periods?.length) continue // no plan info -> can't judge, skip
    const covered = new Set(plan.meal_periods)
    const custOrders = (ordersByCustomer.get(inv.customer_id) ?? [])
      .filter(o => o.order_date >= inv.billing_period_start && o.order_date <= inv.billing_period_end)
    const outOfPlan = custOrders.filter(o => !covered.has(o.meal_period))
    if (!outOfPlan.length) continue
    const missed = outOfPlan.reduce((s, o) => s + parseFloat(o.total_amount), 0)
    if (missed < 0.005) continue
    const byMeal = {}
    for (const o of outOfPlan) byMeal[o.meal_period] = (byMeal[o.meal_period] ?? 0) + parseFloat(o.total_amount)
    flagged.push({
      code: custById.get(inv.customer_id)?.customer_code, name: custById.get(inv.customer_id)?.full_name.trim(),
      plan: plan.plan_name, covers: [...covered].join('+'),
      inv: inv.invoice_number, status: inv.status, period: `${inv.billing_period_start}..${inv.billing_period_end}`,
      billed: parseFloat(inv.total_amount), missed, byMeal, orderCount: outOfPlan.length,
    })
  }

  flagged.sort((x, y) => y.missed - x.missed)
  let total = 0
  const byCustomer = new Map()
  for (const f of flagged) {
    total += f.missed
    const key = f.code
    byCustomer.set(key, (byCustomer.get(key) ?? { name: f.name, code: f.code, invoices: 0, missed: 0 }))
    const b = byCustomer.get(key); b.invoices++; b.missed += f.missed
  }

  console.log(`== ${flagged.length} invoice(s) across ${byCustomer.size} customer(s) with out-of-plan orders folded into the fixed-plan discount ==\n`)
  for (const f of flagged) {
    console.log(`${f.name} (${f.code}) | plan "${f.plan}" covers [${f.covers}] | ${f.inv} (${f.status}) ${f.period} billed ${f.billed.toFixed(2)} | MISSED ${f.missed.toFixed(2)} from ${f.orderCount} order(s): ${JSON.stringify(f.byMeal)}`)
  }
  console.log(`\n== Per-customer totals ==`)
  for (const b of [...byCustomer.values()].sort((x, y) => y.missed - x.missed)) {
    console.log(`${b.name} (${b.code}): ${b.invoices} invoice(s), AED ${b.missed.toFixed(2)} underbilled`)
  }
  console.log(`\nTOTAL underbilled across all fixed-menu customers: AED ${total.toFixed(2)}`)
}

main().catch(e => { console.error(e); process.exit(1) })
