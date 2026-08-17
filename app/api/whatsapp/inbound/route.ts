// DoubleTick inbound webhook — the WhatsApp order agent.
//
// Flow: verify secret → dedupe → store raw message → match customer by phone
// → Claude parses the Hinglish text → deterministic engine matches items to
// the menu → create a DRAFT order → reply to the customer.
//
// Safety model: this route behaves like a restricted data-entry clerk. It only
// ever inserts orders with order_status = 'draft', which the ledger trigger
// ignores (debits post on 'confirmed' only). Staff review drafts in the app
// and confirm them. It never touches payments or ledger_entries.
//
// Configure in DoubleTick: Settings → Webhooks → New Webhook, trigger
// "Message Received", URL https://<app>/api/whatsapp/inbound?secret=<secret>

import { NextRequest, NextResponse } from 'next/server'
import { formatInTimeZone } from 'date-fns-tz'
import { createAdminClient } from '@/lib/supabase/admin'
import { parseWhatsAppOrders } from '@/lib/orders/parse-whatsapp'
import type { MealPeriod, MenuItemRef } from '@/lib/orders/parse-whatsapp'
import { parseCustomerMessage } from '@/lib/whatsapp/parser'
import type { ParsedMessage } from '@/lib/whatsapp/parser'
import { sendTextMessage } from '@/lib/whatsapp/doubletick'
import { transcribeAudio } from '@/lib/whatsapp/transcribe'
import type { Json } from '@/lib/supabase/types'

export const runtime = 'nodejs'
export const maxDuration = 60

type Admin = ReturnType<typeof createAdminClient>

const TZ = 'Asia/Dubai'

// ── Menu loading (mirror of lib/orders/whatsapp-actions.ts, which is a
//    'use server' module and cannot export helpers to a route handler) ───────

async function loadMenu(admin: Admin, date: string, meal: MealPeriod | null): Promise<MenuItemRef[]> {
  const [{ data: items }, { data: dailyMenu }] = await Promise.all([
    admin.from('menu_items').select('id, name, meal_period, default_price').eq('is_available', true),
    admin.from('daily_menus').select('id').eq('menu_date', date).maybeSingle(),
  ])

  const overrides = new Map<string, number>()
  const unavailable = new Set<string>()
  if (dailyMenu?.id) {
    const { data: dmi } = await admin
      .from('daily_menu_items')
      .select('menu_item_id, price_override, is_available')
      .eq('daily_menu_id', dailyMenu.id)
    for (const d of dmi ?? []) {
      if (d.price_override != null) overrides.set(d.menu_item_id, parseFloat(String(d.price_override)))
      if (d.is_available === false) unavailable.add(d.menu_item_id)
    }
  }

  const all = (items ?? [])
    .filter(m => !unavailable.has(m.id))
    .map(m => ({
      id: m.id,
      name: m.name,
      meal_period: String(m.meal_period),
      price: overrides.get(m.id) ?? parseFloat(String(m.default_price)),
    }))

  const forMeal = meal ? all.filter(m => m.meal_period === meal) : all
  return forMeal.length ? forMeal : all
}

// ── Customer matching by phone ───────────────────────────────────────────────

type MatchedCustomer = { id: string; full_name: string; customer_code: string; mobile_number: string | null }

/** Last 9 digits — enough to survive +971 / 971 / 0-prefix formatting drift. */
function phoneKey(s: string | null | undefined): string {
  return (s ?? '').replace(/\D/g, '').slice(-9)
}

async function matchCustomerByPhone(admin: Admin, fromPhone: string): Promise<MatchedCustomer | null> {
  const key = phoneKey(fromPhone)
  if (key.length < 7) return null

  const { data } = await admin
    .from('customers')
    .select('id, full_name, customer_code, mobile_number, whatsapp_number')
    .in('status', ['active', 'paused'])

  for (const c of data ?? []) {
    if (phoneKey(c.whatsapp_number) === key || phoneKey(c.mobile_number) === key) {
      return { id: c.id, full_name: c.full_name, customer_code: c.customer_code, mobile_number: c.mobile_number }
    }
  }
  return null
}

