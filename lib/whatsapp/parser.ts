// Claude-powered parser for inbound customer WhatsApp messages.
//
// Customers write conversational Hinglish ("bhai aaj dinner me 2 rumali aur
// kheema bhej dena"). This module turns that into a structured intent +
// normalised item lines. It deliberately does NOT match items to the menu —
// the deterministic engine in lib/orders/parse-whatsapp.ts owns matching,
// synonyms and pricing, so Claude's only job is language understanding.
//
// NOTE: the prompt is provisional — tuned on invented examples. Once real
// customer messages are collected in whatsapp_messages, refine it against
// those.

import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'

// claude-opus-5 is the default. If cost ever matters more than accuracy on
// Hinglish, 'claude-haiku-4-5' also works with this exact request shape.
const MODEL = 'claude-opus-5'

// ── Output contract ──────────────────────────────────────────────────────────

export const ParsedMessageSchema = z.object({
  intent: z.enum(['order', 'skip', 'balance_query', 'other']),
  /** Only for intent 'order'. */
  meal_period: z.enum(['breakfast', 'lunch', 'dinner']).nullable(),
  /** YYYY-MM-DD in Dubai time; null = today. */
  order_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  items: z.array(
    z.object({
      /** Dish name in plain latin script, e.g. "rumali roti". */
      name: z.string().min(1),
      quantity: z.number().int().min(1).max(100),
      /** Portion size if mentioned: "500ml", "small", "large", else null. */
      size: z.string().nullable(),
    }),
  ),
  /** For intent 'skip': which date to skip (YYYY-MM-DD, null = today). */
  skip_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  /** One-line English summary of what the customer wants, for the staff inbox. */
  summary: z.string(),
})

export type ParsedMessage = z.infer<typeof ParsedMessageSchema>

// JSON Schema mirror of the Zod schema, for the API's structured output.
const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['intent', 'meal_period', 'order_date', 'items', 'skip_date', 'summary'],
  properties: {
    intent: { type: 'string', enum: ['order', 'skip', 'balance_query', 'other'] },
    meal_period: {
      anyOf: [{ type: 'string', enum: ['breakfast', 'lunch', 'dinner'] }, { type: 'null' }],
    },
    order_date: {
      anyOf: [{ type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }, { type: 'null' }],
    },
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'quantity', 'size'],
        properties: {
          name: { type: 'string' },
          quantity: { type: 'integer', minimum: 1, maximum: 100 },
          size: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        },
      },
    },
    skip_date: {
      anyOf: [{ type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }, { type: 'null' }],
    },
    summary: { type: 'string' },
  },
} as const

// ── Prompt ───────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You read incoming WhatsApp messages sent by customers of Apna Chulha, a home-style Indian tiffin (meal delivery) service in Dubai. Customers write in casual Hinglish (Hindi/Urdu in latin script mixed with English), often with spelling mistakes and shorthand.

Classify each message into exactly one intent:

- "order" — the customer is ordering food. Extract every dish with its quantity. Examples: "2 rumali aur kheema bhejdo", "aaj dinner: white rice + korma", "kal lunch me dal tadka 500ml".
- "skip" — the customer wants NO delivery for a day. Examples: "aaj khana mat bhejna", "kal off rakhna, travel kar raha hun", "no dinner today".
- "balance_query" — the customer asks about their bill or balance. Examples: "kitna balance hai", "bill kitna hua is month".
- "other" — greetings, thanks, complaints, questions about menu/timing, or anything that is not clearly one of the above. When unsure, use "other" — a human will read it.

Rules for orders:
- name: dish in plain latin lowercase, spelling corrected where obvious ("khema" → "kheema"). Do NOT invent dishes not mentioned.
- quantity: default 1 when not stated. "2 roti" = quantity 2.
- size: only if mentioned — "500ml", "250ml", "small", "large". Otherwise null.
- meal_period: from words like breakfast/nashta, lunch, dinner/raat ka khana. If the message names no meal, use null — the system will infer it from the time of day.
- order_date: "aaj"/today or unstated → null. "kal"/tomorrow → tomorrow's date computed from the current Dubai date given in the message.

Rules for skip:
- skip_date: "aaj"/today or unstated → null, "kal"/tomorrow → tomorrow's date.

summary: one short English sentence describing the request, e.g. "Wants 2 rumali roti and 1 kheema for dinner today."

The current date and time in Dubai is provided with each message. Respond only with the structured JSON.`

// ── API call ─────────────────────────────────────────────────────────────────

export type ParseOutcome =
  | { ok: true; parsed: ParsedMessage }
  | { ok: false; error: string; retryable: boolean }

/**
 * Parse one customer message. `nowDubai` like "2026-08-14 (Friday), 18:42".
 */
export async function parseCustomerMessage(text: string, nowDubai: string): Promise<ParseOutcome> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { ok: false, error: 'ANTHROPIC_API_KEY is not set', retryable: false }
  }
  const client = new Anthropic()

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: [
        {
          type: 'text',
          text: SYSTEM_PROMPT,
          // 5-minute reuse window — free win when several customers message
          // around meal time.
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [
        {
          role: 'user',
          content: `Current Dubai date/time: ${nowDubai}\n\nCustomer message:\n${text}`,
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

    const validated = ParsedMessageSchema.safeParse(JSON.parse(textBlock.text))
    if (!validated.success) {
      return { ok: false, error: `Schema mismatch: ${validated.error.message.slice(0, 300)}`, retryable: false }
    }
    return { ok: true, parsed: validated.data }
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
