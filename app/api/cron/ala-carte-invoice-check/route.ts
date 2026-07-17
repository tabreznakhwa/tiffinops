import { NextRequest, NextResponse } from 'next/server'
import { formatInTimeZone } from 'date-fns-tz'
import { createAdminClient } from '@/lib/supabase/admin'
import { generateAlaCarteInvoices } from '@/lib/invoices/generateAlaCarteInvoices'

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return req.headers.get('authorization') === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin   = createAdminClient()
  const DUBAI   = 'Asia/Dubai'
  const today   = formatInTimeZone(new Date(), DUBAI, 'yyyy-MM-dd')
  const month   = formatInTimeZone(new Date(), DUBAI, 'yyyy-MM')

  // 1. Verify dinner orders have been posted today
  const { count: dinnerCount } = await admin
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('order_date', today)
    .eq('meal_period', 'dinner')
    .eq('is_credit', true)
    .not('order_status', 'in', '(cancelled,voided,draft)')

  if (!dinnerCount || dinnerCount === 0) {
    return NextResponse.json({
      ok: false,
      reason: `Dinner orders for ${today} not yet posted — skipping invoice generation`,
    })
  }

  // 2. Idempotency: skip if approval request already created for this month
  const { count: existingRequest } = await admin
    .from('approval_requests')
    .select('id', { count: 'exact', head: true })
    .eq('target_table', 'invoice')
    .eq('request_type', 'edit')
    .like('reason', `%${month}%`)

  if (existingRequest && existingRequest > 0) {
    return NextResponse.json({
      ok: false,
      reason: `Approval request for ${month} already exists`,
    })
  }

  // 3. Look up the owner's user ID to stamp on the approval request
  const { data: ownerUser } = await admin
    .from('users')
    .select('id')
    .eq('role', 'owner')
    .eq('status', 'active')
    .limit(1)
    .single()

  if (!ownerUser?.id) {
    return NextResponse.json({ ok: false, error: 'No active owner found in users table' })
  }

  // 4. Generate draft invoices
  const result = await generateAlaCarteInvoices(month, 'system-cron')

  if (result.generated === 0 && result.errors.length === 0) {
    return NextResponse.json({
      ok: true,
      reason: 'No uninvoiced A La Carte orders found for this period',
      ...result,
    })
  }

  if (result.generated === 0) {
    return NextResponse.json({ ok: false, errors: result.errors, month })
  }

  // 5. Create one approval request for the batch
  const { data: settings } = await admin.from('app_settings').select('currency').eq('id', 1).single()
  const currency = settings?.currency ?? 'AED'

  const reason = `Auto: A La Carte cycle invoices for ${month} — ${result.generated} customers, ${currency} ${result.total_amount.toFixed(2)} total. Approve to issue all.`

  const { error: approvalErr } = await admin.from('approval_requests').insert({
    request_type:     'edit',
    target_table:     'invoice',
    target_id:        result.invoice_ids[0], // first invoice UUID as anchor
    reason,
    proposed_changes: {
      type:           'ala_carte_batch',
      invoice_ids:    result.invoice_ids,
      month,
      customer_count: result.generated,
      total_amount:   result.total_amount,
      currency,
    },
    status:           'pending',
    requested_by:     ownerUser.id,
    requested_at:     new Date().toISOString(),
  })

  if (approvalErr) {
    return NextResponse.json({ ok: false, error: approvalErr.message, ...result })
  }

  return NextResponse.json({ ok: true, message: 'Draft invoices created and approval request sent', ...result })
}

export { GET as POST }
