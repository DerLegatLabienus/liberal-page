import { and, eq } from 'drizzle-orm'
import { db } from '../db/client'
import { trackedCommittees } from '../db/schema'
import { CommitteesRepository } from './committees-repository'
import type { Committee } from '../../src/types'

export class TrackedCommitteesRepository {
  private committees = new CommitteesRepository()

  async getAll(userId: number): Promise<Committee[]> {
    const tracks = await db.select({ committeeId: trackedCommittees.committeeId }).from(trackedCommittees).where(eq(trackedCommittees.userId, userId))
    return this.committees.getByIds(tracks.map((t) => t.committeeId))
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
