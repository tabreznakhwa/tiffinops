import { createAdminClient } from '@/lib/supabase/admin'
import { sendTextMessage } from '@/lib/whatsapp/doubletick'
import type { Enums, Json } from '@/lib/supabase/types'

export type ScheduledMealPeriod = Enums<'meal_period'>

type MenuSettings = {
  business_name: string
  menu_whatsapp_enabled: boolean
  menu_whatsapp_from_number: string | null
  menu_whatsapp_owner_number: string | null
  menu_whatsapp_manager_number: string | null
}

type Recipient = { role: 'owner' | 'manager'; phone: string }

export type ScheduledMenuResult = {
  ok: boolean
  meal: ScheduledMealPeriod
  menuDate: string
  sent: number
  skipped: number
  failed: number
  errors: string[]
  reason?: string
}

const SESSION_MS = 24 * 60 * 60 * 1000

function phoneKey(value: string): string {
  return value.replace(/\D/g, '')
}

function displayDate(date: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Dubai',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(`${date}T12:00:00Z`))
}

function mealLabel(meal: ScheduledMealPeriod): string {
  return meal.charAt(0).toUpperCase() + meal.slice(1)
}

function composeMessage(businessName: string, date: string, meal: ScheduledMealPeriod, itemNames: string[]): string {
  const lines = itemNames.map(name => `• ${name}`).join('\n')
  return `*Mai Dubai ${mealLabel(meal)} Menu*\n${displayDate(date)}\n\n${lines}\n\nPlease forward this menu to the Mai Dubai WhatsApp group.\n— ${businessName}`
}

/**
 * Send one published meal menu to the configured owner and manager numbers.
 * This intentionally uses free-form text only while each recipient has an
 * inbound message inside WhatsApp's rolling 24-hour customer-service window.
 */
