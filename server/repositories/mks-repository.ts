import { eq, asc, inArray, notExists } from 'drizzle-orm'
import { db } from '../db/client'
import { mks, mkKnessetTerms, mkRoles, mkActivity, mkVotes, trackedMks } from '../db/schema'
import type { Mk, MkRole, MkActivity, MkVote } from '../../src/types'

type MkRow = typeof mks.$inferSelect
type TermRow = typeof mkKnessetTerms.$inferSelect
type RoleRow = typeof mkRoles.$inferSelect
type ActivityRow = typeof mkActivity.$inferSelect
type VoteRow = typeof mkVotes.$inferSelect

/** Group child rows by their mkId, preserving input order within each group. */
function groupByMk<T extends { mkId: number }>(rows: T[]): Map<number, T[]> {
  const m = new Map<number, T[]>()
  for (const r of rows) {
    const arr = m.get(r.mkId)
    if (arr) arr.push(r)
    else m.set(r.mkId, [r])
  }
  return m
}

export interface MkTermInput { knessetNumber: number; faction: string }
export interface MkInput {
  oknesset_id: string
  knesset_site_id?: string
  name: string
  email?: string | null
  photoUrl?: string | null
  votingSummary: string | null
  sourceUrl: string
  hasNewData: boolean
  lastPolledAt: string | null
  terms: MkTermInput[]
  currentRoles: MkRole[]
  activity: MkActivity[]
  recentVotes: MkVote[]
}

export class MksRepository {
  async upsert(input: MkInput, id?: number): Promise<number> {
    return db.transaction(async (tx) => {
      const values = {
        oknessetId: input.oknesset_id,
        knessetSiteId: input.knesset_site_id ?? null,
        name: input.name,
        email: input.email ?? null,
        photoUrl: input.photoUrl ?? null,
        votingSummary: input.votingSummary,
        sourceUrl: input.sourceUrl,
        hasNewData: input.hasNewData,
        lastPolledAt: input.lastPolledAt ? new Date(input.lastPolledAt) : null,
      }
      let mkId = id
      if (mkId) {
        await tx.update(mks).set(values).where(eq(mks.id, mkId))
      } else {
        const [row] = await tx.insert(mks).values(values).returning({ id: mks.id })
        mkId = row.id
      }
      await tx.delete(mkKnessetTerms).where(eq(mkKnessetTerms.mkId, mkId))
      await tx.delete(mkRoles).where(eq(mkRoles.mkId, mkId))
      await tx.delete(mkActivity).where(eq(mkActivity.mkId, mkId))
      await tx.delete(mkVotes).where(eq(mkVotes.mkId, mkId))

      if (input.terms.length) {
        await tx.insert(mkKnessetTerms).values(input.terms.map((t) => ({ mkId: mkId!, knessetNumber: t.knessetNumber, faction: t.faction })))
      }
      if (input.currentRoles.length) {
        await tx.insert(mkRoles).values(input.currentRoles.map((r) => ({
          mkId: mkId!, positionId: r.positionId, description: r.description,
          committeeName: r.committeeName ?? null, isCurrent: r.isCurrent,
          startDate: r.startDate ? new Date(r.startDate) : null,
        })))
      }
      if (input.activity.length) {
        await tx.insert(mkActivity).values(input.activity.map((a) => ({
          mkId: mkId!, type: a.type, date: new Date(a.date), title: a.title,
          detail: a.detail ?? null, sourceUrl: a.sourceUrl ?? null,
        })))
      }
      if (input.recentVotes.length) {
        await tx.insert(mkVotes).values(input.recentVotes.map((v) => ({
          mkId: mkId!, date: new Date(v.date), billTitle: v.billTitle, vote: v.vote,
        })))
      }
      return mkId
    })
  }

  private toMk(
    row: MkRow, terms: TermRow[], roles: RoleRow[], activity: ActivityRow[], votes: VoteRow[],
    currentKnesset: number,
  ): Mk {
    const currentTerm = terms.find((t) => t.knessetNumber === currentKnesset)
    return {
      id: row.id,
      oknesset_id: row.oknessetId,
      knesset_site_id: row.knessetSiteId ?? undefined,
      name: row.name,
      party: currentTerm?.faction ?? terms[terms.length - 1]?.faction ?? '',
      email: row.email,
      photoUrl: row.photoUrl,
      currentRoles: roles.map((r) => ({
        positionId: r.positionId, description: r.description,
        committeeName: r.committeeName ?? undefined, isCurrent: r.isCurrent,
        startDate: r.startDate ? r.startDate.toISOString() : null,
      })),
      activity: activity.map((a) => ({
        type: a.type as MkActivity['type'], date: a.date.toISOString(),
        title: a.title, detail: a.detail ?? undefined, sourceUrl: a.sourceUrl ?? undefined,
      })),
      recentVotes: votes.map((v) => ({ date: v.date.toISOString(), billTitle: v.billTitle, vote: v.vote as MkVote['vote'] })),
      votingSummary: row.votingSummary,
      sourceUrl: row.sourceUrl,
      hasNewData: row.hasNewData,
      lastPolledAt: row.lastPolledAt ? row.lastPolledAt.toISOString() : null,
      inactive: !currentTerm,
    }
  }

