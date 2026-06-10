import { Router, raw } from 'express'
import { Webhook } from 'svix'
import { redactEmail } from '../services/email-redaction'

const router = Router()

// Resend delivery webhook. Raw body is required for svix signature verification, so this
// route parses its own raw body and is mounted BEFORE the global express.json() middleware.
// It LOGS ONLY (redacted) and stores nothing.
router.post('/resend', raw({ type: '*/*' }), (req, res) => {
  const secret = process.env.RESEND_WEBHOOK_SECRET ?? ''
  const payload = req.body instanceof Buffer ? req.body.toString('utf8') : String(req.body ?? '')
  let event: { type?: string; data?: { email_id?: string; to?: string[] } }
  try {
    event = new Webhook(secret).verify(payload, {
      'svix-id': String(req.headers['svix-id'] ?? ''),
      'svix-timestamp': String(req.headers['svix-timestamp'] ?? ''),
      'svix-signature': String(req.headers['svix-signature'] ?? ''),
    }) as typeof event
  } catch {
    return res.status(400).json({ error: 'invalid signature' })
  }

  const eventName = (event.type ?? 'unknown').replace('email.', '')
  const to = event.data?.to?.[0] ?? ''
  const msgId = event.data?.email_id ?? ''
  console.info(`[email] delivery event=${eventName} to=${redactEmail(to)} msgId=${msgId}`)
  res.status(200).json({ ok: true })
})

export default router
