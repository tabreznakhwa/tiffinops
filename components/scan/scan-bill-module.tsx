'use client'

// AI bill scanner — capture → Claude reads → review & correct → confirm.
// Nothing posts until the user hits the confirm button: purchases go through
// recordPurchase() (stock + transactions), expenses through createExpense().

import { useMemo, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { Camera, Check, FileText, Loader2, Plus, ScanLine, Sparkles, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAppSettings } from '@/components/settings/settings-context'
import { recordPurchase } from '@/lib/inventory/actions'
import {
  scanReceipt, createExpense, quickCreateSupplier, quickCreateItem,
  type ScanResult,
} from '@/lib/scan/actions'
import { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_LABELS, type ExpenseCategory } from '@/lib/scan/categories'
import { bestMatch } from '@/lib/scan/match'
import type { Enums } from '@/lib/supabase/types'

type PaymentMode = Enums<'payment_mode'>

export type ScanSupplier = { id: string; name: string; supplier_code: string; phone: string | null }
export type ScanItem = { id: string; name: string; unit_of_measure: string; category: string | null; purchase_price: string }

const inputBase =
  'w-full rounded-[11px] px-3 py-2.5 text-sm bg-surface text-ink focus:outline-none focus:ring-1 focus:ring-saffron'
const inputStyle = { border: '1px solid var(--color-border)' } as const
const card = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  boxShadow: 'var(--shadow-card)',
} as const

const PAYMENT_METHODS: { value: PaymentMode; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'online', label: 'Online' },
  { value: 'wallet', label: 'Wallet' },
  { value: 'other', label: 'Other' },
]

const CATEGORY_LABELS = EXPENSE_CATEGORY_LABELS

// ── Client-side image compression ────────────────────────────────────────────
// Phone photos are 3–8 MB; the AI needs nowhere near that. Resize to max
// 1800px and re-encode as JPEG before upload. PDFs pass through untouched.

async function compressImage(file: File): Promise<Blob> {
  if (file.type === 'application/pdf') return file
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height))
  const w = Math.round(bitmap.width * scale)
  const h = Math.round(bitmap.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return file
  ctx.drawImage(bitmap, 0, 0, w, h)
  return new Promise<Blob>(resolve =>
    canvas.toBlob(b => resolve(b ?? file), 'image/jpeg', 0.82),
  )
}

// ── Review line state ────────────────────────────────────────────────────────

const UNIT_OPTIONS = ['kg', 'g', 'l', 'ml', 'pcs', 'box', 'packet', 'dozen'] as const

type ReviewLine = {
  key: number
  /** Raw text read off the bill — kept visible so the user can verify. */
  billText: string
  billUnit: string | null
  /** Unit for a NEW item created from this line — editable when the bill is unclear. */
  unit: string
  itemId: string          // '' = unmatched
  matchScore: number | null
  quantity: string
  unitPrice: string
  creating: boolean       // inline "create item" open
  /** True for rows the user added by hand (nothing readable on the bill). */
  manual: boolean
}

