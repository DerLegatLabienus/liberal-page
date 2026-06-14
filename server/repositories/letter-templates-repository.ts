import { eq } from 'drizzle-orm'
import { db } from '../db/client'
import { letterTemplates } from '../db/schema'

export type LetterTemplate = typeof letterTemplates.$inferSelect

export class LetterTemplatesRepository {
  async list(): Promise<LetterTemplate[]> {
    return db.select().from(letterTemplates).orderBy(letterTemplates.name)
  }

  async getById(id: number): Promise<LetterTemplate | null> {
    const [row] = await db.select().from(letterTemplates).where(eq(letterTemplates.id, id))
    return row ?? null
  }

  async create(input: { name: string; html: string }): Promise<LetterTemplate> {
    const [row] = await db.insert(letterTemplates).values({ ...input, updatedAt: new Date() }).returning()
    return row
  }

  async update(id: number, input: { name?: string; html?: string }): Promise<void> {
    await db.update(letterTemplates).set({ ...input, updatedAt: new Date() }).where(eq(letterTemplates.id, id))
  }

  async delete(id: number): Promise<void> {
    await db.delete(letterTemplates).where(eq(letterTemplates.id, id))
  }
}
