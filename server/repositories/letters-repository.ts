import { eq, and, isNull, isNotNull, inArray, sql } from 'drizzle-orm'
import { db } from '../db/client'
import { letters, letterChannels } from '../db/schema'
import { LetterChannelsRepository } from './letter-channels-repository'
import type { Letter as LetterApi, LetterChannel } from '../../src/types'

export type Letter = typeof letters.$inferSelect
export type LetterCoreInput = {
  title: string
  issueTagIds?: number[]
  status?: string
  priority?: string
  pinnedAt?: Date | null
  pinNotifiedAt?: Date | null
  createdBy?: number | null
}

const PRIORITY_WEIGHT: Record<string, number> = { urgent: 3, high: 2, normal: 1 }
const channelsRepo = new LetterChannelsRepository()

function toApiChannel(r: typeof letterChannels.$inferSelect): LetterChannel {
  return {
    id: r.id, letterId: r.letterId, kind: r.kind as LetterChannel['kind'],
    enabled: r.enabled, recipientIds: r.recipientIds, ccIds: r.ccIds, bccIds: r.bccIds,
    bodyText: r.bodyText, subject: r.subject, bodyHtml: r.bodyHtml, templateId: r.templateId,
  }
}

/** Assemble API-shaped letters (shared fields + hydrated channels) from raw letter rows. */
export async function attachChannels(rows: Letter[]): Promise<LetterApi[]> {
  const byLetter = await channelsRepo.listByLetterIds(rows.map((r) => r.id))
  return rows.map((r) => ({
    id: r.id, title: r.title, shareSlug: r.shareSlug, issueTagIds: r.issueTagIds,
    status: r.status as LetterApi['status'], priority: r.priority as LetterApi['priority'],
    pinnedAt: r.pinnedAt?.toISOString() ?? null, activityScore: r.activityScore,
    publishedAt: r.publishedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
    channels: (byLetter.get(r.id) ?? []).map(toApiChannel),
  }))
}

export class LettersRepository {
  async listAll(): Promise<Letter[]> {
    return db.select().from(letters).orderBy(letters.createdAt)
  }

  async listPublished(tagIds?: number[]): Promise<Letter[]> {
    const conditions = [eq(letters.status, 'published')]
    if (tagIds && tagIds.length > 0) {
      // OR semantics: keep letters whose issue_tag_ids JSONB array contains ANY requested tag.
      // jsonb_array_elements_text yields each element as text, so compare against the ids as
      // strings (the column stores numbers). Pushed to SQL so the DB does the filtering.
      const inList = sql.join(tagIds.map((t) => sql`${String(t)}`), sql`, `)
      conditions.push(
        sql`EXISTS (SELECT 1 FROM jsonb_array_elements_text(${letters.issueTagIds}) AS e(val) WHERE e.val IN (${inList}))`,
      )
    }
    const rows = await db.select().from(letters).where(and(...conditions))
    return rows.sort((a, b) => {
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

  async createCore(input: LetterCoreInput): Promise<Letter> {
    const now = new Date()
    const status = input.status ?? 'draft'
    const [row] = await db
      .insert(letters)
      .values({
        title: input.title,
        issueTagIds: input.issueTagIds ?? [],
        status,
        priority: input.priority ?? 'normal',
        pinnedAt: input.pinnedAt ?? null,
        pinNotifiedAt: input.pinNotifiedAt ?? null,
        // Stamp publishedAt when a letter is born published; drafts get it on first publish.
        publishedAt: status === 'published' ? now : null,
        createdBy: input.createdBy ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
    return row
  }

  async updateCore(id: number, input: Partial<LetterCoreInput>): Promise<void> {
    const fields: Record<string, unknown> = { ...input, updatedAt: new Date() }
    // Stamp publishedAt only on the transition into published — never overwrite an existing
    // publish date (editing an already-published letter must not bump it forward).
    if (input.status === 'published') {
      const [current] = await db
        .select({ publishedAt: letters.publishedAt })
        .from(letters)
        .where(eq(letters.id, id))
      if (current && current.publishedAt == null) fields.publishedAt = new Date()
    }
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
    if (ids.length === 0) return
    await db.update(letters).set({ pinNotifiedAt: new Date() }).where(inArray(letters.id, ids))
  }
}
