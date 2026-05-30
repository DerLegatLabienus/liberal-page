import { eq, asc } from 'drizzle-orm'
import { db } from '../db/client'
import { committees, committeeSessions } from '../db/schema'
import type { Committee, CommitteeSession } from '../../src/types'

export interface CommitteeInput {
  oknesset_id: string
  name: string
  chair: string
  lastSessionDate: string | null
  lastSessionSummary: string | null
  lastSessionDocumentUrl: string | null
  sourceUrl: string
  hasNewData: boolean
  lastPolledAt: string | null
  recentSessions: CommitteeSession[]
}

export class CommitteesRepository {
  async upsert(input: CommitteeInput, id?: number): Promise<number> {
    return db.transaction(async (tx) => {
      const values = {
        oknessetId: input.oknesset_id,
        name: input.name,
        chair: input.chair,
        lastSessionDate: input.lastSessionDate ? new Date(input.lastSessionDate) : null,
        lastSessionSummary: input.lastSessionSummary,
        lastSessionDocumentUrl: input.lastSessionDocumentUrl,
        sourceUrl: input.sourceUrl,
        hasNewData: input.hasNewData,
        lastPolledAt: input.lastPolledAt ? new Date(input.lastPolledAt) : null,
      }
      let committeeId = id
      if (committeeId) {
        await tx.update(committees).set(values).where(eq(committees.id, committeeId))
      } else {
        const [row] = await tx.insert(committees).values(values).returning({ id: committees.id })
        committeeId = row.id
      }
      await tx.delete(committeeSessions).where(eq(committeeSessions.committeeId, committeeId))
      if (input.recentSessions.length > 0) {
        await tx.insert(committeeSessions).values(
          input.recentSessions.map((s) => ({
            sessionId: s.sessionId,
            committeeId: committeeId!,
            date: new Date(s.date),
            knessetNum: s.knessetNum,
            title: s.title,
            sessionUrl: s.sessionUrl,
            attendingSiteIds: s.attendingSiteIds,
            aiSummary: s.aiSummary ?? null,
          })),
        )
      }
      return committeeId
    })
  }

  async getById(id: number): Promise<Committee | null> {
    const rows = await db.select().from(committees).where(eq(committees.id, id))
    const row = rows[0]
    if (!row) return null
    const sessions = await db.select().from(committeeSessions).where(eq(committeeSessions.committeeId, id)).orderBy(asc(committeeSessions.sessionId))
    return this.toCommittee(row, sessions)
  }

  async getAll(): Promise<Committee[]> {
    const rows = await db.select().from(committees)
    const out: Committee[] = []
    for (const row of rows) {
      const sessions = await db.select().from(committeeSessions).where(eq(committeeSessions.committeeId, row.id)).orderBy(asc(committeeSessions.sessionId))
      out.push(this.toCommittee(row, sessions))
    }
    return out
  }

  private toCommittee(
    row: typeof committees.$inferSelect,
    sessions: (typeof committeeSessions.$inferSelect)[],
  ): Committee {
    return {
      id: row.id,
      oknesset_id: row.oknessetId,
      name: row.name,
      chair: row.chair,
      lastSessionDate: row.lastSessionDate ? row.lastSessionDate.toISOString() : null,
      lastSessionSummary: row.lastSessionSummary,
      lastSessionDocumentUrl: row.lastSessionDocumentUrl,
      sourceUrl: row.sourceUrl,
      hasNewData: row.hasNewData,
      lastPolledAt: row.lastPolledAt ? row.lastPolledAt.toISOString() : null,
      recentSessions: sessions.map((s) => ({
        sessionId: s.sessionId,
        date: s.date.toISOString(),
        knessetNum: s.knessetNum,
        title: s.title,
        sessionUrl: s.sessionUrl,
        attendingSiteIds: s.attendingSiteIds,
        aiSummary: s.aiSummary ?? undefined,
      })),
    }
  }
}
