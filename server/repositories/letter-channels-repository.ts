import { eq, inArray, sql } from 'drizzle-orm'
import { db } from '../db/client'
import { letterChannels } from '../db/schema'

export type LetterChannelRow = typeof letterChannels.$inferSelect

export interface LetterChannelInput {
  kind: 'email' | 'sms' | 'whatsapp'
  enabled?: boolean
  recipientIds: number[]
  ccIds?: number[]
  bccIds?: number[]
  bodyText: string
  subject?: string | null
  bodyHtml?: string | null
  templateId?: number | null
}

export class LetterChannelsRepository {
  async listByLetter(letterId: number): Promise<LetterChannelRow[]> {
    return db.select().from(letterChannels).where(eq(letterChannels.letterId, letterId)).orderBy(letterChannels.kind)
  }

  async listByLetterIds(letterIds: number[]): Promise<Map<number, LetterChannelRow[]>> {
    const map = new Map<number, LetterChannelRow[]>()
    if (letterIds.length === 0) return map
    const rows = await db.select().from(letterChannels).where(inArray(letterChannels.letterId, letterIds))
    for (const r of rows) {
      const list = map.get(r.letterId) ?? []
      list.push(r)
      map.set(r.letterId, list)
    }
    return map
  }

  /** Full replace: delete existing channels for the letter, insert the new set, in one transaction. */
  async replaceForLetter(letterId: number, channels: LetterChannelInput[]): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.delete(letterChannels).where(eq(letterChannels.letterId, letterId))
      if (channels.length === 0) return
      const now = new Date()
      await tx.insert(letterChannels).values(
        channels.map((c) => ({
          letterId,
          kind: c.kind,
          enabled: c.enabled ?? true,
          recipientIds: c.recipientIds ?? [],
          ccIds: c.ccIds ?? [],
          bccIds: c.bccIds ?? [],
          bodyText: c.bodyText ?? '',
          subject: c.subject ?? null,
          bodyHtml: c.bodyHtml ?? null,
          templateId: c.templateId ?? null,
          createdAt: now,
          updatedAt: now,
        })),
      )
    })
  }

  /** True if the contact id appears in any channel's recipient/cc/bcc arrays. */
  async contactReferenced(contactId: number): Promise<boolean> {
    const [row] = await db
      .select({ n: sql<number>`count(*)` })
      .from(letterChannels)
      .where(sql`
        ${letterChannels.recipientIds} @> ${JSON.stringify([contactId])}::jsonb OR
        ${letterChannels.ccIds}       @> ${JSON.stringify([contactId])}::jsonb OR
        ${letterChannels.bccIds}      @> ${JSON.stringify([contactId])}::jsonb
      `)
    return Number(row?.n ?? 0) > 0
  }
}
