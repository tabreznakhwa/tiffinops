// Shared invoice-line construction for fixed-plan billing (fixed_monthly
// invoices), used by both the postpaid monthly generator
// (generateMonthlyInvoices.ts) and the prepaid anniversary generator
// (generatePrepaidInvoices.ts) so the two stay in sync.
//
// Fixed-menu customers pay a flat plan rate regardless of what they order, so
// their invoice shows the order usage + a matching "fixed-plan discount" line
// and always nets out to the agreed monthly price. Hybrid/other customers
// just get the single plan line.

export type FixedInvoiceLineItem = {
  invoice_id: string
  order_id: null
  description: string
  quantity: string
  unit_price: string
  total_price: string
}

/** subtotal/discount/tax/total for a fixed-plan invoice header row. */
export function computeFixedInvoiceAmounts(amount: number, usage: number, vatRate: number) {
  const taxAmount = (amount * vatRate) / (100 + vatRate)
  return {
    subtotal:         (amount + usage).toFixed(2),
    discount_amount:  usage.toFixed(2),
    tax_amount:       taxAmount.toFixed(2),
    total_amount:     amount.toFixed(2),
  }
}

/**
 * Line items: the plan, plus (for fixed-menu, when usage > 0) the order
 * usage and its matching discount so the invoice reads
 * "plan + usage − discount = flat".
 */
export function buildFixedPlanLineItems(params: {
  invoiceId: string
  planName: string
  monthLabel: string
  amount: number
  usage: number
}): FixedInvoiceLineItem[] {
  const { invoiceId, planName, monthLabel, amount, usage } = params

  const lineItems: FixedInvoiceLineItem[] = [{
    invoice_id:  invoiceId,
    order_id:    null,
    description: `Monthly Fixed Plan — ${planName} — ${monthLabel}`,
    quantity:    '1',
    unit_price:  amount.toFixed(2),
    total_price: amount.toFixed(2),
  }]

  if (usage > 0) {
    lineItems.push({
      invoice_id:  invoiceId,
      order_id:    null,
      description: `Extra items — ${monthLabel}`,
      quantity:    '1',
      unit_price:  usage.toFixed(2),
      total_price: usage.toFixed(2),
    })
    lineItems.push({
      invoice_id:  invoiceId,
      order_id:    null,
      description: 'Fixed-plan discount (extra items included in plan)',
      quantity:    '1',
      unit_price:  (-usage).toFixed(2),
      total_price: (-usage).toFixed(2),
    })
  }

  return lineItems
}
