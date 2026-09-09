// Shared invoice-line construction for fixed-plan billing (fixed_monthly
// invoices), used by both the postpaid monthly generator
// (generateMonthlyInvoices.ts) and the prepaid anniversary generator
// (generatePrepaidInvoices.ts) so the two stay in sync.
//
// Fixed-menu customers pay a flat plan rate regardless of what they order
// FROM THE MEAL PERIOD(S) THEIR PLAN COVERS — those orders show as usage with
// a matching "fixed-plan discount" line and net out to the agreed monthly
// price. Orders from a meal period the plan does NOT cover (e.g. a
// lunch-only plan customer also ordering breakfast) are genuine extras and
// must be billed in full, on top of the flat rate — never folded into the
// discount. Hybrid/other customers just get the single plan line.

export type FixedInvoiceLineItem = {
  invoice_id: string
  order_id: null
  description: string
  quantity: string
  unit_price: string
  total_price: string
}

/**
 * subtotal/discount/tax/total for a fixed-plan invoice header row.
 *
 * @param amount          agreed flat monthly plan price
 * @param inPlanUsage     sum of orders in a meal period the plan covers — discounted away
 * @param outOfPlanExtra  sum of orders in a meal period the plan does NOT cover — billed in full
 */
export function computeFixedInvoiceAmounts(
  amount: number,
  inPlanUsage: number,
  outOfPlanExtra: number,
  vatRate: number,
) {
  const billable = amount + outOfPlanExtra
  const taxAmount = (billable * vatRate) / (100 + vatRate)
  return {
    subtotal:         (amount + inPlanUsage + outOfPlanExtra).toFixed(2),
    discount_amount:  inPlanUsage.toFixed(2),
    tax_amount:       taxAmount.toFixed(2),
    total_amount:     billable.toFixed(2),
  }
}

/**
 * Line items: the plan, the in-plan order usage with its matching discount
 * ("plan + usage − discount = flat"), and — separately, with no offsetting
 * discount — any out-of-plan extras billed in full.
 */
export function buildFixedPlanLineItems(params: {
  invoiceId: string
  planName: string
  monthLabel: string
  amount: number
  inPlanUsage: number
  outOfPlanExtras: Partial<Record<'breakfast' | 'lunch' | 'dinner', number>>
  // Set when `amount` was reduced from the plan's flat rate by a per-meal
  // pause (see lib/fixed-menu/proration.ts) — appended to the plan line so
  // the invoice stays self-explanatory to staff and the customer.
  prorationNote?: string
}): FixedInvoiceLineItem[] {
  const { invoiceId, planName, monthLabel, amount, inPlanUsage, outOfPlanExtras, prorationNote } = params

  const lineItems: FixedInvoiceLineItem[] = [{
    invoice_id:  invoiceId,
    order_id:    null,
    description: `Monthly Fixed Plan — ${planName} — ${monthLabel}${prorationNote ? ` (${prorationNote})` : ''}`,
    quantity:    '1',
    unit_price:  amount.toFixed(2),
    total_price: amount.toFixed(2),
  }]

  if (inPlanUsage > 0) {
    lineItems.push({
      invoice_id:  invoiceId,
      order_id:    null,
      description: `Extra items — ${monthLabel}`,
      quantity:    '1',
      unit_price:  inPlanUsage.toFixed(2),
      total_price: inPlanUsage.toFixed(2),
    })
    lineItems.push({
      invoice_id:  invoiceId,
      order_id:    null,
      description: 'Fixed-plan discount (extra items included in plan)',
      quantity:    '1',
      unit_price:  (-inPlanUsage).toFixed(2),
      total_price: (-inPlanUsage).toFixed(2),
    })
  }

  for (const [mealPeriod, mealAmount] of Object.entries(outOfPlanExtras)) {
    if (!mealAmount || mealAmount < 0.005) continue
    const label = mealPeriod.charAt(0).toUpperCase() + mealPeriod.slice(1)
    lineItems.push({
      invoice_id:  invoiceId,
      order_id:    null,
      description: `${label} orders — outside plan — ${monthLabel} (billed in full)`,
      quantity:    '1',
      unit_price:  mealAmount.toFixed(2),
      total_price: mealAmount.toFixed(2),
    })
  }

  return lineItems
}
