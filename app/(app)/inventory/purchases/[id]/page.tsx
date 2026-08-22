export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { requireAuth } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { PurchaseEditForm } from '@/components/inventory/purchase-edit-form'
import type { PurchaseHeader, PurchaseLine } from '@/components/inventory/purchase-edit-form'

export default async function PurchaseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const user = await requireAuth()
  const { id } = await params
  const admin = createAdminClient()

  const { data: purchase } = await admin
    .from('purchases')
    .select(`
      id,
      purchase_number,
      purchase_date,
      supplier_id,
      payment_status,
      payment_method,
      vat_amount,
      total_amount,
      notes,
      receipt_path,
      supplier_invoice_no,
      voided_at,
      void_reason,
      voided_by,
      edited_at,
      edit_reason,
      edited_by,
      suppliers ( name ),
      purchase_items ( inventory_item_id, quantity, unit_price, pack_qty, pack_size, pack_unit )
    `)
    .eq('id', id)
    .maybeSingle()
  if (!purchase) notFound()

  const actorIds = [purchase.voided_by, purchase.edited_by].filter((v): v is string => !!v)
  const [{ data: suppliers }, { data: items }, { data: actors }] = await Promise.all([
    admin.from('suppliers').select('*').eq('is_active', true).order('name'),
    admin.from('inventory_items').select('*').eq('is_active', true).order('name'),
    actorIds.length
      ? admin.from('users').select('id, full_name').in('id', actorIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
  ])
  const nameById = new Map((actors ?? []).map(a => [a.id, a.full_name]))

  const supplierJoin = purchase.suppliers as unknown as { name: string } | null

  const header: PurchaseHeader = {
    id: purchase.id,
    purchase_number: purchase.purchase_number,
    purchase_date: purchase.purchase_date,
    supplier_id: purchase.supplier_id,
    payment_status: purchase.payment_status,
    payment_method: purchase.payment_method,
    vat_amount: purchase.vat_amount,
    total_amount: purchase.total_amount,
    notes: purchase.notes,
    receipt_path: purchase.receipt_path,
    supplier_invoice_no: purchase.supplier_invoice_no,
    voided_at: purchase.voided_at,
    void_reason: purchase.void_reason,
    voided_by_name: purchase.voided_by ? nameById.get(purchase.voided_by) ?? null : null,
    edited_at: purchase.edited_at,
    edit_reason: purchase.edit_reason,
    edited_by_name: purchase.edited_by ? nameById.get(purchase.edited_by) ?? null : null,
    supplier_name: supplierJoin?.name ?? null,
  }

  const lines: PurchaseLine[] = (purchase.purchase_items ?? []).map(l => ({
    inventory_item_id: l.inventory_item_id,
    quantity: l.quantity,
    unit_price: l.unit_price,
    pack_qty: l.pack_qty,
    pack_size: l.pack_size,
    pack_unit: l.pack_unit,
  }))

  const isOwner = user.role === 'owner'

  return (
    <div>
      <Link
        href="/inventory/purchases"
        className="inline-flex items-center gap-1.5 text-sm font-semibold mb-5 transition-opacity hover:opacity-70"
        style={{ color: 'var(--color-muted)' }}
      >
        <ArrowLeft size={15} />
        Purchases
      </Link>

      <div className="mb-5">
        <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--color-saffron)', letterSpacing: '.12em' }}>
          {purchase.voided_at ? 'Voided Purchase' : isOwner ? 'Edit Purchase' : 'Purchase'}
        </p>
        <h1 className="font-display font-bold text-[25px] mt-0.5" style={{ color: 'var(--color-ink)' }}>
          {purchase.purchase_number}
        </h1>
      </div>

      <PurchaseEditForm
        purchase={header}
        purchaseLines={lines}
        suppliers={suppliers ?? []}
        items={items ?? []}
        isOwner={isOwner}
      />
    </div>
  )
}