export async function sendScheduledMenu(
  menuDate: string,
  meal: ScheduledMealPeriod,
): Promise<ScheduledMenuResult> {
  const admin = createAdminClient()
  const result: ScheduledMenuResult = {
    ok: true,
    meal,
    menuDate,
    sent: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  }

  const { data: settingsData, error: settingsError } = await admin
    .from('app_settings')
    .select('business_name, menu_whatsapp_enabled, menu_whatsapp_from_number, menu_whatsapp_owner_number, menu_whatsapp_manager_number')
    .eq('id', 1)
    .single()
  if (settingsError) return { ...result, ok: false, failed: 1, errors: [settingsError.message] }

  const settings = settingsData as unknown as MenuSettings
  if (!settings.menu_whatsapp_enabled) return { ...result, reason: 'Scheduled menu WhatsApp delivery is disabled' }
  if (!settings.menu_whatsapp_from_number?.trim()) {
    return { ...result, ok: false, failed: 1, errors: ['DoubleTick WhatsApp sender number is not configured'] }
  }

  const recipientCandidates: Recipient[] = [
    { role: 'owner', phone: settings.menu_whatsapp_owner_number?.trim() ?? '' },
    { role: 'manager', phone: settings.menu_whatsapp_manager_number?.trim() ?? '' },
  ]
  const seen = new Set<string>()
  const recipients = recipientCandidates.filter(recipient => {
    const key = phoneKey(recipient.phone)
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
  if (recipients.length === 0) {
    return { ...result, ok: false, failed: 1, errors: ['Owner and manager WhatsApp recipients are not configured'] }
  }

  const { data: dailyMenu, error: dailyMenuError } = await admin
    .from('daily_menus')
    .select('id')
    .eq('menu_date', menuDate)
    .eq('is_published', true)
    .maybeSingle()
  if (dailyMenuError) return { ...result, ok: false, failed: 1, errors: [dailyMenuError.message] }
  if (!dailyMenu?.id) return { ...result, reason: `No published menu for ${menuDate}` }

  const { data: items, error: itemsError } = await admin
    .from('menu_items')
    .select('id, name')
    .eq('meal_period', meal)
    .eq('is_available', true)
    .order('name')
  if (itemsError) return { ...result, ok: false, failed: 1, errors: [itemsError.message] }

  const { data: overrides, error: overrideError } = await admin
    .from('daily_menu_items')
    .select('menu_item_id, is_available')
    .eq('daily_menu_id', dailyMenu.id)
  if (overrideError) return { ...result, ok: false, failed: 1, errors: [overrideError.message] }

  const unavailable = new Set((overrides ?? [])
    .filter(row => row.is_available === false)
    .map(row => row.menu_item_id))
  const itemNames = (items ?? []).filter(item => !unavailable.has(item.id)).map(item => item.name)
  if (itemNames.length === 0) return { ...result, reason: `Published ${meal} menu has no available items` }

  const message = composeMessage(settings.business_name, menuDate, meal, itemNames)
  const sessionCutoff = new Date(Date.now() - SESSION_MS).toISOString()

  for (const recipient of recipients) {
    const key = phoneKey(recipient.phone)
    const { data: existing } = await admin
      .from('menu_message_deliveries')
      .select('id, status')
      .eq('menu_date', menuDate)
      .eq('meal_period', meal)
      .eq('recipient_phone', recipient.phone)
      .maybeSingle()
    if (existing?.status === 'sent') {
      result.skipped++
      continue
    }

    // Phone formatting varies between webhook payloads (+971..., 971..., spaces),
    // so fetch the small 24-hour inbound set and compare normalized digits.
    const { data: recentInboundRows, error: inboundError } = await admin
      .from('whatsapp_messages')
      .select('id, from_phone, created_at')
      .eq('direction', 'inbound')
      .gte('created_at', sessionCutoff)
      .order('created_at', { ascending: false })

    if (inboundError) {
      result.failed++
      result.errors.push(`${recipient.role}: ${inboundError.message}`)
      continue
    }

    const recentInbound = (recentInboundRows ?? []).find(row => phoneKey(row.from_phone) === key)
    const status = recentInbound ? 'processing' : 'skipped_session_expired'
    const sessionError = recentInbound ? null : 'No inbound WhatsApp message from this recipient in the last 24 hours'
    const deliveryPayload = {
      menu_date: menuDate,
      meal_period: meal,
      recipient_role: recipient.role,
      recipient_phone: recipient.phone,
      status,
      message_body: message,
      error_detail: sessionError,
      sent_at: null,
    }
    const deliveryQuery = existing?.id
      ? admin.from('menu_message_deliveries').update(deliveryPayload).eq('id', existing.id)
      : admin.from('menu_message_deliveries').insert(deliveryPayload)
    const { data: delivery, error: claimError } = await deliveryQuery.select('id').single()

    if (claimError || !delivery) {
      result.failed++
      result.errors.push(`${recipient.role}: ${claimError?.message ?? 'Could not record delivery attempt'}`)
      continue
    }
    if (!recentInbound) {
      result.skipped++
      continue
    }

    const sent = await sendTextMessage(recipient.phone, settings.menu_whatsapp_from_number, message)
    if (sent.ok) {
      await admin.from('menu_message_deliveries').update({
        status: 'sent',
        sent_at: new Date().toISOString(),
        error_detail: null,
      }).eq('id', delivery.id)
      await admin.from('whatsapp_messages').insert({
        provider: 'doubletick',
        direction: 'outbound',
        from_phone: recipient.phone,
        message_type: 'text',
        body: message,
        raw_payload: { source: 'scheduled_menu', menu_date: menuDate, meal_period: meal } as Json,
        status: 'replied',
        processed_at: new Date().toISOString(),
      })
      result.sent++
    } else {
      await admin.from('menu_message_deliveries').update({
        status: 'failed',
        error_detail: sent.error ?? 'DoubleTick send failed',
      }).eq('id', delivery.id)
      result.failed++
      result.errors.push(`${recipient.role}: ${sent.error ?? 'DoubleTick send failed'}`)
    }
  }

  result.ok = result.failed === 0
  return result
}