// ── Draft order creation ─────────────────────────────────────────────────────

type DraftItem = { menu_item_id: string; item_name_snapshot: string; quantity: number; unit_price: number }

async function createDraftOrder(
  admin: Admin,
  args: {
    customerId: string
    orderDate: string
    mealPeriod: MealPeriod
    items: DraftItem[]
    sourceMessageId: string
    originalText: string
    createdBy: string
  },
): Promise<{ orderId: string; orderNumber: string; total: number } | { error: string }> {
  const { data: orderNumber, error: numErr } = await admin.rpc('next_order_number')
  if (numErr || !orderNumber) return { error: numErr?.message ?? 'next_order_number failed' }

  const subtotal = args.items.reduce((s, i) => s + i.quantity * i.unit_price, 0)
  const orderId = crypto.randomUUID()

  const { error: orderErr } = await admin.from('orders').insert({
    id: orderId,
    order_number: orderNumber as string,
    customer_id: args.customerId,
    order_date: args.orderDate,
    meal_period: args.mealPeriod,
    subtotal: subtotal.toFixed(2),
    discount_amount: '0.00',
    delivery_charge: '0.00',
    total_amount: subtotal.toFixed(2),
    payment_status: 'unpaid',
    order_status: 'draft', // financially inert — ledger posts on 'confirmed' only
    is_credit: true,
    notes: `WhatsApp: "${args.originalText.slice(0, 300)}"`,
    source: 'whatsapp',
    source_message_id: args.sourceMessageId,
    created_by: args.createdBy,
  })
  if (orderErr) return { error: orderErr.message }

  const { error: itemErr } = await admin.from('order_items').insert(
    args.items.map(i => ({
      order_id: orderId,
      menu_item_id: i.menu_item_id,
      item_name_snapshot: i.item_name_snapshot,
      quantity: String(i.quantity),
      unit_price: i.unit_price.toFixed(2),
      total_price: (i.quantity * i.unit_price).toFixed(2),
    })),
  )
  if (itemErr) {
    // Never leave an order with no lines.
    await admin.from('orders').delete().eq('id', orderId)
    return { error: `Items failed: ${itemErr.message}` }
  }

  return { orderId, orderNumber: orderNumber as string, total: subtotal }
}