export function ScanBillModule({
  suppliers: initialSuppliers,
  items: initialItems,
  todayDubai,
  canCreateMasters,
  canRecordPurchase,
  canRecordExpense,
}: {
  suppliers: ScanSupplier[]
  items: ScanItem[]
  todayDubai: string
  canCreateMasters: boolean
  canRecordPurchase: boolean
  canRecordExpense: boolean
}) {
  const { currency } = useAppSettings()
  const fileRef = useRef<HTMLInputElement>(null)

  const [step, setStep] = useState<'capture' | 'reading' | 'review' | 'done'>('capture')
  const [error, setError] = useState<string | null>(null)
  const [scan, setScan] = useState<ScanResult | null>(null)
  const [isPending, startTransition] = useTransition()

  // Masters can grow via inline create without a page reload
  const [suppliers, setSuppliers] = useState(initialSuppliers)
  const [items, setItems] = useState(initialItems)

  // Review form state
  const [docType, setDocType] = useState<'purchase' | 'expense'>('purchase')
  const [supplierId, setSupplierId] = useState('')
  const [creatingSupplier, setCreatingSupplier] = useState(false)
  const [showNewSupplier, setShowNewSupplier] = useState(false)
  const [vendorPhone, setVendorPhone] = useState('')
  const [vendorTrn, setVendorTrn] = useState('')
  const [docDate, setDocDate] = useState(todayDubai)
  const [lines, setLines] = useState<ReviewLine[]>([])
  const [paymentStatus, setPaymentStatus] = useState<'unpaid' | 'partial' | 'paid'>('unpaid')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMode | ''>('')
  const [vendorName, setVendorName] = useState('')
  const [category, setCategory] = useState<ExpenseCategory>('other')
  const [amount, setAmount] = useState('')
  const [vatAmount, setVatAmount] = useState('')
  const [description, setDescription] = useState('')
  const [doneMessage, setDoneMessage] = useState('')

  const itemById = useMemo(() => new Map(items.map(i => [i.id, i])), [items])

  // ── Step 1: capture ────────────────────────────────────────────────────────

  function handleFile(file: File | undefined) {
    if (!file) return
    setError(null)
    setStep('reading')
    startTransition(async () => {
      try {
        const blob = await compressImage(file)
        if (blob.size > 8 * 1024 * 1024) {
          setError('File is too large (max 8 MB)')
          setStep('capture')
          return
        }
        const fd = new FormData()
        const name = blob.type === 'application/pdf' ? 'bill.pdf' : 'bill.jpg'
        fd.append('file', new File([blob], name, { type: blob.type || 'image/jpeg' }))

        const result = await scanReceipt(fd)
        if (result.error || !result.doc) {
          setError(result.error ?? 'Could not read the bill')
          setScan(result)
          setStep('capture')
          return
        }
        seedReview(result)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Something went wrong reading the file')
        setStep('capture')
      }
    })
  }

  function seedReview(result: ScanResult) {
    const doc = result.doc!
    setScan(result)
    const wantsPurchase = doc.doc_type === 'purchase'
    setDocType(wantsPurchase && !canRecordPurchase ? 'expense' : !wantsPurchase && !canRecordExpense ? 'purchase' : doc.doc_type)
    setSupplierId(result.supplierMatch?.id ?? '')
    setVendorName(doc.vendor_name ?? '')
    setVendorTrn(doc.vendor_trn ?? '')
    setVendorPhone('')
    setShowNewSupplier(false)
    setDocDate(doc.doc_date ?? todayDubai)
    setCategory(doc.suggested_category)
    setAmount(doc.total != null ? doc.total.toFixed(2) : '')
    // VAT: what the bill printed, else derive from subtotal/total when both exist.
    const vat =
      doc.vat_amount != null && doc.vat_amount > 0 ? doc.vat_amount
      : doc.subtotal != null && doc.total != null && doc.total > doc.subtotal ? doc.total - doc.subtotal
      : null
    setVatAmount(vat != null ? vat.toFixed(2) : '')
    setDescription(doc.line_items.length ? doc.line_items.map(l => l.name).join(', ') : '')
    setPaymentStatus(doc.paid ? 'paid' : 'unpaid')
    setPaymentMethod(doc.payment_method_hint ?? '')
    setLines(
      doc.line_items.map((l, i) => {
        const matched = l.match ? itemById.get(l.match.id) : undefined
        return {
          key: i,
          billText: l.name + (l.unit ? ` (${l.unit})` : ''),
          billUnit: l.unit,
          unit: l.unit ?? 'kg',
          itemId: matched?.id ?? '',
          matchScore: l.match?.score ?? null,
          quantity: l.quantity != null ? String(l.quantity) : '',
          unitPrice:
            l.unit_price != null ? l.unit_price.toFixed(2)
            : l.line_total != null && l.quantity ? (l.line_total / l.quantity).toFixed(2)
            : '',
          creating: false,
          manual: false,
        }
      }),
    )
    setStep('review')
  }

  function resetAll() {
    setStep('capture')
    setError(null)
    setScan(null)
    setLines([])
    setSupplierId('')
    setCreatingSupplier(false)
    setDoneMessage('')
    if (fileRef.current) fileRef.current.value = ''
  }

  // ── Inline creates ─────────────────────────────────────────────────────────

  function handleCreateSupplier() {
    if (!vendorName.trim()) { setError('Type the supplier name first — handwritten bills often leave it out'); return }
    setCreatingSupplier(true)
    startTransition(async () => {
      const res = await quickCreateSupplier({ name: vendorName, phone: vendorPhone, trn: vendorTrn })
      setCreatingSupplier(false)
      if (res.error || !res.id) { setError(res.error ?? 'Could not create supplier'); return }
      setSuppliers(prev => [...prev, { id: res.id!, name: vendorName.trim(), supplier_code: 'new', phone: vendorPhone.trim() || null }])
      setSupplierId(res.id)
      setShowNewSupplier(false)
      setError(null)
    })
  }

  function handleCreateItem(line: ReviewLine) {
    startTransition(async () => {
      const cleanName = line.billText.replace(/\s*\([^)]*\)\s*$/, '').trim()
      if (!cleanName) { setError('Type the item name first') ; return }
      const res = await quickCreateItem({
        name: cleanName,
        unit_of_measure: line.unit || 'pcs',
        purchase_price: parseFloat(line.unitPrice) || 0,
      })
      if (res.error || !res.id) { setError(res.error ?? 'Could not create item'); return }
      // create-or-get can return an item already in the list — don't duplicate
      setItems(prev => prev.some(i => i.id === res.id)
        ? prev
        : [...prev, {
            id: res.id!, name: cleanName, unit_of_measure: line.unit || 'pcs',
            category: null, purchase_price: line.unitPrice || '0',
          }])
      setLines(prev => prev.map(l => (l.key === line.key ? { ...l, itemId: res.id!, matchScore: null } : l)))
      setError(null)
    })
  }

  /** Blank row for lines the AI could not read off a handwritten bill. */
  function addManualLine() {
    setLines(prev => [...prev, {
      key: (prev.length ? Math.max(...prev.map(l => l.key)) : 0) + 1,
      billText: '',
      billUnit: null,
      unit: 'kg',
      itemId: '',
      matchScore: null,
      quantity: '',
      unitPrice: '',
      creating: false,
      manual: true,
    }])
  }

  // ── Confirm ────────────────────────────────────────────────────────────────

  const usableLines = lines.filter(l => l.itemId)
  // Typed amounts count toward the total immediately — matching only controls
  // stock posting. A line with money on it must be matched (or deleted) before
  // confirm, so the total shown is always exactly what gets posted.
  const lineAmount = (l: ReviewLine) => (parseFloat(l.quantity) || 0) * (parseFloat(l.unitPrice) || 0)
  const subtotal = lines.reduce((s, l) => s + lineAmount(l), 0)
  const unmatchedWithAmount = lines.filter(l => !l.itemId && lineAmount(l) > 0)
  const vatNum = parseFloat(vatAmount) || 0
  const grandTotal = subtotal + vatNum
  const billTotal = scan?.doc?.total ?? null
  const totalMismatch = billTotal != null && subtotal > 0 && Math.abs(grandTotal - billTotal) > 0.05

  function handleConfirm() {
    setError(null)
    startTransition(async () => {
      if (docType === 'purchase') {
        if (!supplierId) { setError('Select or create the supplier'); return }
        if (usableLines.length === 0) { setError('Match at least one line to an inventory item'); return }
        if (unmatchedWithAmount.length > 0) {
          setError(`${unmatchedWithAmount.length} line${unmatchedWithAmount.length > 1 ? 's have' : ' has'} an amount but no inventory item — pick or create the item, or delete the line`)
          return
        }
        for (const l of usableLines) {
          if (!(parseFloat(l.quantity) > 0) || isNaN(parseFloat(l.unitPrice))) {
            setError('Every matched line needs a positive quantity and a valid price')
            return
          }
        }
        const res = await recordPurchase({
          supplier_id: supplierId,
          purchase_date: docDate,
          payment_status: paymentStatus,
          payment_method: paymentMethod || null,
          notes: 'Recorded via AI bill scan',
          receipt_path: scan?.receiptPath ?? null,
          vat_amount: vatNum > 0 ? vatNum : null,
          items: usableLines.map(l => ({
            inventory_item_id: l.itemId,
            quantity: parseFloat(l.quantity),
            unit_price: parseFloat(l.unitPrice),
          })),
        })
        if (res?.error) { setError(res.error); return }
        setDoneMessage(`Purchase recorded · ${currency} ${grandTotal.toFixed(2)}${vatNum > 0 ? ` (incl. VAT ${currency} ${vatNum.toFixed(2)})` : ''} · stock updated`)
      } else {
        const amt = parseFloat(amount)
        if (!(amt > 0)) { setError('Enter the expense amount'); return }
        const res = await createExpense({
          expense_date: docDate,
          category,
          vendor_name: vendorName || undefined,
          description: description || undefined,
          amount: amt,
          vat_amount: vatNum > 0 ? vatNum : null,
          payment_method: paymentMethod || null,
          receipt_path: scan?.receiptPath ?? null,
        })
        if (res?.error) { setError(res.error); return }
        setDoneMessage(`${res.expense_number ?? 'Expense'} recorded · ${currency} ${amt.toFixed(2)}`)
      }
      setStep('done')
    })
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div>
        <h1 className="font-display font-bold text-[22px]" style={{ color: 'var(--color-ink)' }}>Scan Bill</h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--color-muted)' }}>
          Photograph a purchase bill or expense receipt — AI reads it, you review, one tap posts it.
        </p>
      </div>

      {step === 'capture' && (
        <div className="rounded-[14px] p-6" style={card}>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            capture="environment"
            className="hidden"
            onChange={e => handleFile(e.target.files?.[0])}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="w-full rounded-[14px] py-12 flex flex-col items-center gap-3 transition-colors hover:bg-cream"
            style={{ border: '2px dashed var(--color-border)' }}
          >
            <div className="h-14 w-14 rounded-full flex items-center justify-center" style={{ background: 'var(--color-saffron-soft, var(--color-cream))' }}>
              <Camera size={26} style={{ color: 'var(--color-saffron)' }} />
            </div>
            <div className="text-center">
              <p className="font-bold text-sm" style={{ color: 'var(--color-ink)' }}>Take a photo or upload</p>
              <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>JPG, PNG or PDF · supplier bills, fuel receipts, utility bills…</p>
            </div>
          </button>
          {error && (
            <div className="mt-4 rounded-[11px] p-3 text-sm font-semibold" style={{ background: 'var(--color-red-soft, #fdecec)', color: 'var(--color-red)' }}>
              {error}
              {scan?.receiptPath && (
                <p className="font-normal mt-1 text-xs" style={{ color: 'var(--color-muted)' }}>
                  The photo was saved — you can also enter it manually in{' '}
                  <Link href="/inventory/purchases/new" className="underline font-semibold">Purchases</Link>.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {step === 'reading' && (
        <div className="rounded-[14px] p-10 flex flex-col items-center gap-3" style={card}>
          <Loader2 size={28} className="animate-spin" style={{ color: 'var(--color-saffron)' }} />
          <p className="font-bold text-sm" style={{ color: 'var(--color-ink)' }}>Reading the bill…</p>
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>AI is extracting vendor, items and totals</p>
        </div>
      )}

      {step === 'review' && scan?.doc && (
        <div className="space-y-4">
          {/* Receipt preview + AI note */}
          <div className="rounded-[14px] overflow-hidden" style={card}>
            {scan.receiptUrl && scan.doc && (
              scan.receiptPath?.endsWith('.pdf') ? (
                <a href={scan.receiptUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2 px-4 py-3 text-sm font-semibold" style={{ color: 'var(--color-saffron)' }}>
                  <FileText size={16} /> View uploaded PDF
                </a>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={scan.receiptUrl} alt="Scanned bill" className="w-full max-h-72 object-contain" style={{ background: 'var(--color-cream)' }} />
              )
            )}
            <div className="px-4 py-3 flex items-start gap-2" style={{ borderTop: '1px solid var(--color-border)' }}>
              <Sparkles size={14} className="mt-0.5 flex-shrink-0" style={{ color: 'var(--color-saffron)' }} />
              <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                AI read this as a <b>{scan.doc.doc_type === 'purchase' ? 'stock purchase' : 'business expense'}</b>
                {scan.doc.vendor_name ? <> from <b>{scan.doc.vendor_name}</b></> : null}
                {billTotal != null ? <> · total <b className="num">{currency} {billTotal.toFixed(2)}</b></> : null}
                {scan.doc.confidence === 'low' ? ' · ⚠ low confidence — check everything below' : ''}
                {scan.doc.notes ? <> · {scan.doc.notes}</> : null}
              </p>
            </div>
          </div>

          {/* Doc type toggle */}
          <div className="rounded-[14px] p-4" style={card}>
            <p className="text-[11px] font-bold uppercase tracking-wide mb-2" style={{ color: 'var(--color-muted)' }}>Record as</p>
            <div className="flex gap-1.5">
              {([
                { value: 'purchase' as const, label: 'Stock Purchase', enabled: canRecordPurchase },
                { value: 'expense' as const, label: 'Expense', enabled: canRecordExpense },
              ]).map(t => (
                <button
                  key={t.value}
                  type="button"
                  disabled={!t.enabled}
                  onClick={() => setDocType(t.value)}
                  className="px-3.5 py-1.5 rounded-pill text-sm font-semibold transition-colors disabled:opacity-40"
                  style={{
                    background: docType === t.value ? 'var(--color-ink)' : 'var(--color-cream)',
                    color: docType === t.value ? 'var(--color-cream)' : 'var(--color-muted)',
                    border: '1px solid',
                    borderColor: docType === t.value ? 'var(--color-ink)' : 'var(--color-border)',
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>
            {docType === 'purchase' && (
              <p className="text-[11px] mt-2" style={{ color: 'var(--color-muted)' }}>
                Updates inventory stock and the purchases register.
              </p>
            )}
          </div>

          {/* Date + vendor */}
          <div className="rounded-[14px] p-4 grid sm:grid-cols-2 gap-3" style={card}>
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wide mb-2" style={{ color: 'var(--color-muted)' }}>Bill Date</label>
              <input type="date" value={docDate} onChange={e => setDocDate(e.target.value)} className={inputBase} style={inputStyle} />
            </div>
            {docType === 'purchase' ? (
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wide mb-2" style={{ color: 'var(--color-muted)' }}>Supplier</label>
                <select value={supplierId} onChange={e => setSupplierId(e.target.value)} className={inputBase} style={inputStyle}>
                  <option value="">— select supplier —</option>
                  {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                {!supplierId && canCreateMasters && !showNewSupplier && (
                  <button
                    type="button"
                    onClick={() => setShowNewSupplier(true)}
                    className="mt-2 flex items-center gap-1 text-xs font-bold"
                    style={{ color: 'var(--color-saffron)' }}
                  >
                    <Plus size={12} /> New supplier{vendorName ? <> &ldquo;{vendorName}&rdquo;</> : ' (no name on bill)'}
                  </button>
                )}
              </div>
            ) : (
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wide mb-2" style={{ color: 'var(--color-muted)' }}>Vendor</label>
                <input value={vendorName} onChange={e => setVendorName(e.target.value)} placeholder="e.g. ENOC, DEWA…" className={inputBase} style={inputStyle} />
              </div>
            )}

            {/* Inline new-supplier form — handwritten bills often have no vendor
                name or TRN printed, so everything here is typeable. */}
            {docType === 'purchase' && showNewSupplier && canCreateMasters && (
              <div className="sm:col-span-2 rounded-[11px] p-3 space-y-2.5" style={{ background: 'var(--color-cream)', border: '1px solid var(--color-border)' }}>
                <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>New Supplier</p>
                <div>
                  <label className="block text-[10.5px] font-semibold mb-1" style={{ color: 'var(--color-muted)' }}>Name *</label>
                  <input value={vendorName} onChange={e => setVendorName(e.target.value)} placeholder="Type the supplier's name" className={inputBase} style={inputStyle} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10.5px] font-semibold mb-1" style={{ color: 'var(--color-muted)' }}>Phone</label>
                    <input value={vendorPhone} onChange={e => setVendorPhone(e.target.value)} placeholder="05x…" inputMode="tel" className={inputBase} style={inputStyle} />
                  </div>
                  <div>
                    <label className="block text-[10.5px] font-semibold mb-1" style={{ color: 'var(--color-muted)' }}>TRN</label>
                    <input value={vendorTrn} onChange={e => setVendorTrn(e.target.value)} placeholder="1003…" inputMode="numeric" className={inputBase} style={inputStyle} />
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setShowNewSupplier(false)} disabled={creatingSupplier}>Cancel</Button>
                  <Button variant="secondary" size="sm" onClick={handleCreateSupplier} disabled={creatingSupplier || isPending} className="flex-1">
                    {creatingSupplier ? 'Creating…' : 'Create Supplier'}
                  </Button>
                </div>
              </div>
            )}
          </div>

          {docType === 'purchase' ? (
            <>
              {/* Extracted lines */}
              <div className="rounded-[14px] p-4 space-y-3" style={card}>
                <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>
                  Bill Lines ({lines.length})
                </p>
                {lines.length === 0 && (
                  <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
                    No line items could be read from this bill — add them by hand below.
                  </p>
                )}
                {lines.map(line => {
                  const matched = line.itemId ? itemById.get(line.itemId) : undefined
                  const lineTotal = (parseFloat(line.quantity) || 0) * (parseFloat(line.unitPrice) || 0)
                  return (
                    <div
                      key={line.key}
                      className="rounded-[11px] p-3"
                      style={{ background: line.itemId ? 'var(--color-cream)' : 'var(--color-saffron-soft, #fdf3e0)', border: line.itemId ? undefined : '1px solid var(--color-saffron)' }}
                    >
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="min-w-0 flex-1">
                          {line.manual ? (
                            <input
                              value={line.billText}
                              onChange={e => {
                                const text = e.target.value
                                setLines(prev => prev.map(l => {
                                  if (l.key !== line.key) return l
                                  // Auto-match while typing, but never clobber a
                                  // selection the user picked from the dropdown
                                  // (those have matchScore === null).
                                  const wasAuto = l.matchScore != null
                                  const m = bestMatch(text, items)
                                  if (m && (wasAuto || !l.itemId)) return { ...l, billText: text, itemId: m.id, matchScore: m.score }
                                  if (!m && wasAuto) return { ...l, billText: text, itemId: '', matchScore: null }
                                  return { ...l, billText: text }
                                }))
                              }}
                              placeholder="Item name (e.g. Bhindi)"
                              className="w-full rounded-[8px] px-2.5 py-1.5 text-sm font-semibold focus:outline-none focus:ring-1 focus:ring-saffron"
                              style={{ border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-ink)' }}
                            />
                          ) : (
                            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>On bill: <span className="font-semibold" style={{ color: 'var(--color-ink)' }}>{line.billText}</span></p>
                          )}
                          {matched && line.matchScore != null && (
                            <p className="text-[10.5px] mt-0.5" style={{ color: 'var(--color-green)' }}>
                              ✓ matched to {matched.name} ({Math.round(line.matchScore * 100)}%)
                            </p>
                          )}
                        </div>
                        <button type="button" onClick={() => setLines(prev => prev.filter(l => l.key !== line.key))} aria-label="Remove line">
                          <Trash2 size={14} style={{ color: 'var(--color-red)' }} />
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-2 mb-2">
                        <div className="col-span-2">
                          <select
                            value={line.itemId}
                            onChange={e => setLines(prev => prev.map(l => (l.key === line.key ? { ...l, itemId: e.target.value, matchScore: null } : l)))}
                            className="w-full rounded-[8px] px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-saffron"
                            style={{ border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: line.itemId ? 'var(--color-ink)' : 'var(--color-muted)' }}
                          >
                            <option value="">— not matched: pick inventory item —</option>
                            {items.map(i => <option key={i.id} value={i.id}>{i.name} ({i.unit_of_measure})</option>)}
                          </select>
                          {!line.itemId && canCreateMasters && (
                            <button
                              type="button"
                              onClick={() => handleCreateItem(line)}
                              disabled={isPending}
                              className="mt-1.5 flex items-center gap-1 text-xs font-bold"
                              style={{ color: 'var(--color-saffron)' }}
                            >
                              <Plus size={12} /> Create item from this line
                            </button>
                          )}
                        </div>
                        {/* Unit is fixed by the inventory item once matched; until
                            then it's editable — bills often omit it. */}
                        {!line.itemId && (
                          <div>
                            <label className="block text-[10.5px] font-semibold mb-1" style={{ color: 'var(--color-muted)' }}>
                              Unit{line.billUnit ? '' : ' (not on bill)'}
                            </label>
                            <select
                              value={line.unit}
                              onChange={e => setLines(prev => prev.map(l => (l.key === line.key ? { ...l, unit: e.target.value } : l)))}
                              className="w-full rounded-[8px] px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-saffron"
                              style={{ border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-ink)' }}
                            >
                              {UNIT_OPTIONS.map(u => <option key={u} value={u}>{u}</option>)}
                              {!UNIT_OPTIONS.includes(line.unit as (typeof UNIT_OPTIONS)[number]) && (
                                <option value={line.unit}>{line.unit}</option>
                              )}
                            </select>
                          </div>
                        )}
                        <div>
                          <label className="block text-[10.5px] font-semibold mb-1" style={{ color: 'var(--color-muted)' }}>
                            Qty{matched ? ` (${matched.unit_of_measure})` : ` (${line.unit})`}
                          </label>
                          <input
                            type="number" min="0" step="0.001" value={line.quantity} placeholder="0"
                            onChange={e => setLines(prev => prev.map(l => (l.key === line.key ? { ...l, quantity: e.target.value } : l)))}
                            className="w-full rounded-[8px] px-2.5 py-1.5 text-sm num focus:outline-none focus:ring-1 focus:ring-saffron"
                            style={{ border: '1px solid var(--color-border)', background: 'var(--color-surface)' }}
                          />
                        </div>
                        <div>
                          <label className="block text-[10.5px] font-semibold mb-1" style={{ color: 'var(--color-muted)' }}>Unit Price ({currency})</label>
                          <input
                            type="number" min="0" step="0.01" value={line.unitPrice} placeholder="0.00"
                            onChange={e => setLines(prev => prev.map(l => (l.key === line.key ? { ...l, unitPrice: e.target.value } : l)))}
                            className="w-full rounded-[8px] px-2.5 py-1.5 text-sm num focus:outline-none focus:ring-1 focus:ring-saffron"
                            style={{ border: '1px solid var(--color-border)', background: 'var(--color-surface)' }}
                          />
                        </div>
                      </div>
                      {line.itemId && lineTotal > 0 && (
                        <p className="text-right text-xs font-bold num" style={{ color: 'var(--color-ember)' }}>{currency} {lineTotal.toFixed(2)}</p>
                      )}
                    </div>
                  )
                })}
                <button
                  type="button"
                  onClick={addManualLine}
                  className="w-full rounded-[11px] py-2.5 flex items-center justify-center gap-1.5 text-sm font-bold transition-colors hover:bg-cream"
                  style={{ border: '1.5px dashed var(--color-border)', color: 'var(--color-saffron)' }}
                >
                  <Plus size={14} /> Add line manually
                </button>
                {lines.length > 0 && (
                  <div className="space-y-1.5 pt-2" style={{ borderTop: '1px solid var(--color-border)' }}>
                    <div className="flex justify-between items-center">
                      <span className="text-sm font-semibold" style={{ color: 'var(--color-muted)' }}>
                        Subtotal ({usableLines.length} of {lines.length} lines matched)
                      </span>
                      <span className="num font-bold text-sm" style={{ color: 'var(--color-ink)' }}>{currency} {subtotal.toFixed(2)}</span>
                    </div>
                    {/* VAT — prefilled from the bill; the 5% button fills the UAE standard rate */}
                    <div className="flex justify-between items-center gap-2">
                      <span className="flex items-center gap-1.5 text-sm font-semibold" style={{ color: 'var(--color-muted)' }}>
                        VAT
                        <button
                          type="button"
                          onClick={() => setVatAmount((subtotal * 0.05).toFixed(2))}
                          title="Fill 5% of subtotal (UAE standard rate)"
                          className="px-1.5 py-0.5 rounded-[6px] text-[10px] font-bold"
                          style={{ background: 'var(--color-saffron-soft)', color: 'var(--color-saffron)', border: '1px solid var(--color-saffron)' }}
                        >
                          5%
                        </button>
                      </span>
                      <input
                        type="number" min="0" step="0.01"
                        value={vatAmount}
                        onChange={e => setVatAmount(e.target.value)}
                        placeholder="0.00"
                        className="num w-[110px] rounded-[9px] px-2.5 py-1.5 text-sm text-right focus:outline-none focus:ring-1 focus:ring-saffron"
                        style={{ border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-ink)' }}
                      />
                    </div>
                    <div className="flex justify-between pt-1.5" style={{ borderTop: '1px solid var(--color-border)' }}>
                      <span className="font-bold text-sm" style={{ color: 'var(--color-ink)' }}>Total{vatNum > 0 ? ' (incl. VAT)' : ''}</span>
                      <span className="num font-extrabold text-[17px]" style={{ color: 'var(--color-ink)' }}>{currency} {grandTotal.toFixed(2)}</span>
                    </div>
                  </div>
                )}
                {unmatchedWithAmount.length > 0 && (
                  <p className="text-xs font-semibold rounded-[9px] px-3 py-2" style={{ background: 'var(--color-saffron-soft, #fdf3e0)', color: 'var(--color-ember)' }}>
                    ⚠ {unmatchedWithAmount.length === 1
                      ? `"${unmatchedWithAmount[0].billText.trim() || 'One line'}" has an amount but no inventory item`
                      : `${unmatchedWithAmount.length} lines have amounts but no inventory item`}
                    {' '}— tap “Create item from this line” or pick an item, so the stock gets updated too.
                  </p>
                )}
                {totalMismatch && (
                  <p className="text-xs font-semibold rounded-[9px] px-3 py-2" style={{ background: 'var(--color-saffron-soft, #fdf3e0)', color: 'var(--color-ember)' }}>
                    ⚠ Bill shows {currency} {billTotal!.toFixed(2)} but lines + VAT add up to {currency} {grandTotal.toFixed(2)} — check quantities/prices, VAT or unmatched lines.
                  </p>
                )}
              </div>
            </>
          ) : (
            /* Expense fields */
            <div className="rounded-[14px] p-4 grid sm:grid-cols-2 gap-3" style={card}>
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wide mb-2" style={{ color: 'var(--color-muted)' }}>Category</label>
                <select value={category} onChange={e => setCategory(e.target.value as ExpenseCategory)} className={inputBase} style={inputStyle}>
                  {EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wide mb-2" style={{ color: 'var(--color-muted)' }}>Amount ({currency})</label>
                <input type="number" min="0" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" className={`${inputBase} num`} style={inputStyle} />
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wide mb-2" style={{ color: 'var(--color-muted)' }}>
                  of which VAT
                  <button
                    type="button"
                    onClick={() => { const a = parseFloat(amount) || 0; setVatAmount(a > 0 ? (a - a / 1.05).toFixed(2) : '') }}
                    title="Work out the 5% VAT inside the amount"
                    className="ml-1.5 px-1.5 py-0.5 rounded-[6px] text-[10px] font-bold normal-case"
                    style={{ background: 'var(--color-saffron-soft)', color: 'var(--color-saffron)', border: '1px solid var(--color-saffron)' }}
                  >
                    5%
                  </button>
                </label>
                <input type="number" min="0" step="0.01" value={vatAmount} onChange={e => setVatAmount(e.target.value)} placeholder="0.00" className={`${inputBase} num`} style={inputStyle} />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-[11px] font-bold uppercase tracking-wide mb-2" style={{ color: 'var(--color-muted)' }}>Description</label>
                <input value={description} onChange={e => setDescription(e.target.value)} placeholder="What was this for?" className={inputBase} style={inputStyle} />
              </div>
            </div>
          )}

          {/* Payment */}
          <div className="rounded-[14px] p-4 space-y-3" style={card}>
            {docType === 'purchase' && (
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wide mb-2" style={{ color: 'var(--color-muted)' }}>Payment Status</p>
                <div className="flex gap-1.5">
                  {(['unpaid', 'partial', 'paid'] as const).map(s => (
                    <button
                      key={s} type="button" onClick={() => setPaymentStatus(s)}
                      className="px-3.5 py-1.5 rounded-pill text-sm font-semibold capitalize transition-colors"
                      style={{
                        background: paymentStatus === s ? 'var(--color-ink)' : 'var(--color-cream)',
                        color: paymentStatus === s ? 'var(--color-cream)' : 'var(--color-muted)',
                        border: '1px solid',
                        borderColor: paymentStatus === s ? 'var(--color-ink)' : 'var(--color-border)',
                      }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {(docType === 'expense' || paymentStatus !== 'unpaid') && (
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wide mb-2" style={{ color: 'var(--color-muted)' }}>Payment Method</label>
                <select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value as PaymentMode)} className={inputBase} style={inputStyle}>
                  <option value="">Select method</option>
                  {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </div>
            )}
          </div>

          {error && <p className="text-sm font-semibold" style={{ color: 'var(--color-red)' }}>{error}</p>}

          <div className="flex gap-2">
            <Button variant="outline" onClick={resetAll} className="flex-shrink-0">
              <X size={14} className="mr-1" /> Discard
            </Button>
            <Button variant="primary" onClick={handleConfirm} disabled={isPending} className="flex-1">
              {isPending ? 'Posting…' : docType === 'purchase'
                ? `Confirm Purchase · ${currency} ${grandTotal.toFixed(2)}`
                : `Confirm Expense · ${currency} ${(parseFloat(amount) || 0).toFixed(2)}`}
            </Button>
          </div>
        </div>
      )}

      {step === 'done' && (
        <div className="rounded-[14px] p-8 flex flex-col items-center text-center gap-4" style={card}>
          <div className="h-14 w-14 rounded-full flex items-center justify-center" style={{ background: 'var(--color-green-soft)' }}>
            <Check size={24} style={{ color: 'var(--color-green)' }} strokeWidth={2.5} />
          </div>
          <div>
            <p className="font-display font-bold text-[20px]" style={{ color: 'var(--color-ink)' }}>Done</p>
            <p className="text-sm mt-0.5" style={{ color: 'var(--color-muted)' }}>{doneMessage}</p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 w-full max-w-sm mt-2">
            <Button variant="primary" onClick={resetAll} className="flex-1">
              <ScanLine size={15} className="mr-1.5" /> Scan Another
            </Button>
            <Link href={docType === 'purchase' ? '/inventory/purchases' : '/expenses'} className="flex-1">
              <Button variant="outline" className="w-full">{docType === 'purchase' ? 'View Purchases' : 'View Expenses'}</Button>
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
