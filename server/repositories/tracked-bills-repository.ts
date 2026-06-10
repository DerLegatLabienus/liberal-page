import { and, eq, inArray, ne, isNotNull } from 'drizzle-orm'
import { db } from '../db/client'
import { trackedBills, users } from '../db/schema'
import { BillsRepository } from './bills-repository'
import type { Bill } from '../../src/types'

export class TrackedBillsRepository {
  private bills = new BillsRepository()

  async getAll(userId: number, currentKnesset: number): Promise<Bill[]> {
    const tracks = await db.select().from(trackedBills).where(eq(trackedBills.userId, userId))
    if (tracks.length === 0) return []
    const entities = await this.bills.getByIds(tracks.map((t) => t.billId), currentKnesset)
    const byId = new Map(entities.map((e) => [e.id, e]))
    return tracks
      .map((t) => {
        const e = byId.get(t.billId)
        if (!e) return null
        return { ...e, position: t.position, notes: t.notes } as Bill
      })
      .filter((b): b is Bill => b !== null)
  }

  async track(userId: number, billId: number, position: string, notes: string, _currentKnesset?: number): Promise<void> {
    await db
      .insert(trackedBills)
      .values({ userId, billId, position, notes, createdAt: new Date() })
      .onConflictDoUpdate({ target: [trackedBills.userId, trackedBills.billId], set: { position, notes } })
  }

  async untrack(userId: number, billId: number): Promise<void> {
    await db.delete(trackedBills).where(and(eq(trackedBills.userId, userId), eq(trackedBills.billId, billId)))
  }

  async isTracked(userId: number, billId: number): Promise<boolean> {
    const rows = await db.select().from(trackedBills).where(and(eq(trackedBills.userId, userId), eq(trackedBills.billId, billId)))
    return rows.length > 0
  }

  /** Personal trackers (role != group, with an email, alerts enabled) of any of the given bills. */
  async findAlertRecipients(
    billIds: number[],
  ): Promise<Array<{ userId: number; email: string; name: string | null; billId: number }>> {
    if (billIds.length === 0) return []
    const rows = await db
      .select({ userId: trackedBills.userId, email: users.email, name: users.name, billId: trackedBills.billId })
      .from(trackedBills)
      .innerJoin(users, eq(trackedBills.userId, users.id))
      .where(and(
        inArray(trackedBills.billId, billIds),
        ne(users.role, 'group'),
        isNotNull(users.email),
        eq(users.emailAlerts, true),
      ))
    return rows.map((r) => ({ userId: r.userId, email: r.email as string, name: r.name, billId: r.billId }))
  }
}
