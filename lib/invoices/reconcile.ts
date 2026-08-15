import type { createAdminClient } from '@/lib/supabase/admin'

type AdminClient = ReturnType<typeof createAdminClient>

/**
 * Recompute an invoice's status from the payments actually linked to it.
 * Called after a linked payment is recorded or voided, so the status stays
 * in sync without anyone having to manually flip it.
 *
 * Never touches draft (issue first), cancelled, or written_off — those are
 * deliberate states outside the paid/partial/issued lifecycle.
 */
export async function reconcileInvoicePaymentStatus(admin: AdminClient, invoiceId: string) {
  const { data: invoice } = await admin
    .from('invoices')
    .select('id, status, total_amount')
    .eq('id', invoiceId)
    .single()
  if (!invoice) return
  if (['draft', 'cancelled', 'written_off'].includes(invoice.status)) return

  const { data: payments } = await admin
    .from('payments')
    .select('amount')
    .eq('invoice_id', invoiceId)
    .is('voided_at', null)

  const paid  = (payments ?? []).reduce((sum, p) => sum + parseFloat(String(p.amount)), 0)
  const total = parseFloat(String(invoice.total_amount))

  const nextStatus = paid >= total - 0.01 ? 'paid' : paid > 0 ? 'partial' : 'issued'
  if (nextStatus !== invoice.status) {
    await admin.from('invoices').update({ status: nextStatus }).eq('id', invoiceId)
  }
}
