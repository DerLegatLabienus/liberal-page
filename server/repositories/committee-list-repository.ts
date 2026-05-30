import { db } from '../db/client'
import { knessetCommitteesCache } from '../db/schema'
import type { CommitteeListItem } from '../../src/types'

export class CommitteeListRepository {
  private cachedAt = 0

  async get(): Promise<CommitteeListItem[] | null> {
    const rows = await db.select().from(knessetCommitteesCache)
    if (rows.length === 0) return null
    this.cachedAt = rows[0].cachedAt.getTime()
    return rows.map((r) => ({ committeeId: r.committeeId, name: r.name, knessetUrl: r.knessetUrl }))
  }

  async set(committees: CommitteeListItem[]): Promise<void> {
    const cachedAt = new Date()
    this.cachedAt = cachedAt.getTime()
    await db.transaction(async (tx) => {
      await tx.delete(knessetCommitteesCache)
      if (committees.length) {
        await tx.insert(knessetCommitteesCache).values(committees.map((c) => ({
          committeeId: c.committeeId, name: c.name, knessetUrl: c.knessetUrl, cachedAt,
        })))
      }
    })
  }

  getAgeMs(): number {
    return this.cachedAt ? Date.now() - this.cachedAt : Infinity
  }
}
