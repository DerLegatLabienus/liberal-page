import { eq } from 'drizzle-orm'
import { db } from '../db/client'
import { summariesCache } from '../db/schema'

export interface SummaryEntry {
  summary: string
  createdAt: string
  sourceUrl: string
  attendees?: string[]
  derivedTitle?: string
}

export class SummariesRepository {
  async get(md5: string): Promise<SummaryEntry | null> {
    const rows = await db.select().from(summariesCache).where(eq(summariesCache.md5, md5))
    const row = rows[0]
    if (!row) return null
    return {
      summary: row.summary,
      createdAt: row.createdAt.toISOString(),
      sourceUrl: row.sourceUrl,
      attendees: row.attendees ?? undefined,
      derivedTitle: row.derivedTitle ?? undefined,
    }
  }

  async set(md5: string, entry: SummaryEntry): Promise<void> {
    await db
      .insert(summariesCache)
      .values({
        md5, summary: entry.summary, createdAt: new Date(entry.createdAt),
        sourceUrl: entry.sourceUrl, attendees: entry.attendees ?? null, derivedTitle: entry.derivedTitle ?? null,
      })
      .onConflictDoUpdate({
        target: summariesCache.md5,
        set: { summary: entry.summary, createdAt: new Date(entry.createdAt), sourceUrl: entry.sourceUrl, attendees: entry.attendees ?? null, derivedTitle: entry.derivedTitle ?? null },
      })
  }
}
