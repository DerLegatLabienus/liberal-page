import { asc, inArray, sql } from 'drizzle-orm'
import { db } from '../db/client'
import { sentEmails } from '../db/schema'

export interface SentEmailRow { id: string; toEmail: string; template: string; status: string; error: string | null }

// Minimal send ledger. Rows are written once at send time and never updated (delivery
// lifecycle is logged only). deleteOldest is used by the storage-pressure reclaimer.
export class SentEmailsRepository {
  async record(r: { id: string; toEmail: string; template: string; status: 'sent' | 'failed'; error: string | null }): Promise<void> {
    await db
      .insert(sentEmails)
      .values({ id: r.id, toEmail: r.toEmail, template: r.template, status: r.status, error: r.error, createdAt: new Date() })
      .onConflictDoNothing()
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
