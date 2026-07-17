'use server'

import { revalidatePath } from 'next/cache'
import { requireAuth } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'

// ── requestApproval ────────────────────────────────────────────────────────────

export async function requestApproval(input: {
  request_type: 'delete' | 'edit'
  target_table: 'order' | 'payment' | 'invoice'
  target_id: string
  reason: string
  proposed_changes?: Record<string, unknown> | null
}): Promise<{ error?: string }> {
  const user = await requireAuth()

  if (!input.target_id?.trim()) return { error: 'Target ID is required' }
  if (!input.reason?.trim()) return { error: 'Reason is required' }

  const admin = createAdminClient()

  const { error } = await admin.from('approval_requests').insert({
    request_type: input.request_type,
    target_table: input.target_table,
    target_id: input.target_id,
    reason: input.reason.trim(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    proposed_changes: (input.proposed_changes ?? null) as any,
    status: 'pending',
    requested_by: user.id,
    requested_at: new Date().toISOString(),
  })

  if (error) return { error: error.message }

  revalidatePath('/approvals')
  return {}
}

// ── approveRequest ─────────────────────────────────────────────────────────────

export async function approveRequest(
  id: string,
  resolution_note?: string
): Promise<{ error?: string }> {
  const user = await requireAuth()
  if (!['owner', 'manager'].includes(user.role)) {
    return { error: 'Only the owner or manager can approve requests' }
  }

  const admin = createAdminClient()

  // Fetch the pending request
  const { data: req, error: fetchErr } = await admin
    .from('approval_requests')
    .select('*')
    .eq('id', id)
    .eq('status', 'pending')
    .single()

  if (fetchErr || !req) return { error: 'Request not found or already resolved' }

  // Execute the action
  if (req.request_type === 'delete') {
    if (req.target_table === 'payment') {
      const { error: voidErr } = await admin
        .from('payments')
        .update({
          voided_at: new Date().toISOString(),
          voided_by: user.id,
          void_reason: req.reason,
        })
        .eq('id', req.target_id)
        .is('voided_at', null)

      if (voidErr) return { error: voidErr.message }

      revalidatePath('/payments')
    } else if (req.target_table === 'order') {
      const { error: voidErr } = await admin
        .from('orders')
        .update({
          order_status: 'voided',
          voided_at: new Date().toISOString(),
          voided_by: user.id,
          void_reason: req.reason,
        })
        .eq('id', req.target_id)
        .is('voided_at', null)

      if (voidErr) return { error: voidErr.message }

      revalidatePath('/orders')
    }
  } else if (req.request_type === 'edit' && req.target_table === 'invoice') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const changes = req.proposed_changes as any
    if (changes?.type === 'ala_carte_batch' && Array.isArray(changes.invoice_ids)) {
      const today = new Date().toISOString().slice(0, 10)
      const invoiceIds: string[] = changes.invoice_ids

      const { data: invoices } = await admin
        .from('invoices')
        .select('id, invoice_number, customer_id, total_amount, status')
        .in('id', invoiceIds)
        .eq('status', 'draft')

      for (const inv of invoices ?? []) {
        const { error: issueErr } = await admin
          .from('invoices')
          .update({ status: 'issued' })
          .eq('id', inv.id)
        if (issueErr) return { error: `Failed to issue invoice ${inv.invoice_number}: ${issueErr.message}` }

        const { error: ledgerErr } = await admin.from('ledger_entries').insert({
          customer_id:     inv.customer_id,
          entry_date:      today,
          entry_type:      'invoice',
          debit_amount:    parseFloat(String(inv.total_amount)).toFixed(2),
          credit_amount:   '0.00',
          description:     `Invoice ${inv.invoice_number}`,
          reference_table: 'invoices',
          reference_id:    inv.id,
          created_by:      user.id,
        })
        if (ledgerErr) {
          await admin.from('invoices').update({ status: 'draft' }).eq('id', inv.id)
          return { error: `Ledger entry failed for ${inv.invoice_number}: ${ledgerErr.message}` }
        }
      }

      revalidatePath('/invoices')
    }
  }

  // Mark the request as approved
  const { error: updateErr } = await admin
    .from('approval_requests')
    .update({
      status: 'approved',
      resolved_by: user.id,
      resolved_at: new Date().toISOString(),
      resolution_note: resolution_note?.trim() || null,
    })
    .eq('id', id)

  if (updateErr) return { error: updateErr.message }

  revalidatePath('/approvals')
  revalidatePath('/payments')
  revalidatePath('/orders')
  return {}
}

// ── rejectRequest ──────────────────────────────────────────────────────────────

export async function rejectRequest(
  id: string,
  resolution_note: string
): Promise<{ error?: string }> {
  const user = await requireAuth()
  if (!['owner', 'manager'].includes(user.role)) {
    return { error: 'Only the owner or manager can reject requests' }
  }

  if (!resolution_note?.trim()) {
    return { error: 'A reason is required when rejecting a request' }
  }

  const admin = createAdminClient()

  // For ala_carte_batch rejections, cancel the draft invoices
  const { data: reqData } = await admin
    .from('approval_requests')
    .select('proposed_changes, target_table, request_type')
    .eq('id', id)
    .eq('status', 'pending')
    .single()

  if (reqData?.request_type === 'edit' && reqData?.target_table === 'invoice') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const changes = reqData.proposed_changes as any
    if (changes?.type === 'ala_carte_batch' && Array.isArray(changes.invoice_ids)) {
      await admin
        .from('invoices')
        .update({ status: 'cancelled', notes: `Rejected: ${resolution_note.trim()}` })
        .in('id', changes.invoice_ids)
        .eq('status', 'draft')
      revalidatePath('/invoices')
    }
  }

  const { error } = await admin
    .from('approval_requests')
    .update({
      status: 'rejected',
      resolved_by: user.id,
      resolved_at: new Date().toISOString(),
      resolution_note: resolution_note.trim(),
    })
    .eq('id', id)
    .eq('status', 'pending')

  if (error) return { error: error.message }

  revalidatePath('/approvals')
  return {}
}
