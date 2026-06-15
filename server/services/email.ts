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

const BATCH_MAX = 100

// Ledger write is best-effort and must never throw or block the batch. Promise.resolve wraps
// the repo result so this is safe even if record() is synchronous/mocked.
function recordSafe(r: Parameters<SentEmailsRepository['record']>[0]): Promise<void> {
  return Promise.resolve(getSentRepo().record(r)).catch(() => {})
}

export interface BatchOutcome { sent: number; failed: number; skipped: number }

/**
 * Send many emails via Resend's batch API — one request per ≤100 messages instead of the
 * sequential 500ms-spaced loop, so a broadcast no longer blocks the poll cycle for ~N/2 s and
 * the crash window (mid-broadcast restart → duplicates) shrinks to a single request. Renders
 * each message, records the ledger, never throws. Returns counts so callers can decide whether
 * to mark a broadcast as delivered (e.g. only stamp pin_notified_at when sent > 0).
 */
export async function sendEmailsBatch(messages: SendArgs[]): Promise<BatchOutcome> {
  const outcome: BatchOutcome = { sent: 0, failed: 0, skipped: 0 }
  if (messages.length === 0) return outcome

  // Render up front; a render failure is a per-message failure (recorded), never a throw.
  type Prepared = { to: string; template: string; subject: string; html: string }
  const prepared: Prepared[] = []
  for (const m of messages) {
    try {
      const r = await renderTemplate(m.template, m.params, { raw: m.raw })
      prepared.push({ to: m.to, template: m.template, subject: r.subject, html: r.html })
    } catch (err) {
      console.error('[email] batch render failed template=%s to=%s', m.template, redactEmail(m.to), err)
      await recordSafe({ id: `failed:${randomUUID()}`, toEmail: m.to, template: m.template, status: 'failed', error: String(err) })
      outcome.failed++
    }
  }

  const resend = getResend()
  if (!resend) {
    console.warn('[email] RESEND_API_KEY unset — skipping batch of %d', prepared.length)
    outcome.skipped += prepared.length
    return outcome
  }
  const from = process.env.EMAIL_FROM ?? ''

  for (let i = 0; i < prepared.length; i += BATCH_MAX) {
    const chunk = prepared.slice(i, i + BATCH_MAX)
    try {
      const { data, error } = await resend.batch.send(
        chunk.map((c) => ({ from, to: c.to, subject: c.subject, html: c.html })),
      )
      if (error || !data) throw error ?? new Error('Resend batch returned no data')
      const ids = (data as { data?: { id: string }[] }).data ?? []
      chunk.forEach((c, idx) => {
        outcome.sent++
        const id = ids[idx]?.id ?? `sent:${randomUUID()}`
        void recordSafe({ id, toEmail: c.to, template: c.template, status: 'sent', error: null })
      })
      console.info('[email] batch sent %d messages', chunk.length)
    } catch (err) {
      console.error('[email] batch send failed for %d messages', chunk.length, err)
      for (const c of chunk) {
        outcome.failed++
        await recordSafe({ id: `failed:${randomUUID()}`, toEmail: c.to, template: c.template, status: 'failed', error: String(err) })
      }
    }
  }
  return outcome
}
