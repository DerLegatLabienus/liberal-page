import { eq } from 'drizzle-orm'
import { db } from '../db/client'
import { letterIssueTags } from '../db/schema'

export type IssueTag = typeof letterIssueTags.$inferSelect

export class LetterIssueTagsRepository {
  async list(): Promise<IssueTag[]> {
    return db.select().from(letterIssueTags).orderBy(letterIssueTags.name)
  }

  async create(input: { name: string; slug: string }): Promise<IssueTag> {
    const [row] = await db.insert(letterIssueTags).values(input).returning()
    return row
  }

  async update(id: number, input: { name: string; slug: string }): Promise<void> {
    await db.update(letterIssueTags).set(input).where(eq(letterIssueTags.id, id))
  }

  async delete(id: number): Promise<void> {
    await db.delete(letterIssueTags).where(eq(letterIssueTags.id, id))
  }
}
