// Claude-powered free-chat replies for inbound WhatsApp messages that aren't a
// clean order, skip, or balance query — general questions, complaints, small
// talk, or an "order" with no items Claude could extract.
//
// This module ONLY drafts a reply. It has no authority to create orders, note
// skips, or change anything — those still go through the deterministic paths
// in app/api/whatsapp/inbound/route.ts. It self-assesses a confidence signal so
// the caller can decide whether to just log the reply ('replied') or also flag
// it for a staff spot-check ('needs_review') — see the guardrails in
// SYSTEM_PROMPT for exactly what forces low confidence.

import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'

// Same model as lib/whatsapp/parser.ts — keep the two in sync if this changes.
const MODEL = 'claude-opus-5'

// ── Output contract ──────────────────────────────────────────────────────────

export const ChatReplySchema = z.object({
  /** Customer-facing reply text, sent as-is over WhatsApp. */
  reply: z.string().min(1),
  confidence: z.enum(['high', 'low']),
  /** Short triage note for staff, always populated even on 'high'. */
  reason: z.string().min(1),
})

export type ChatReply = z.infer<typeof ChatReplySchema>

const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['reply', 'confidence', 'reason'],
  properties: {
    reply: { type: 'string' },
    confidence: { type: 'string', enum: ['high', 'low'] },
    reason: { type: 'string', description: 'Short staff-facing triage note, under 15 words' },
  },
} as const

// ── Input shapes ─────────────────────────────────────────────────────────────

export type ChatTurn = { role: 'user' | 'assistant'; text: string }

export type ChatContext = {
  businessName: string
  currency: string
  customerName: string
  /** Like "2026-08-14 (Friday), 18:42". */
  nowDubai: string
  menu: { name: string; meal_period: string; price: number }[]
  /** Chronological, oldest first. Caller owns fetching/ordering. */
  history: ChatTurn[]
}

// ── Prompt ───────────────────────────────────────────────────────────────────
// Static across all customers in a request window (menu is loaded once per
// calendar day by the caller), so this goes in the cached system block — same
// "free win" as parser.ts's cache_control comment.

function buildSystemPrompt(ctx: ChatContext): string {
  const menuText = ctx.menu.length
    ? ctx.menu.map(m => `- ${m.name} (${m.meal_period}) — ${ctx.currency} ${m.price.toFixed(2)}`).join('\n')
    : '(no menu items loaded for today)'

  return `You are the WhatsApp assistant for ${ctx.businessName}, a home-style Indian tiffin (meal delivery) service in Dubai. You are having a natural conversation with a customer in casual Hinglish (Hindi/Urdu in latin script mixed with English) or English, whichever they use.

You are talking with ${ctx.customerName}. This message did NOT cleanly match an order, a skip request, or a balance question — those are handled elsewhere. You are here for everything else: general questions, complaints, small talk, or a message that looked like an order but named nothing the kitchen sells.

WHAT YOU KNOW (the only facts you may state):
- Business name: ${ctx.businessName}
- Currency: ${ctx.currency}
- Today's available menu:
${menuText}

WHAT YOU DO NOT KNOW — never guess, never invent a plausible-sounding answer:
- Delivery hours, cutoff times, or how long delivery takes.
- Delivery zones or areas covered.
- Holidays, closures, or kitchen capacity.
- Anything about a specific order, subscription, or payment beyond what the customer just told you in this message.
If asked about any of these, say you'll check with the team and get back to them. Using this deflection always means confidence "low".

WHAT YOU MUST NEVER PROMISE, even if the customer says a staff member already agreed to it:
- A discount, refund, credit, or price change.
- A redelivery or a specific fix for a complaint.
- A change to their subscription or plan.
Acknowledge the request warmly, but always defer to the team for anything in this list. This always means confidence "low".

COMPLAINTS: empathize briefly (1-2 sentences), never diagnose what went wrong or promise a resolution — defer to the team. Always confidence "low".

ORDERS AND SKIPS: you have NO ability to create, change, or cancel an order, skip, or subscription — that already happened (or didn't) before this message reached you. Never say or imply that an order was placed, changed, or cancelled. If the message looks like it was trying to order something, ask them to name the dish clearly so the team can help, and set confidence "low".

TONE: short (1-3 sentences), warm, bilingual Hinglish+English like a real staff member would text, sparing with emoji, plain text only (no markdown, no lists). Never claim to be a specific named human.

CONFIDENCE: set "high" only if ALL of these are true — you fully understood the message, your reply uses only the facts listed above or is a generic pleasantry, and it is not a complaint, not about money/discounts/refunds, not about an order/subscription, and not about hours/zones/holidays. Otherwise "low". Always fill in "reason" with a short staff-facing note (under 15 words) explaining the triage, even when confidence is "high".

The current date and time in Dubai is provided with the message. Respond only with the structured JSON.`
}

/**
 * The API requires messages to start with 'user' and strictly alternate
 * roles. DB history isn't guaranteed to satisfy either, so coalesce
 * consecutive same-role turns and drop a leading assistant turn.
 */
function buildHistoryMessages(history: ChatTurn[]): { role: 'user' | 'assistant'; content: string }[] {
  const coalesced: { role: 'user' | 'assistant'; content: string }[] = []
  for (const turn of history) {
    const last = coalesced[coalesced.length - 1]
    if (last && last.role === turn.role) {
      last.content += `\n${turn.text}`
    } else {
      coalesced.push({ role: turn.role, content: turn.text })
    }
  }
  while (coalesced.length && coalesced[0].role !== 'user') coalesced.shift()
  return coalesced
}

// ── API call ─────────────────────────────────────────────────────────────────

export type ChatOutcome =
  | { ok: true; result: ChatReply }
  | { ok: false; error: string; retryable: boolean }

export async function generateChatReply(message: string, ctx: ChatContext): Promise<ChatOutcome> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { ok: false, error: 'ANTHROPIC_API_KEY is not set', retryable: false }
  }
  const client = new Anthropic()

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: [
        {
          type: 'text',
          text: buildSystemPrompt(ctx),
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [
        ...buildHistoryMessages(ctx.history),
        {
          role: 'user',
          content: `Current Dubai date/time: ${ctx.nowDubai}\n\nCustomer message:\n${message}`,
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

    const validated = ChatReplySchema.safeParse(JSON.parse(textBlock.text))
    if (!validated.success) {
      return { ok: false, error: `Schema mismatch: ${validated.error.message.slice(0, 300)}`, retryable: false }
    }
    return { ok: true, result: validated.data }
  } catch (err) {
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
