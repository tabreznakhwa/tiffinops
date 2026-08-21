'use server'

// Server actions for the AI bill scanner (/scan-bill) and the Expenses ledger.
//
// scanReceipt: stores the uploaded photo in the private `receipts` bucket,
// has Claude read it (lib/scan/extract.ts), and fuzzy-matches the extracted
// vendor + line items against existing suppliers/inventory items. It writes
// NOTHING to purchases/expenses — posting only happens after the user reviews
// and confirms in the UI, via recordPurchase() or createExpense().

import { randomUUID } from 'crypto'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { formatInTimeZone } from 'date-fns-tz'
import { requireAuth } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Enums } from '@/lib/supabase/types'
import { extractReceipt, EXPENSE_CATEGORIES, type ScanFileType, type ScannedDoc } from '@/lib/scan/extract'
import { bestMatch, type MatchCandidate } from '@/lib/scan/match'

const SCAN_ROLES: Enums<'user_role'>[] = ['owner', 'manager', 'data_entry', 'accounts']
const EXPENSE_ROLES: Enums<'user_role'>[] = ['owner', 'manager', 'accounts']

const ALLOWED_TYPES: ScanFileType[] = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
const MAX_BYTES = 8 * 1024 * 1024

const BUCKET = 'receipts'

// ── Scan ─────────────────────────────────────────────────────────────────────

export type ScanLineWithMatch = ScannedDoc['line_items'][number] & {
  /** Best inventory item match, or null when nothing scored high enough. */
  match: MatchCandidate | null
}

export type ScanResult = {
  error?: string
  /** Set even on extraction failure so a retry can reuse the upload. */
  receiptPath?: string
  /** Signed URL (1h) for showing the uploaded document in the review UI. */
  receiptUrl?: string
  doc?: Omit<ScannedDoc, 'line_items'> & { line_items: ScanLineWithMatch[] }
  supplierMatch?: MatchCandidate | null
}

export async function scanReceipt(formData: FormData): Promise<ScanResult> {
  const user = await requireAuth()
  if (!SCAN_ROLES.includes(user.role)) return { error: 'Insufficient permissions' }

  const file = formData.get('file')
  if (!(file instanceof File)) return { error: 'No file uploaded' }
  const mediaType = file.type as ScanFileType
  if (!ALLOWED_TYPES.includes(mediaType)) {
    return { error: 'Upload a photo (JPG/PNG/WebP) or a PDF' }
  }
  if (file.size > MAX_BYTES) return { error: 'File is too large (max 8 MB)' }

  const admin = createAdminClient()
  const buffer = Buffer.from(await file.arrayBuffer())

  // Store the original first — even if the AI can't read it, the photo is kept
  // and the user can fall back to manual entry with it attached.
  const ext = mediaType === 'application/pdf' ? 'pdf' : mediaType.slice(6).replace('jpeg', 'jpg')
  const path = `${formatInTimeZone(new Date(), 'Asia/Dubai', 'yyyy-MM')}/${randomUUID()}.${ext}`
  const { error: uploadErr } = await admin.storage.from(BUCKET).upload(path, buffer, {
    contentType: mediaType,
    upsert: false,
  })
  if (uploadErr) {
    const missing = uploadErr.message.toLowerCase().includes('bucket')
    return {
      error: missing
        ? 'Storage bucket missing — run migrations/040_expenses_and_receipts.sql first.'
        : `Upload failed: ${uploadErr.message}`,
    }
  }

  const { data: signed } = await admin.storage.from(BUCKET).createSignedUrl(path, 3600)

  const todayDubai = formatInTimeZone(new Date(), 'Asia/Dubai', 'yyyy-MM-dd')
  const outcome = await extractReceipt(buffer.toString('base64'), mediaType, todayDubai)
  if (!outcome.ok) {
    return {
      error: `Could not read the bill: ${outcome.error}`,
      receiptPath: path,
      receiptUrl: signed?.signedUrl,
    }
  }

  // Fuzzy-match against existing masters so the review form comes pre-filled.
  const [{ data: suppliers }, { data: items }] = await Promise.all([
    admin.from('suppliers').select('id, name').eq('is_active', true),
    admin.from('inventory_items').select('id, name').eq('is_active', true),
  ])

  const doc = outcome.doc
  return {
    receiptPath: path,
    receiptUrl: signed?.signedUrl,
    supplierMatch: bestMatch(doc.vendor_name, suppliers ?? []),
    doc: {
      ...doc,
      line_items: doc.line_items.map(line => ({
        ...line,
        match: bestMatch(line.name, items ?? []),
      })),
    },
  }
}

// ── Inline master-data creation from the review screen ───────────────────────
// Mirrors createSupplier/createInventoryItem in lib/inventory/actions.ts but
// returns the new row's id so the review form can select it immediately.

const MASTER_ROLES: Enums<'user_role'>[] = ['owner', 'manager']

