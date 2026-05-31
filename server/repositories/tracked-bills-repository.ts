import { and, eq } from 'drizzle-orm'
import { db } from '../db/client'
import { trackedBills } from '../db/schema'
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
}
