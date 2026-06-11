import { and, asc, eq, gt, inArray, notInArray, sql } from 'drizzle-orm'
import { db } from '../db/client'
import { sentEmails } from '../db/schema'

export interface SentEmailRow { id: string; toEmail: string; template: string; status: string; error: string | null }
export interface PollableRow { id: string; toEmail: string; status: string }

// Send ledger. Rows are written at send time; the poller advances `status` (last known
// Resend delivery status) and `lastStatusAt`. deleteOldest is used by the storage reclaimer.
export class SentEmailsRepository {
  async record(r: { id: string; toEmail: string; template: string; status: 'sent' | 'failed'; error: string | null }): Promise<void> {
    const now = new Date()
    await db
      .insert(sentEmails)
      .values({ id: r.id, toEmail: r.toEmail, template: r.template, status: r.status, error: r.error, createdAt: now, lastStatusAt: now })
      .onConflictDoNothing()
  }

  /** Advance the last-known delivery status (and its observation time) for one ledger row. */
  async setStatus(id: string, status: string, at: Date): Promise<void> {
    await db.update(sentEmails).set({ status, lastStatusAt: at }).where(eq(sentEmails.id, id))
  }

  /**
   * Rows whose delivery status is still non-terminal and worth re-checking: status not in
   * `terminalStatuses`, sent after `sentAfter` (Resend's retention floor). Oldest-first so the
   * stalest in-flight rows are resolved first; capped at `limit`.
   */
  async listPollable(terminalStatuses: string[], sentAfter: Date, limit: number): Promise<PollableRow[]> {
    if (limit <= 0) return []
    const rows = await db
      .select({ id: sentEmails.id, toEmail: sentEmails.toEmail, status: sentEmails.status })
      .from(sentEmails)
      .where(and(notInArray(sentEmails.status, terminalStatuses), gt(sentEmails.createdAt, sentAfter)))
      .orderBy(asc(sentEmails.createdAt))
      .limit(limit)
    return rows
  }

  async deleteOldest(limit: number): Promise<number> {
    if (limit <= 0) return 0
    const rows = await db.select({ id: sentEmails.id }).from(sentEmails).orderBy(asc(sentEmails.createdAt)).limit(limit)
    if (rows.length === 0) return 0
    await db.delete(sentEmails).where(inArray(sentEmails.id, rows.map((r) => r.id)))
    return rows.length
  }

  async count(): Promise<number> {
    const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(sentEmails)
    return row?.n ?? 0
  }

  async list(limit: number): Promise<SentEmailRow[]> {
    const rows = await db.select().from(sentEmails).orderBy(asc(sentEmails.createdAt)).limit(limit)
    return rows.map((r) => ({ id: r.id, toEmail: r.toEmail, template: r.template, status: r.status, error: r.error }))
  }
}