export async function quickCreateSupplier(input: {
  name: string
  phone?: string
  /** UAE VAT Tax Registration Number, often the only printed ID on a bill. */
  trn?: string
}): Promise<{ id?: string; error?: string }> {
  const user = await requireAuth()
  if (!MASTER_ROLES.includes(user.role)) return { error: 'Only owner/manager can add suppliers' }
  const clean = input.name.trim()
  if (!clean) return { error: 'Supplier name is required' }

  const admin = createAdminClient()
  const { data: code, error: codeErr } = await admin.rpc('next_supplier_code')
  if (codeErr || !code) return { error: 'Could not generate supplier code' }

  const { data, error } = await admin
    .from('suppliers')
    .insert({
      name: clean,
      supplier_code: code,
      phone: input.phone?.trim() || null,
      trn: input.trn?.trim() || null,
      created_by: user.id,
    })
    .select('id')
    .single()
  if (error || !data) return { error: error?.message ?? 'Could not create supplier' }

  revalidatePath('/inventory/suppliers')
  return { id: data.id }
}

export async function quickCreateItem(input: {
  name: string
  unit_of_measure: string
  category?: string | null
  purchase_price?: number
}): Promise<{ id?: string; error?: string }> {
  const user = await requireAuth()
  if (!MASTER_ROLES.includes(user.role)) return { error: 'Only owner/manager can add inventory items' }
  const name = input.name.trim()
  const unit = input.unit_of_measure.trim() || 'pcs'
  if (!name) return { error: 'Item name is required' }

  const admin = createAdminClient()
  const { data: code, error: codeErr } = await admin.rpc('next_inventory_item_code')
  if (codeErr || !code) return { error: 'Could not generate item code' }

  const { data, error } = await admin
    .from('inventory_items')
    .insert({
      name,
      item_code: code,
      unit_of_measure: unit,
      category: input.category?.trim() || null,
      purchase_price: (input.purchase_price ?? 0).toFixed(2),
      created_by: user.id,
    })
    .select('id')
    .single()
  if (error || !data) {
    if (error?.message.includes('idx_inventory_items_name')) {
      return { error: 'An item with this name already exists' }
    }
    return { error: error?.message ?? 'Could not create item' }
  }

  revalidatePath('/inventory')
  return { id: data.id }
}

// ── Expenses ─────────────────────────────────────────────────────────────────

export type ExpenseActionResult = { error?: string; expense_number?: string }

const CreateExpenseSchema = z.object({
  expense_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date'),
  category: z.enum(EXPENSE_CATEGORIES),
  vendor_name: z.string().trim().optional().transform(v => v || null),
  description: z.string().trim().optional().transform(v => v || null),
  amount: z.coerce
    .number({ message: 'Enter a valid amount' })
    .positive('Amount must be greater than 0'),
  payment_method: z.enum(['cash', 'card', 'bank_transfer', 'cheque', 'online', 'wallet', 'other']).nullable().optional(),
  receipt_path: z.string().nullable().optional(),
  notes: z.string().trim().optional().transform(v => v || null),
})

export async function createExpense(input: {
  expense_date: string
  category: string
  vendor_name?: string
  description?: string
  amount: number
  payment_method?: Enums<'payment_mode'> | null
  receipt_path?: string | null
  notes?: string
}): Promise<ExpenseActionResult> {
  const user = await requireAuth()
  if (!EXPENSE_ROLES.includes(user.role)) return { error: 'Insufficient permissions' }

  const parsed = CreateExpenseSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  const admin = createAdminClient()
  const { data: number, error: numErr } = await (admin as unknown as {
    rpc: (fn: string) => PromiseLike<{ data: string | null; error: { message: string } | null }>
  }).rpc('next_expense_number')
  if (numErr || !number) {
    return { error: 'Could not generate expense number — run migrations/040_expenses_and_receipts.sql first.' }
  }

  const { error } = await admin.from('expenses').insert({
    expense_number: number,
    expense_date: parsed.data.expense_date,
    category: parsed.data.category,
    vendor_name: parsed.data.vendor_name,
    description: parsed.data.description,
    amount: parsed.data.amount.toFixed(2),
    payment_method: parsed.data.payment_method ?? null,
    receipt_path: parsed.data.receipt_path ?? null,
    notes: parsed.data.notes,
    created_by: user.id,
  })
  if (error) return { error: error.message }

  revalidatePath('/expenses')
  return { expense_number: number }
}

export async function deleteExpense(id: string): Promise<ExpenseActionResult> {
  const user = await requireAuth()
  if (user.role !== 'owner') return { error: 'Only the owner can delete an expense' }

  const admin = createAdminClient()
  const { error } = await admin.from('expenses').delete().eq('id', id)
  if (error) return { error: error.message }

  revalidatePath('/expenses')
  return {}
}

// ── Receipt viewing ──────────────────────────────────────────────────────────

/** Short-lived signed URL for a stored receipt — any active user can view. */
export async function getReceiptUrl(path: string): Promise<{ url?: string; error?: string }> {
  await requireAuth()
  if (!path || path.includes('..')) return { error: 'Invalid path' }

  const admin = createAdminClient()
  const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(path, 3600)
  if (error || !data) return { error: error?.message ?? 'Could not create link' }
  return { url: data.signedUrl }
}
