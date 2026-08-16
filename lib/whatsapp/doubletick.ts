// DoubleTick WhatsApp send API.
//
// Docs: https://docs.doubletick.io/reference/outgoing-messages-whatsapp-text
// The Authorization header takes the raw API key — no "Bearer" prefix.
// Free-text sends only work inside the 24-hour customer session window,
// which is always open here: we only ever reply to a message the customer
// just sent.

const SEND_TEXT_URL = 'https://public.doubletick.io/whatsapp/message/text'

export type SendResult = { ok: boolean; error?: string }

/**
 * Send a plain text WhatsApp message via DoubleTick.
 *
 * @param to   Customer phone in the format DoubleTick delivered it ("+9715...")
 * @param from Business WhatsApp number — echo back the `to` field of the
 *             inbound webhook payload so replies always leave from the same
 *             number the customer wrote to.
 */
/** Inbound webhooks deliver bare digits ("9715..."), the send API wants E.164 ("+9715..."). */
function e164(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  return digits ? `+${digits}` : phone
}

export async function sendTextMessage(to: string, from: string, text: string): Promise<SendResult> {
  const apiKey = process.env.DOUBLETICK_API_KEY
  if (!apiKey) return { ok: false, error: 'DOUBLETICK_API_KEY is not set' }

  try {
    const res = await fetch(SEND_TEXT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: apiKey,
      },
      body: JSON.stringify({
        to: e164(to),
        from: e164(from),
        messageId: crypto.randomUUID(),
        content: { text },
      }),
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return { ok: false, error: `DoubleTick ${res.status}: ${body.slice(0, 300)}` }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
