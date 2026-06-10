import { eq } from 'drizzle-orm'
import { db } from '../db/client'
import { sentEmails } from '../db/schema'

export interface SentEmailRow {
  id: string; toEmail: string; template: string; subject: string
  status: string; error: string | null; createdAt: Date; updatedAt: Date
}

export class SentEmailsRepository {
  async record(input: { id: string; toEmail: string; template: string; subject: string; status: string; error?: string | null }): Promise<void> {
    const now = new Date()
    await db
      .insert(sentEmails)
      .values({ ...input, error: input.error ?? null, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({ target: sentEmails.id, set: { status: input.status, error: input.error ?? null, updatedAt: now } })
  }

  async updateStatus(id: string, status: string, error?: string | null): Promise<void> {
    await db
      .update(sentEmails)
      .set({ status, error: error ?? null, updatedAt: new Date() })
      .where(eq(sentEmails.id, id))
  }

  async get(id: string): Promise<SentEmailRow | null> {
    const [row] = await db.select().from(sentEmails).where(eq(sentEmails.id, id))
    return (row as SentEmailRow) ?? null
  }

  async list(limit = 50): Promise<SentEmailRow[]> {
    return db.select().from(sentEmails).limit(limit) as Promise<SentEmailRow[]>
  }
}
