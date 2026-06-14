import { eq, and, isNull, isNotNull, sql } from 'drizzle-orm'
import { db } from '../db/client'
import { letters } from '../db/schema'
import type { LetterAddress } from '../db/schema'

export type Letter = typeof letters.$inferSelect
export type LetterInput = {
  title: string
  subject: string
  bodyHtml: string
  bodyPlain: string
  toAddresses: LetterAddress[]
  ccAddresses?: LetterAddress[]
  bccAddresses?: LetterAddress[]
  issueTagIds?: number[]
  templateId?: number | null
  status?: string
  priority?: string
  pinnedAt?: Date | null
  pinNotifiedAt?: Date | null
  createdBy?: number | null
}

const PRIORITY_WEIGHT: Record<string, number> = { urgent: 3, high: 2, normal: 1 }

export class LettersRepository {
  async listAll(): Promise<Letter[]> {
    return db.select().from(letters).orderBy(letters.createdAt)
  }

  async listPublished(tagIds?: number[]): Promise<Letter[]> {
    const rows = await db.select().from(letters).where(eq(letters.status, 'published'))
    const filtered = tagIds && tagIds.length > 0
      ? rows.filter((l) => {
          const ids = l.issueTagIds as number[]
          return tagIds.some((t) => ids.includes(t))
        })
      : rows
    return filtered.sort((a, b) => {
      const aPin = a.pinnedAt ? 1 : 0
      const bPin = b.pinnedAt ? 1 : 0
      if (aPin !== bPin) return bPin - aPin
      const aScore = (PRIORITY_WEIGHT[a.priority] ?? 1) * 1000 + a.activityScore
      const bScore = (PRIORITY_WEIGHT[b.priority] ?? 1) * 1000 + b.activityScore
      if (aScore !== bScore) return bScore - aScore
      const aDate = a.publishedAt?.getTime() ?? 0
      const bDate = b.publishedAt?.getTime() ?? 0
      return bDate - aDate
    })
  }

  async getById(id: number): Promise<Letter | null> {
    const [row] = await db.select().from(letters).where(eq(letters.id, id))
    return row ?? null
  }

  async create(input: LetterInput): Promise<Letter> {
    const now = new Date()
    const [row] = await db
      .insert(letters)
      .values({
        title: input.title,
        subject: input.subject,
        bodyHtml: input.bodyHtml,
        bodyPlain: input.bodyPlain,
        toAddresses: input.toAddresses,
        ccAddresses: input.ccAddresses ?? [],
        bccAddresses: input.bccAddresses ?? [],
        issueTagIds: input.issueTagIds ?? [],
        templateId: input.templateId ?? null,
        status: input.status ?? 'draft',
        priority: input.priority ?? 'normal',
        pinnedAt: input.pinnedAt ?? null,
        pinNotifiedAt: input.pinNotifiedAt ?? null,
        createdBy: input.createdBy ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
    return row
  }

  async update(id: number, input: Partial<LetterInput>): Promise<void> {
    const fields: Record<string, unknown> = { ...input, updatedAt: new Date() }
    if (input.status === 'published') fields.publishedAt = new Date()
    await db.update(letters).set(fields).where(eq(letters.id, id))
  }

  async delete(id: number): Promise<void> {
    await db.delete(letters).where(eq(letters.id, id))
  }

  async setPinned(id: number, pinned: boolean): Promise<void> {
    await db
      .update(letters)
      .set({ pinnedAt: pinned ? new Date() : null, pinNotifiedAt: null, updatedAt: new Date() })
      .where(eq(letters.id, id))
  }

  async incrementActivityScore(id: number): Promise<void> {
    await db
      .update(letters)
      .set({ activityScore: sql`${letters.activityScore} + 1`, updatedAt: new Date() })
      .where(eq(letters.id, id))
  }

  async listUnnotifiedPinned(): Promise<Letter[]> {
    return db
      .select()
      .from(letters)
      .where(and(isNotNull(letters.pinnedAt), isNull(letters.pinNotifiedAt)))
  }

  async markPinNotified(ids: number[]): Promise<void> {
    for (const id of ids) {
      await db.update(letters).set({ pinNotifiedAt: new Date() }).where(eq(letters.id, id))
    }
  }
}
