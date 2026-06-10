import { eq } from 'drizzle-orm'
import { db } from '../db/client'
import { emailTemplates } from '../db/schema'

export interface EmailTemplate { name: string; subject: string; html: string; updatedAt: Date }

const TTL_MS = 5 * 60 * 1000

export class EmailTemplatesRepository {
  private cache = new Map<string, { value: EmailTemplate | null; at: number }>()

  _resetCache(): void { this.cache.clear() }

  async getAll(): Promise<EmailTemplate[]> {
    return db.select().from(emailTemplates)
  }

  async get(name: string): Promise<EmailTemplate | null> {
    const hit = this.cache.get(name)
    if (hit && Date.now() - hit.at < TTL_MS) return hit.value
    const [row] = await db.select().from(emailTemplates).where(eq(emailTemplates.name, name))
    const value = row ?? null
    this.cache.set(name, { value, at: Date.now() })
    return value
  }

  async update(name: string, fields: { subject: string; html: string }): Promise<void> {
    const now = new Date()
    await db
      .insert(emailTemplates)
      .values({ name, subject: fields.subject, html: fields.html, updatedAt: now })
      .onConflictDoUpdate({ target: emailTemplates.name, set: { subject: fields.subject, html: fields.html, updatedAt: now } })
    this.cache.delete(name)
  }
}
