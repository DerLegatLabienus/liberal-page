import { and, eq } from 'drizzle-orm'
import { db } from '../db/client'
import { trackedCommittees } from '../db/schema'
import { CommitteesRepository } from './committees-repository'
import type { Committee } from '../../src/types'

export class TrackedCommitteesRepository {
  private committees = new CommitteesRepository()

  async getAll(userId: number): Promise<Committee[]> {
    const tracks = await db.select().from(trackedCommittees).where(eq(trackedCommittees.userId, userId))
    const out: Committee[] = []
    for (const t of tracks) {
      const c = await this.committees.getById(t.committeeId)
      if (c) out.push(c)
    }
    return out
  }

  async track(userId: number, committeeId: number): Promise<void> {
    await db
      .insert(trackedCommittees)
      .values({ userId, committeeId, createdAt: new Date() })
      .onConflictDoNothing({ target: [trackedCommittees.userId, trackedCommittees.committeeId] })
  }

  async untrack(userId: number, committeeId: number): Promise<void> {
    await db.delete(trackedCommittees).where(and(eq(trackedCommittees.userId, userId), eq(trackedCommittees.committeeId, committeeId)))
  }

  async isTracked(userId: number, committeeId: number): Promise<boolean> {
    const rows = await db.select().from(trackedCommittees).where(and(eq(trackedCommittees.userId, userId), eq(trackedCommittees.committeeId, committeeId)))
    return rows.length > 0
  }
}
