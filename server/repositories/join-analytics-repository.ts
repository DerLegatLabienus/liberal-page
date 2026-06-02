import { sql, and, ne, lt } from 'drizzle-orm'
import { db } from '../db/client'
import { joinAnalytics } from '../db/schema'

export const JOIN_STATUSES = ['new', 'renewal', 'existing'] as const
export const JOIN_MODES = ['individual', 'couple'] as const
export type JoinStatus = (typeof JOIN_STATUSES)[number]
export type JoinMode = (typeof JOIN_MODES)[number]

const DAY_WINDOW_DAYS = 365
const LIFETIME = 'lifetime'

/**
 * Single-table Join click-through analytics. Each call to `record` bumps the current
 * day's row and the all-time `lifetime` row, then prunes day rows outside the 1-year
 * sliding window. Isolated from business logic — the only consumer of `join_analytics`.
 */
export class JoinAnalyticsRepository {
  /** Returns false (writing nothing) if status/mode are not valid options. */
  async record(status: string, mode: string, now: Date = new Date()): Promise<boolean> {
    if (!JOIN_STATUSES.includes(status as JoinStatus)) return false
    if (!JOIN_MODES.includes(mode as JoinMode)) return false

    const combo = `${status}:${mode}`
    const day = now.toISOString().slice(0, 10)
    await this.bump(day, combo, now)
    await this.bump(LIFETIME, combo, now)
    await this.pruneOldDays(now)
    return true
  }

  /** Deletes day rows older than the sliding window; the lifetime row is never pruned. */
  async pruneOldDays(now: Date = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - DAY_WINDOW_DAYS * 86_400_000)
      .toISOString()
      .slice(0, 10)
    const deleted = await db
      .delete(joinAnalytics)
      .where(and(ne(joinAnalytics.bucket, LIFETIME), lt(joinAnalytics.bucket, cutoff)))
      .returning({ bucket: joinAnalytics.bucket })
    return deleted.length
  }

  private async bump(bucket: string, combo: string, now: Date): Promise<void> {
    await db
      .insert(joinAnalytics)
      .values({ bucket, total: 1, breakdown: { [combo]: 1 }, createdAt: now })
      .onConflictDoUpdate({
        target: joinAnalytics.bucket,
        set: {
          total: sql`${joinAnalytics.total} + 1`,
          breakdown: sql`jsonb_set(
            ${joinAnalytics.breakdown},
            ARRAY[${combo}],
            to_jsonb(COALESCE((${joinAnalytics.breakdown} ->> ${combo})::int, 0) + 1)
          )`,
        },
      })
  }
}
