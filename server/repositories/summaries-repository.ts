import { eq, desc, lt } from 'drizzle-orm'
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

  /**
   * Look up the newest cached summary by its source URL — lets callers skip re-downloading a
   * document just to compute its MD5 cache key. Knesset document URLs are stable, so a hit is
   * served without a fetch; if a doc's content ever changes at the same URL the cached summary
   * is reused until the row is deleted (deleteBySourceUrl) — acceptable for this domain.
   */
  async getBySourceUrl(url: string): Promise<SummaryEntry | null> {
    const rows = await db
      .select()
      .from(summariesCache)
      .where(eq(summariesCache.sourceUrl, url))
      .orderBy(desc(summariesCache.createdAt))
      .limit(1)
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

  /** Deletes cached summaries for a given source document URL. No-op on null/empty. */
  async deleteBySourceUrl(url: string | null | undefined): Promise<number> {
    if (!url) return 0
    const deleted = await db
      .delete(summariesCache)
      .where(eq(summariesCache.sourceUrl, url))
      .returning({ md5: summariesCache.md5 })
    return deleted.length
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

  /** Hygiene: delete summaries older than `cutoff` so the cache doesn't grow unbounded. They
   *  regenerate on next access (cheap with the URL short-circuit). Returns rows removed. */
  async deleteOlderThan(cutoff: Date): Promise<number> {
    const deleted = await db
      .delete(summariesCache)
      .where(lt(summariesCache.createdAt, cutoff))
      .returning({ md5: summariesCache.md5 })
    return deleted.length
  }
}
