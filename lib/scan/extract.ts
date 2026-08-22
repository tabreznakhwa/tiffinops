// Claude-vision extraction for scanned purchase bills and expense receipts.
//
// Takes one image (or PDF) of a bill and returns a structured document:
// classified as a raw-material purchase vs. a business expense, with vendor,
// date, line items and totals. This module ONLY reads the document — it never
// writes anything. Matching to suppliers/inventory items happens in
// lib/scan/match.ts, and posting happens after the user reviews and confirms
// in the /scan-bill UI.

import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { EXPENSE_CATEGORIES } from '@/lib/scan/categories'

// Same model as lib/whatsapp/parser.ts — keep the two in sync if this changes.
const MODEL = 'claude-opus-5'

export { EXPENSE_CATEGORIES, type ExpenseCategory } from '@/lib/scan/categories'

// ── Output contract ──────────────────────────────────────────────────────────

export const ScannedDocSchema = z.object({
  /** Is this a raw-material purchase bill or a general business expense? */
  doc_type: z.enum(['purchase', 'expense']),
  vendor_name: z.string().nullable(),
  /** UAE VAT Tax Registration Number printed on the bill, digits only. */
  vendor_trn: z.string().nullable(),
  /** Document date, YYYY-MM-DD. Null when unreadable. */
  doc_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  currency: z.string().nullable(),
  line_items: z.array(
    z.object({
      name: z.string().min(1),
      quantity: z.number().positive().nullable(),
      /** Normalised: kg, g, l, ml, pcs, box, packet, dozen — or null. */
      unit: z.string().nullable(),
      unit_price: z.number().min(0).nullable(),
      line_total: z.number().min(0).nullable(),
    }),
  ),
  subtotal: z.number().min(0).nullable(),
  /** VAT amount on the bill (UAE standard rate is 5%). Null when not shown. */
  vat_amount: z.number().min(0).nullable(),
  total: z.number().min(0).nullable(),
  /** Whether the bill shows as settled (cash memo, "PAID" stamp…). */
  paid: z.boolean().nullable(),
  payment_method_hint: z.enum(['cash', 'card', 'bank_transfer', 'cheque', 'online']).nullable(),
  /** Best-fit category when doc_type is 'expense'. */
  suggested_category: z.enum(EXPENSE_CATEGORIES),
  confidence: z.enum(['high', 'low']),
  /** Anything odd worth telling the reviewer (unreadable lines, handwriting…). */
  notes: z.string().nullable(),
})

export type ScannedDoc = z.infer<typeof ScannedDocSchema>

// JSON Schema mirror of the Zod schema, for the API's structured output.
const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'doc_type', 'vendor_name', 'vendor_trn', 'doc_date', 'currency', 'line_items',
    'subtotal', 'vat_amount', 'total', 'paid', 'payment_method_hint',
    'suggested_category', 'confidence', 'notes',
  ],
  properties: {
    doc_type: { type: 'string', enum: ['purchase', 'expense'] },
    vendor_name: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    vendor_trn: {
      description: 'UAE VAT TRN printed on the bill, digits only — or null',
      anyOf: [{ type: 'string' }, { type: 'null' }],
    },
    doc_date: { description: 'YYYY-MM-DD or null', anyOf: [{ type: 'string' }, { type: 'null' }] },
    currency: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    line_items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'quantity', 'unit', 'unit_price', 'line_total'],
        properties: {
          name: { type: 'string' },
          quantity: { anyOf: [{ type: 'number' }, { type: 'null' }] },
          unit: {
            description: 'kg, g, l, ml, pcs, box, packet, dozen — or null',
            anyOf: [{ type: 'string' }, { type: 'null' }],
          },
          unit_price: { anyOf: [{ type: 'number' }, { type: 'null' }] },
          line_total: { anyOf: [{ type: 'number' }, { type: 'null' }] },
        },
      },
    },
    subtotal: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    vat_amount: {
      description: 'VAT amount on the bill (UAE 5%) — printed VAT line, or total minus subtotal when both are printed. Null when the bill shows no VAT.',
      anyOf: [{ type: 'number' }, { type: 'null' }],
    },
    total: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    paid: { anyOf: [{ type: 'boolean' }, { type: 'null' }] },
    payment_method_hint: {
      anyOf: [{ type: 'string', enum: ['cash', 'card', 'bank_transfer', 'cheque', 'online'] }, { type: 'null' }],
    },
    suggested_category: { type: 'string', enum: [...EXPENSE_CATEGORIES] },
    confidence: { type: 'string', enum: ['high', 'low'] },
    notes: { anyOf: [{ type: 'string' }, { type: 'null' }] },
  },
} as const

// ── Prompt ───────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You read photos and scans of bills, invoices and receipts for Apna Chulha, a home-style Indian tiffin (meal delivery) kitchen in Dubai. Documents are often crumpled thermal receipts, handwritten grocery bills in mixed English/Hindi/Urdu, or supermarket invoices.