// ── Webhook ──────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get('secret')
  if (!secret || secret !== process.env.WHATSAPP_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const payload = await req.json().catch(() => null)
  if (!payload || typeof payload !== 'object') {
    return NextResponse.json({ error: 'Bad payload' }, { status: 400 })
  }

  // Only process messages the customer sent — not our own outbound echoes.
  if (payload.lastMessageOrigin && payload.lastMessageOrigin !== 'CUSTOMER') {
    return NextResponse.json({ ok: true, skipped: 'not a customer message' })
  }

  const fromPhone = String(payload.from ?? '')
  const businessPhone = String(payload.to ?? '')
  const providerMessageId: string | null = payload.dtMessageId ?? payload.messageId ?? null
  const messageType = String(payload.message?.type ?? 'TEXT').toLowerCase()
  const body: string | null = payload.message?.text ?? null
  // DoubleTick nests media in a few different spots depending on message type.
  // Cover the common ones so voice notes resolve to a downloadable URL.
  const mediaUrl: string | null =
    payload.message?.mediaUrl ??
    payload.message?.url ??
    payload.message?.media?.url ??
    payload.media?.url ??
    payload.mediaUrl ??
    null
  const mediaMime: string | null =
    payload.message?.mimeType ??
    payload.message?.mime_type ??
    payload.message?.media?.mimeType ??
    payload.mimeType ??
    null
  if (!fromPhone) return NextResponse.json({ error: 'Missing from' }, { status: 400 })

  const admin = createAdminClient()

  // Store first, process after — the unique index on (provider,
  // provider_message_id) makes webhook retries idempotent.
  const { data: msgRow, error: insErr } = await admin
    .from('whatsapp_messages')
    .insert({
      provider: 'doubletick',
      provider_message_id: providerMessageId,
      direction: 'inbound',
      from_phone: fromPhone,
      message_type: messageType,
      body,
      raw_payload: payload as Json,
    })
    .select('id')
    .single()

  if (insErr) {
    if (insErr.code === '23505') return NextResponse.json({ ok: true, skipped: 'duplicate' })
    return NextResponse.json({ error: insErr.message }, { status: 500 })
  }
  const msgId = msgRow.id

  const finish = async (
    fields: { status: string; customer_id?: string | null; parse_intent?: string | null;
              parse_result?: Json | null; order_id?: string | null; error_detail?: string | null },
  ) => {
    await admin
      .from('whatsapp_messages')
      .update({ ...fields, processed_at: new Date().toISOString() })
      .eq('id', msgId)
  }

  const reply = async (text: string) => {
    const sent = await sendTextMessage(fromPhone, businessPhone, text)
    if (sent.ok) {
      await admin.from('whatsapp_messages').insert({
        provider: 'doubletick',
        direction: 'outbound',
        from_phone: fromPhone,
        message_type: 'text',
        body: text,
        raw_payload: {} as Json,
        status: 'replied',
      })
    } else {
      // Keep the failure on the inbound row so it's visible in the review queue.
      const { data: row } = await admin
        .from('whatsapp_messages').select('error_detail').eq('id', msgId).single()
      const prior = row?.error_detail ? `${row.error_detail} | ` : ''
      await admin
        .from('whatsapp_messages')
        .update({ error_detail: `${prior}[reply failed] ${sent.error}` })
        .eq('id', msgId)
    }
    return sent
  }

  try {
    // 1. Who is this?
    const customer = await matchCustomerByPhone(admin, fromPhone)
    if (!customer) {
      // Unknown number: keep for staff review, never auto-reply to strangers.
      await finish({ status: 'needs_review', error_detail: 'No customer matches this phone number' })
      return NextResponse.json({ ok: true, result: 'unknown customer' })
    }

    // 2. Voice notes are transcribed to text, then flow through the exact same
    //    pipeline as typed messages. Other media (images, documents) still go
    //    to staff review.
    if (messageType !== 'text' || !body?.trim()) {
      if (mediaUrl && (messageType === 'audio' || messageType === 'voice')) {
        await finish({ status: 'processing', customer_id: customer.id, error_detail: 'Transcribing voice note' })
        const transcription = await transcribeAudio(mediaUrl, mediaMime ?? 'audio/ogg')
        if (!transcription.ok) {
          await finish({
            status: 'needs_review', customer_id: customer.id,
            error_detail: `Voice transcription failed: ${transcription.error}`,
          })
          await reply('🙏 Aapki voice note sun li, par samajh nahi aaya. Hamari team jald aapko call karegi. Our team will call you shortly.')
          return NextResponse.json({ ok: true, result: `needs_review (voice transcribe failed)` })
        }

        // Transcript row so staff can audit what Whisper heard.
        await admin.from('whatsapp_messages').insert({
          provider: 'doubletick',
          direction: 'inbound',
          from_phone: fromPhone,
          message_type: 'text',
          body: transcription.text,
          raw_payload: { transcribed_from: providerMessageId, audio_url: mediaUrl } as Json,
          status: 'processing',
        })
        await finish({ status: 'processing', customer_id: customer.id, error_detail: `Transcribed: "${transcription.text.slice(0, 120)}"` })

        // Re-run the handler on the transcribed text.
        const nowDubai = formatInTimeZone(new Date(), TZ, "yyyy-MM-dd (EEEE), HH:mm")
        const outcome = await parseCustomerMessage(transcription.text, nowDubai)
        if (!outcome.ok) {
          await finish({ status: 'error', customer_id: customer.id, error_detail: outcome.error })
          return NextResponse.json({ ok: true, result: 'parse error (voice)' })
        }
        const parsedVoice = outcome.parsed
        if (parsedVoice.intent === 'order' && parsedVoice.items.length) {
          const result = await handleOrder(admin, customer, parsedVoice, transcription.text, msgId, finish, reply)
          return NextResponse.json({ ok: true, result })
        }
        if (parsedVoice.intent === 'skip') {
          await finish({ status: 'needs_review', customer_id: customer.id, parse_intent: 'skip', parse_result: parsedVoice as unknown as Json })
          await reply('👍 Note kar liya — us din ka khana nahi bhejenge. Hamari team confirm karegi. Thank you!')
          return NextResponse.json({ ok: true, result: 'skip noted (voice)' })
        }
        if (parsedVoice.intent === 'balance_query') {
          await finish({ status: 'needs_review', customer_id: customer.id, parse_intent: 'balance_query', parse_result: parsedVoice as unknown as Json })
          await reply('🙏 Aapka bill detail hamari team jald bhejegi. Our team will send your balance details shortly.')
          return NextResponse.json({ ok: true, result: 'balance query noted (voice)' })
        }
        await finish({ status: 'needs_review', customer_id: customer.id, parse_intent: parsedVoice.intent, parse_result: parsedVoice as unknown as Json })
        return NextResponse.json({ ok: true, result: 'needs_review (voice)' })
      }

      await finish({ status: 'needs_review', customer_id: customer.id, error_detail: `Unsupported message type: ${messageType}` })
      await reply('🙏 Message mil gaya! Hamari team check karke jald reply karegi. Our team will get back to you shortly.')
      return NextResponse.json({ ok: true, result: 'needs_review (non-text)' })
    }

    // 3. Claude: language understanding only.
    const nowDubai = formatInTimeZone(new Date(), TZ, "yyyy-MM-dd (EEEE), HH:mm")
    const outcome = await parseCustomerMessage(body, nowDubai)
    if (!outcome.ok) {
      await finish({ status: 'error', customer_id: customer.id, error_detail: outcome.error })
      // Retryable errors: 500 so DoubleTick redelivers; the dedupe row is
      // deleted first so the retry isn't swallowed as a duplicate.
      if (outcome.retryable) {
        await admin.from('whatsapp_messages').delete().eq('id', msgId)
        return NextResponse.json({ error: outcome.error }, { status: 500 })
      }
      return NextResponse.json({ ok: true, result: 'parse error' })
    }
    const parsed = outcome.parsed

    // 4. Route by intent.
    if (parsed.intent === 'order' && parsed.items.length) {
      const result = await handleOrder(admin, customer, parsed, body, msgId, finish, reply)
      return NextResponse.json({ ok: true, result })
    }

    if (parsed.intent === 'skip') {
      await finish({ status: 'needs_review', customer_id: customer.id, parse_intent: 'skip', parse_result: parsed as unknown as Json })
      await reply('👍 Note kar liya — us din ka khana nahi bhejenge. Hamari team confirm karegi. Thank you!')
      return NextResponse.json({ ok: true, result: 'skip noted' })
    }

    if (parsed.intent === 'balance_query') {
      await finish({ status: 'needs_review', customer_id: customer.id, parse_intent: 'balance_query', parse_result: parsed as unknown as Json })
      await reply('🙏 Aapka bill detail hamari team jald bhejegi. Our team will send your balance details shortly.')
      return NextResponse.json({ ok: true, result: 'balance query noted' })
    }

    // 'other', or an "order" with no items — a human reads it, no auto-reply.
    await finish({ status: 'needs_review', customer_id: customer.id, parse_intent: parsed.intent, parse_result: parsed as unknown as Json })
    return NextResponse.json({ ok: true, result: 'needs_review' })
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    await finish({ status: 'error', error_detail: detail })
    return NextResponse.json({ ok: true, result: 'error', detail })
  }
}