  async getById(id: number, currentKnesset: number): Promise<Mk | null> {
    const [mk] = await this.getByIds([id], currentKnesset)
    return mk ?? null
  }

  /**
   * Batched read: assembles many MKs in a fixed number of queries (one per child table via
   * inArray) instead of N×5 — the parliament read previously looped getById per tracked MK.
   * Returns MKs in the order of `ids`, skipping any that don't exist.
   */
  async getByIds(ids: number[], currentKnesset: number): Promise<Mk[]> {
    if (ids.length === 0) return []
    const [rows, terms, roles, activity, votes] = await Promise.all([
      db.select().from(mks).where(inArray(mks.id, ids)),
      db.select().from(mkKnessetTerms).where(inArray(mkKnessetTerms.mkId, ids)).orderBy(asc(mkKnessetTerms.id)),
      db.select().from(mkRoles).where(inArray(mkRoles.mkId, ids)).orderBy(asc(mkRoles.id)),
      db.select().from(mkActivity).where(inArray(mkActivity.mkId, ids)).orderBy(asc(mkActivity.id)),
      db.select().from(mkVotes).where(inArray(mkVotes.mkId, ids)).orderBy(asc(mkVotes.id)),
    ])
    const byId = new Map(rows.map((r) => [r.id, r]))
    const termsByMk = groupByMk(terms)
    const rolesByMk = groupByMk(roles)
    const activityByMk = groupByMk(activity)
    const votesByMk = groupByMk(votes)
    const out: Mk[] = []
    for (const id of ids) {
      const row = byId.get(id)
      if (!row) continue
      out.push(this.toMk(row, termsByMk.get(id) ?? [], rolesByMk.get(id) ?? [], activityByMk.get(id) ?? [], votesByMk.get(id) ?? [], currentKnesset))
    }
    return out
  }

  async getAll(currentKnesset: number): Promise<Mk[]> {
    const rows = await db.select({ id: mks.id }).from(mks)
    return this.getByIds(rows.map((r) => r.id), currentKnesset)
  }

  async getAllBasic(): Promise<{ id: number; knessetSiteId: string | null }[]> {
    return db.select({ id: mks.id, knessetSiteId: mks.knessetSiteId }).from(mks)
  }

  async addTerm(mkId: number, knessetNumber: number, faction: string): Promise<void> {
    await db
      .insert(mkKnessetTerms)
      .values({ mkId, knessetNumber, faction })
      .onConflictDoNothing({ target: [mkKnessetTerms.mkId, mkKnessetTerms.knessetNumber] })
  }

  /**
   * Targeted update for the poller: replaces only the activity rows and
   * updates hasNewData / lastPolledAt. Leaves terms, roles, and votes untouched.
   */
  async updateActivity(id: number, newActivity: MkActivity[], hasNewData: boolean, lastPolledAt: Date | null): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.update(mks).set({ hasNewData, lastPolledAt }).where(eq(mks.id, id))
      await tx.delete(mkActivity).where(eq(mkActivity.mkId, id))
      if (newActivity.length > 0) {
        await tx.insert(mkActivity).values(newActivity.map((a) => ({
          mkId: id,
          type: a.type,
          date: new Date(a.date),
          title: a.title,
          detail: a.detail ?? null,
          sourceUrl: a.sourceUrl ?? null,
        })))
      }
    })
  }

  /** MKs tracked by no user (orphans), with staleness ordering info. */
  async findUntracked(): Promise<{ id: number; lastPolledAt: Date | null }[]> {
    return db
      .select({ id: mks.id, lastPolledAt: mks.lastPolledAt })
      .from(mks)
      .where(notExists(db.select().from(trackedMks).where(eq(trackedMks.mkId, mks.id))))
  }

  /** Deletes an MK, all child rows (activity/votes/roles/terms), and tracking rows (FK-safe). */
  async deleteCascade(id: number): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.delete(mkActivity).where(eq(mkActivity.mkId, id))
      await tx.delete(mkVotes).where(eq(mkVotes.mkId, id))
      await tx.delete(mkRoles).where(eq(mkRoles.mkId, id))
      await tx.delete(mkKnessetTerms).where(eq(mkKnessetTerms.mkId, id))
      await tx.delete(trackedMks).where(eq(trackedMks.mkId, id))
      await tx.delete(mks).where(eq(mks.id, id))
    })
  }
}
