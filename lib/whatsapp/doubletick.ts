import https from 'https'

const SEND_TEXT_URL = 'https://public.doubletick.io/whatsapp/message/text'

export type SendResult = { ok: boolean; error?: string }

function e164(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  return digits ? `+${digits}` : phone
}

export async function sendTextMessage(to: string, from: string, text: string): Promise<SendResult> {
  const apiKey = process.env.DOUBLETICK_API_KEY
  if (!apiKey) return { ok: false, error: 'DOUBLETICK_API_KEY is not set' }

  const payload = JSON.stringify({
    to: e164(to),
    from: e164(from),
    messageId: crypto.randomUUID(),
    content: { text },
  })

  return new Promise((resolve) => {
    const req = https.request(SEND_TEXT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': apiKey,
        'Content-Length': Buffer.byteLength(payload),
      },
    }, (res) => {
      let body = ''
      res.on('data', chunk => body += chunk)
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ ok: true })
        } else {
          resolve({ ok: false, error: `DoubleTick ${res.statusCode}: ${body.slice(0, 300)}` })
        }
      })
    })

    req.on('error', (err) => {
      resolve({ ok: false, error: err.message })
    })

    req.write(payload)
    req.end()
  })
}
