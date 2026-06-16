import { eq, desc, inArray, notExists } from 'drizzle-orm'
import { db } from '../db/client'
import { committees, committeeSessions, trackedCommittees } from '../db/schema'
import type { Committee, CommitteeSession } from '../../src/types'
import { computeStatusChanges, MIN_ACTIVE_COMMITTEES } from '../services/committee-status'

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
    const [c] = await this.getByIds([id])
    return c ?? null
  }

  /**
   * Batched read: committees + their sessions in two queries (sessions via inArray, grouped in
   * memory) instead of one sessions query per committee. Returns committees in `ids` order.
   */
  async getByIds(ids: number[]): Promise<Committee[]> {
    if (ids.length === 0) return []
    const [rows, sessions] = await Promise.all([
      db.select().from(committees).where(inArray(committees.id, ids)),
      db.select().from(committeeSessions).where(inArray(committeeSessions.committeeId, ids)).orderBy(desc(committeeSessions.date)),
    ])
    const byId = new Map(rows.map((r) => [r.id, r]))
    const sessionsByCommittee = new Map<number, (typeof committeeSessions.$inferSelect)[]>()
    for (const s of sessions) {
      const arr = sessionsByCommittee.get(s.committeeId)
      if (arr) arr.push(s)
      else sessionsByCommittee.set(s.committeeId, [s])
    }
    const out: Committee[] = []
    for (const id of ids) {
      const row = byId.get(id)
      if (row) out.push(this.toCommittee(row, sessionsByCommittee.get(id) ?? []))
    }
    return out
  }

  async getAll(): Promise<Committee[]> {
    const rows = await db.select({ id: committees.id }).from(committees)
    return this.getByIds(rows.map((r) => r.id))
  }

  /** Targeted update of the `inactive` flag for the given oknesset_ids. No-op on empty input. */
  async setInactiveByIds(oknessetIds: string[], inactive: boolean): Promise<number> {
    if (oknessetIds.length === 0) return 0
    const updated = await db
      .update(committees)
      .set({ inactive })
      .where(inArray(committees.oknessetId, oknessetIds))
      .returning({ id: committees.id })
    return updated.length
  }

  /**
   * Reconcile tracked committees' inactive flags against the fresh active id list.
   * Closure/reactivation decisions are made by `computeStatusChanges`, which applies
   * the safety floor (skips everything if the active list is implausibly short).
   */
  async reconcileActiveStatus(activeIds: number[]): Promise<{ deactivated: number; reactivated: number }> {
    const rows = await db
      .select({ oknessetId: committees.oknessetId, inactive: committees.inactive })
      .from(committees)
    const { deactivate, reactivate } = computeStatusChanges(
      rows,
      new Set(activeIds),
      MIN_ACTIVE_COMMITTEES,
    )
    const deactivated = await this.setInactiveByIds(deactivate, true)
    const reactivated = await this.setInactiveByIds(reactivate, false)
    return { deactivated, reactivated }
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
      inactive: row.inactive,
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

  /** Committees tracked by no user (orphans), with staleness + summary-match info. */
  async findUntracked(): Promise<{ id: number; lastPolledAt: Date | null; documentUrl: string | null }[]> {
    return db
      .select({ id: committees.id, lastPolledAt: committees.lastPolledAt, documentUrl: committees.lastSessionDocumentUrl })
      .from(committees)
      .where(notExists(db.select().from(trackedCommittees).where(eq(trackedCommittees.committeeId, committees.id))))
  }

  /** Deletes a committee, its sessions, and any tracking rows (FK-safe). */
  async deleteCascade(id: number): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.delete(committeeSessions).where(eq(committeeSessions.committeeId, id))
      await tx.delete(trackedCommittees).where(eq(trackedCommittees.committeeId, id))
      await tx.delete(committees).where(eq(committees.id, id))
    })
  }
}
