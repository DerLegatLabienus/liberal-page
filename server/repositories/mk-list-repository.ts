import { db } from '../db/client'
import { knessetMembersCache } from '../db/schema'
import type { KnessetMember } from '../../src/types'

export class MkListRepository {
  private cachedAt = 0

  async get(): Promise<KnessetMember[] | null> {
    const rows = await db.select().from(knessetMembersCache)
    if (rows.length === 0) return null
    this.cachedAt = rows[0].cachedAt.getTime()
    return rows.map((r) => ({
      siteId: r.siteId, name: r.name, party: r.party,
      photoUrl: r.photoUrl, isLiberal: r.isLiberal, isSupporter: r.isSupporter,
    }))
  }

  async set(members: KnessetMember[]): Promise<void> {
    const cachedAt = new Date()
    this.cachedAt = cachedAt.getTime()
    await db.transaction(async (tx) => {
      await tx.delete(knessetMembersCache)
      if (members.length) {
        await tx.insert(knessetMembersCache).values(members.map((m) => ({
          siteId: m.siteId, name: m.name, party: m.party,
          photoUrl: m.photoUrl, isLiberal: m.isLiberal, isSupporter: m.isSupporter, cachedAt,
        })))
      }
    })
  }

  getAgeMs(): number {
    return this.cachedAt ? Date.now() - this.cachedAt : Infinity
  }
}
