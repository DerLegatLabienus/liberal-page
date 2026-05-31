import { and, eq } from 'drizzle-orm'
import { db } from '../db/client'
import { trackedMks } from '../db/schema'
import { MksRepository } from './mks-repository'
import type { Mk } from '../../src/types'

export class TrackedMksRepository {
  private mks = new MksRepository()

  async getAll(userId: number, currentKnesset: number): Promise<Mk[]> {
    const tracks = await db.select().from(trackedMks).where(eq(trackedMks.userId, userId))
    const out: Mk[] = []
    for (const t of tracks) {
      const m = await this.mks.getById(t.mkId, currentKnesset)
      if (m) out.push(m)
    }
    return out
  }

  async track(userId: number, mkId: number): Promise<void> {
    await db
      .insert(trackedMks)
      .values({ userId, mkId, createdAt: new Date() })
      .onConflictDoNothing({ target: [trackedMks.userId, trackedMks.mkId] })
  }

  async untrack(userId: number, mkId: number): Promise<void> {
    await db.delete(trackedMks).where(and(eq(trackedMks.userId, userId), eq(trackedMks.mkId, mkId)))
  }

  async isTracked(userId: number, mkId: number): Promise<boolean> {
    const rows = await db.select().from(trackedMks).where(and(eq(trackedMks.userId, userId), eq(trackedMks.mkId, mkId)))
    return rows.length > 0
  }
}
