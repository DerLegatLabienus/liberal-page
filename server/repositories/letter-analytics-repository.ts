import { sql, and, eq, ne, lt } from 'drizzle-orm'
import { db } from '../db/client'
import { letterAnalytics } from '../db/schema'

const DAY_WINDOW_DAYS = 365
const LIFETIME = 'lifetime'

export type LetterAnalyticsRow = typeof letterAnalytics.$inferSelect

export class LetterAnalyticsRepository {
  async record(letterId: number, action: 'mailto' | 'copy', now: Date = new Date()): Promise<void> {
    const day = now.toISOString().slice(0, 10)
    await this.bump(letterId, day, action, now)
    await this.bump(letterId, LIFETIME, action, now)
    await this.pruneOldDays(letterId, now)
  }

  async getForLetter(letterId: number): Promise<{ lifetime: LetterAnalyticsRow | null; daily: LetterAnalyticsRow[] }> {
    const rows = await db.select().from(letterAnalytics).where(eq(letterAnalytics.letterId, letterId))
    const lifetime = rows.find((r) => r.bucket === LIFETIME) ?? null
    const daily = rows
      .filter((r) => r.bucket !== LIFETIME)
      .sort((a, b) => b.bucket.localeCompare(a.bucket))
    return { lifetime, daily }
  }

  private async bump(letterId: number, bucket: string, action: string, now: Date): Promise<void> {
    await db
      .insert(letterAnalytics)
      .values({ letterId, bucket, total: 1, breakdown: { [action]: 1 }, createdAt: now })
      .onConflictDoUpdate({
        target: [letterAnalytics.letterId, letterAnalytics.bucket],
        set: {
          total: sql`${letterAnalytics.total} + 1`,
          breakdown: sql`jsonb_set(
            ${letterAnalytics.breakdown},
            ARRAY[${action}],
            to_jsonb(COALESCE((${letterAnalytics.breakdown} ->> ${action})::int, 0) + 1)
          )`,
        },
      })
  }

  private async pruneOldDays(letterId: number, now: Date): Promise<void> {
    const cutoff = new Date(now.getTime() - DAY_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10)
    await db
      .delete(letterAnalytics)
      .where(and(
        eq(letterAnalytics.letterId, letterId),
        ne(letterAnalytics.bucket, LIFETIME),
        lt(letterAnalytics.bucket, cutoff),
      ))
  }
}
