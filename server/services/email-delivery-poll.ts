import { getResend } from './email'
import { redactEmail } from './email-redaction'
import { SentEmailsRepository } from '../repositories/sent-emails-repository'

const sentRepo = new SentEmailsRepository()

// Statuses that won't change again — stop polling these. Everything else (sent, queued,
// scheduled, delivery_delayed) is still in-flight and worth re-checking.
export const TERMINAL_STATUSES = ['delivered', 'bounced', 'failed', 'suppressed', 'canceled', 'complained']

const RETENTION_DAYS = 30 // Resend stops returning email data after ~30 days
const THROTTLE_MS = 500    // stay within Resend's ~2 req/s default

function pollCap(): number {
  const v = Number(process.env.EMAIL_STATUS_POLL_CAP)
  return Number.isFinite(v) && v > 0 ? v : 100
}

/**
 * Pull Resend's delivery status for in-flight ledger rows and advance each row's last-known
 * status, logging (redacted) only when it changes. No-op without RESEND_API_KEY. The batch is
 * capped (default 100); a backlog larger than the cap logs a warning as an over-sampling
 * tripwire. Best-effort: a per-row failure is logged and skipped, never thrown.
 */
export async function pollDeliveryStatus(): Promise<void> {
  const resend = getResend()
  if (!resend) return

  const cap = pollCap()
  const sentAfter = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000)
  // Fetch cap+1 so a backlog larger than the cap is detectable.
  const rows = await sentRepo.listPollable(TERMINAL_STATUSES, sentAfter, cap + 1)
  if (rows.length > cap) {
    console.warn('[email] delivery poll: pollable backlog exceeds %d — capping (possible over-sampling bug)', cap)
  }
  const batch = rows.slice(0, cap)

  for (let i = 0; i < batch.length; i++) {
    const row = batch[i]
    try {
      const { data, error } = await resend.emails.get(row.id)
      if (error || !data) throw error ?? new Error('Resend returned no data')
      const event = (data as { last_event?: string }).last_event
      if (event && event !== row.status) {
        await sentRepo.setStatus(row.id, event, new Date())
        console.info(`[email] delivery event=${event} to=${redactEmail(row.toEmail)} msgId=${row.id}`)
      }
    } catch (err) {
      console.error('[email] delivery poll failed msgId=%s:', row.id, err)
    }
    if (i < batch.length - 1) await new Promise((r) => setTimeout(r, THROTTLE_MS))
  }
}