// ── Order intent ─────────────────────────────────────────────────────────────

async function handleOrder(
  admin: Admin,
  customer: MatchedCustomer,
  parsed: ParsedMessage,
  originalText: string,
  msgId: string,
  finish: (f: { status: string; customer_id?: string | null; parse_intent?: string | null;
                parse_result?: Json | null; order_id?: string | null; error_detail?: string | null }) => Promise<void>,
  reply: (text: string) => Promise<{ ok: boolean }>,
): Promise<string> {
  const today = formatInTimeZone(new Date(), TZ, 'yyyy-MM-dd')
  const orderDate = parsed.order_date ?? today

  // Meal not named → infer from Dubai time of day.
  const hour = parseInt(formatInTimeZone(new Date(), TZ, 'H'), 10)
  const mealPeriod: MealPeriod =
    parsed.meal_period ?? (hour < 11 ? 'breakfast' : hour < 16 ? 'lunch' : 'dinner')

  const needsReview = async (why: string) => {
    await finish({
      status: 'needs_review', customer_id: customer.id, parse_intent: 'order',
      parse_result: parsed as unknown as Json, error_detail: why,
    })
    await reply('🙏 Order mil gaya! Hamari team check karke jald confirm karegi. Thank you!')
    return `needs_review (${why})`
  }

  // One order per customer per date+meal — a second message goes to staff.
  const { data: existing } = await admin
    .from('orders')
    .select('id')
    .eq('customer_id', customer.id)
    .eq('order_date', orderDate)
    .eq('meal_period', mealPeriod)
    .not('order_status', 'in', '(cancelled,voided)')
    .limit(1)
  if (existing?.length) return needsReview(`Already has a ${mealPeriod} order for ${orderDate}`)

  // Deterministic engine owns menu matching: feed it Claude's normalised item
  // lines as a synthetic block headed by the exact customer name.
  const menu = await loadMenu(admin, orderDate, mealPeriod)
  const itemLines = parsed.items.map(i =>
    [i.name, i.size ?? '', i.quantity > 1 ? String(i.quantity) : ''].filter(Boolean).join(' '),
  )
  const engine = parseWhatsAppOrders(`${customer.full_name}\n${itemLines.join('\n')}`, {
    menu,
    customers: [customer],
    today: orderDate,
    defaultMeal: mealPeriod,
  })

  const block = engine.orders[0]
  const clean =
    block &&
    block.items.length > 0 &&
    block.items.every(i => i.menu_item_id && i.unit_price > 0 && (i.match === 'exact' || i.match === 'fuzzy'))

  if (!clean) {
    const issues = block?.issues.join('; ') || 'No items matched the menu'
    return needsReview(issues)
  }

  const createdBy = process.env.WHATSAPP_AGENT_USER_ID
  if (!createdBy) {
    await finish({
      status: 'error', customer_id: customer.id, parse_intent: 'order',
      parse_result: parsed as unknown as Json, error_detail: 'WHATSAPP_AGENT_USER_ID is not set',
    })
    return 'error (WHATSAPP_AGENT_USER_ID missing)'
  }

  const draft = await createDraftOrder(admin, {
    customerId: customer.id,
    orderDate,
    mealPeriod,
    items: block.items.map(i => ({
      menu_item_id: i.menu_item_id as string,
      item_name_snapshot: i.name + (i.note ? ` (${i.note})` : ''),
      quantity: i.quantity,
      unit_price: i.unit_price,
    })),
    sourceMessageId: msgId,
    originalText,
    createdBy,
  })

  if ('error' in draft) {
    await finish({
      status: 'error', customer_id: customer.id, parse_intent: 'order',
      parse_result: parsed as unknown as Json, error_detail: draft.error,
    })
    return `error (${draft.error})`
  }

  await finish({
    status: 'draft_created', customer_id: customer.id, parse_intent: 'order',
    parse_result: parsed as unknown as Json, order_id: draft.orderId,
  })

  const lines = block.items.map(i => `• ${i.name} × ${i.quantity}`).join('\n')
  const addons = (parsed.addon_suggestions ?? [])
    .map(a => a.trim())
    .filter(Boolean)
    .slice(0, 4)
  const upsell = addons.length
    ? `\n\nSath me kuch aur chahiye? ${addons.join(', ')} bhi add kar sakte hain. (Want anything else? We can also add ${addons.join(', ')}.)`
    : ''
  await reply(
    `✅ Order mil gaya!\n\n${lines}\nTotal: AED ${draft.total.toFixed(2)} (${mealPeriod})${upsell}\n\nHamari team jald confirm karegi. Thank you! 🙏`,
  )
  return `draft_created (${draft.orderNumber})`
}
