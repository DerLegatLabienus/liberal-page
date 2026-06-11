import { Resend } from 'resend'
import { randomUUID } from 'crypto'
import { renderTemplate } from './email-render'
import { redactEmail } from './email-redaction'
import { SentEmailsRepository } from '../repositories/sent-emails-repository'

let sentRepo: SentEmailsRepository | null = null

function getSentRepo(): SentEmailsRepository {
  if (!sentRepo) sentRepo = new SentEmailsRepository()
  return sentRepo
}

let client: Resend | null = null
let inited = false

/** Test-only: forget the lazily-built client so env changes take effect. */
export function _resetResend(): void { client = null; inited = false; sentRepo = null }

export function getResend(): Resend | null {
  if (!inited) {
    inited = true
    const key = process.env.RESEND_API_KEY
    client = key ? new Resend(key) : null
  }
  return client
}

export interface SendArgs {
  to: string
  template: string
  params: Record<string, string>
  raw?: string[]
}

const THROTTLE_MS = 500

// Outcome of a send attempt. `skipped` = email not configured (RESEND_API_KEY unset) — not an
// error. `failed` = configured but the render or Resend send failed (the email did not go out).
export type SendResult =
  | { status: 'sent'; id: string }
  | { status: 'skipped' }
  | { status: 'failed'; error: string }

/**
 * Attempt to send one email. Never throws — it reports the outcome so callers can decide
 * (e.g. the invite route fails atomically on `failed`). Records a ledger row; logs redacted.
 */
export async function sendEmail(args: SendArgs): Promise<SendResult> {
  const { to, template, params, raw } = args
  let rendered: { subject: string; html: string }
  try {
    rendered = await renderTemplate(template, params, { raw })
  } catch (err) {
    console.error('[email] render failed template=%s to=%s', template, redactEmail(to), err)
    return { status: 'failed', error: String(err) }
  }
  const resend = getResend()
  if (!resend) {
    console.warn('[email] RESEND_API_KEY unset — skipping send template=%s to=%s', template, redactEmail(to))
    return { status: 'skipped' }
  }
  try {
    const { data, error } = await resend.emails.send({
      from: process.env.EMAIL_FROM ?? '', to, subject: rendered.subject, html: rendered.html,
    })
    if (error || !data) throw error ?? new Error('Resend returned no data')
    await getSentRepo().record({ id: data.id, toEmail: to, template, status: 'sent', error: null })
    console.info('[email] sent template=%s to=%s msgId=%s', template, redactEmail(to), data.id)
    return { status: 'sent', id: data.id }
  } catch (err) {
    console.error('[email] send failed template=%s to=%s', template, redactEmail(to), err)
    try {
      await getSentRepo().record({ id: `failed:${randomUUID()}`, toEmail: to, template, status: 'failed', error: String(err) })
    } catch { /* best-effort */ }
    return { status: 'failed', error: String(err) }
  }
}

/** Send sequentially, spaced to respect Resend's 2 req/s default. */
export async function sendEmailsThrottled(messages: SendArgs[]): Promise<void> {
  for (let i = 0; i < messages.length; i++) {
    await sendEmail(messages[i])
    if (i < messages.length - 1) await new Promise((r) => setTimeout(r, THROTTLE_MS))
  }
}
