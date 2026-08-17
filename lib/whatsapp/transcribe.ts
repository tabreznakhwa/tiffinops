// Whisper transcription for WhatsApp voice notes.
//
// Flow: download the audio from DoubleTick's media URL (same https.request
// pattern that fixed the 403 on outbound sends â€” fetch/undici gets WAF-blocked)
// then POST it to OpenAI's Whisper endpoint as multipart/form-data.
//
// Hinglish note: we intentionally leave the `language` field unset so Whisper
// auto-detects. On mixed Hindi/Urdu/English voice notes that works better than
// pinning a single language.

import fs from 'fs'
import os from 'os'
import path from 'path'
import crypto from 'crypto'
import https from 'https'
import FormData from 'form-data'

export type TranscribeOutcome =
  | { ok: true; text: string }
  | { ok: false; error: string; retryable: boolean }

/** DoubleTick media URLs need the same API-key auth as every other call. */
function downloadMedia(url: string, destPath: string): Promise<void> {
  const apiKey = process.env.DOUBLETICK_API_KEY
  if (!apiKey) return Promise.reject(new Error('DOUBLETICK_API_KEY is not set'))

  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath)

    https
      .get(
        url,
        { headers: { Authorization: apiKey } },
        (res) => {
          if (res.statusCode !== 200) {
            file.close()
            fs.unlink(destPath, () => {})
            return reject(new Error(`Failed to download media: HTTP ${res.statusCode}`))
          }
          res.pipe(file)
          file.on('finish', () => file.close(() => resolve()))
        },
      )
      .on('error', (err) => {
        file.close()
        fs.unlink(destPath, () => {})
        reject(err)
      })
  })
}

/**
 * Transcribe a WhatsApp voice note to text.
 *
 * @param mediaUrl  Signed URL from the DoubleTick webhook payload.
 * @param mimeType  Content type from the payload, e.g. "audio/ogg".
 */
export async function transcribeAudio(mediaUrl: string, mimeType: string): Promise<TranscribeOutcome> {
  const openaiKey = process.env.OPENAI_API_KEY
  if (!openaiKey) {
    return { ok: false, error: 'OPENAI_API_KEY is not set', retryable: false }
  }

  // Extension matters to Whisper. WhatsApp voice notes are Ogg/Opus; media
  // messages that arrive as .m4a are audio/mp4. Fall back to .ogg otherwise.
  const extension = mimeType.includes('mp4') || mimeType.includes('m4a')
    ? 'm4a'
    : mimeType.includes('mpeg') || mimeType.includes('mp3')
      ? 'mp3'
      : 'ogg'
  const tempFile = path.join(os.tmpdir(), `whatsapp-voice-${crypto.randomUUID()}.${extension}`)

  try {
    await downloadMedia(mediaUrl, tempFile)

    const form = new FormData()
    form.append('file', fs.createReadStream(tempFile))
    form.append('model', 'whisper-1')
    // Bias Whisper towards the kitchen vocabulary. "prompt" is a hint, not a
    // hard constraint â€” correct guesses are retained, wrong ones dropped.
    form.append('prompt', 'Indian Hinglish food delivery order. Menu words: dal tadka, rumali roti, moti roti, kheema, korma, white rice, bhej dena, aaj, kal, lunch, dinner.')

    const body = await new Promise<string>((resolve, reject) => {
      const req = https.request('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          ...form.getHeaders(),
          Authorization: `Bearer ${openaiKey}`,
        },
      }, (res) => {
        let b = ''
        res.on('data', (chunk) => (b += chunk))
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve(b)
          } else {
            reject(new Error(`Whisper API ${res.statusCode}: ${b.slice(0, 300)}`))
          }
        })
      })
      req.on('error', reject)
      form.pipe(req)
    })

    const parsed = JSON.parse(body) as { text?: string }
    if (!parsed.text || !parsed.text.trim()) {
      return { ok: false, error: 'Whisper returned empty transcription', retryable: false }
    }
    return { ok: true, text: parsed.text.trim() }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const retryable =
      msg.includes('ECONNRESET') || msg.includes('ETIMEDOUT') || msg.includes('socket hang up')
    return { ok: false, error: msg, retryable }
  } finally {
    if (fs.existsSync(tempFile)) {
      try { fs.unlinkSync(tempFile) } catch { /* temp dir cleanup is best-effort */ }
    }
  }
}