Classify each document:
- "purchase" — raw materials and kitchen supplies the business stocks: groceries, vegetables, meat, spices, rice, flour, oil, dairy, disposables/packaging bought as stock (containers, bags, cutlery), gas cylinders bought as stock. These update inventory.
- "expense" — everything else: fuel/petrol, DEWA/SEWA/utility bills, telecom, rent, salaries, vehicle maintenance, equipment repair, marketing, government fees.

Extraction rules:
- vendor_name: the shop/company that ISSUED the bill, cleaned up ("AL MAYA SUPERMARKET LLC" → "Al Maya Supermarket"). Null if unreadable.
- vendor_trn: the issuer's UAE VAT TRN if printed (usually 15 digits near "TRN"), digits only. Null when absent — common on handwritten bills.
- doc_date: the bill's own date as YYYY-MM-DD. Dates in the UAE are usually DD/MM/YYYY — interpret them that way. Null if unreadable; never guess a date that is not on the document.
- line_items: one entry per purchased line. Clean the names ("BASMATI RCE 5KG XXL" → "basmati rice", with quantity 5 and unit "kg" when the pack size is the quantity). Normalise units to: kg, g, l, ml, pcs, box, packet, dozen. IMPORTANT: when a bill sells by wholesale packs — CT/CTN/carton, tin, bag, sack, case, tray, drum — keep that pack word as the unit ("carton", "tin", "bag"…); do NOT collapse it to pcs, the app converts packs to kg/l during review. Skip non-product lines (subtotal rows, VAT rows, loyalty points).
  - For an "expense" document line items are optional — a fuel receipt can have a single line "petrol".
- quantity/unit_price/line_total: exactly as printed; null when a value is missing or unreadable. NEVER invent or back-calculate numbers that are not visible.
- subtotal/total: as printed. total is the final payable amount including VAT.
- vat_amount: the VAT amount (UAE standard rate is 5%). Use the printed VAT/tax line when there is one; when the bill prints a subtotal and a VAT-inclusive total but no separate VAT line, use total minus subtotal. Null only when the bill genuinely shows no VAT (e.g. handwritten cash memos from unregistered vendors).
- paid: true for cash memos and receipts marked paid, false when it is clearly a credit invoice, null when unclear.
- suggested_category: best fit from the list (use "ingredients" for food purchases, "other" when nothing fits). Always give one even for doc_type "purchase".
- confidence: "low" when the image is blurry, cut off, not actually a bill, or you had to skip several unreadable lines. Otherwise "high".
- notes: one short sentence for the human reviewer about anything odd (e.g. "3 handwritten lines were unreadable"), else null.

Respond only with the structured JSON.`

// ── API call ─────────────────────────────────────────────────────────────────

export type ExtractOutcome =
  | { ok: true; doc: ScannedDoc }
  | { ok: false; error: string; retryable: boolean }

export type ScanFileType = 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf'

/**
 * Extract one scanned document. `base64` is the file contents; `nowDubai`
 * like "2026-08-21" gives the model today's date so it can sanity-check
 * bill dates without guessing.
 */
export async function extractReceipt(
  base64: string,
  mediaType: ScanFileType,
  nowDubai: string,
): Promise<ExtractOutcome> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { ok: false, error: 'ANTHROPIC_API_KEY is not set', retryable: false }
  }
  const client = new Anthropic()

  const fileBlock =
    mediaType === 'application/pdf'
      ? { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: base64 } }
      : { type: 'image' as const, source: { type: 'base64' as const, media_type: mediaType, data: base64 } }

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [
        {
          role: 'user',
          content: [
            fileBlock,
            { type: 'text', text: `Today's date in Dubai: ${nowDubai}\n\nRead this document.` },
          ],
        },
      ],
      output_config: {
        format: { type: 'json_schema', schema: OUTPUT_SCHEMA },
      },
    })

    const textBlock = response.content.find(b => b.type === 'text')
    if (!textBlock || textBlock.type !== 'text') {
      return { ok: false, error: 'No text block in Claude response', retryable: true }
    }

    const validated = ScannedDocSchema.safeParse(JSON.parse(textBlock.text))
    if (!validated.success) {
      return { ok: false, error: `Schema mismatch: ${validated.error.message.slice(0, 300)}`, retryable: false }
    }
    return { ok: true, doc: validated.data }
  } catch (err) {
    // Most specific first — APIConnectionError is a subclass of APIError.
    if (err instanceof Anthropic.APIConnectionError) {
      return { ok: false, error: `Connection error: ${err.message}`, retryable: true }
    }
    if (err instanceof Anthropic.RateLimitError) {
      return { ok: false, error: 'Rate limited by Anthropic API', retryable: true }
    }
    if (err instanceof Anthropic.APIError) {
      return { ok: false, error: `Anthropic API ${err.status}: ${err.message}`, retryable: false }
    }
    return { ok: false, error: err instanceof Error ? err.message : String(err), retryable: false }
  }
}
