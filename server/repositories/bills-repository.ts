import { eq, inArray } from 'drizzle-orm'
import { db } from '../db/client'
import { bills } from '../db/schema'
import type { Bill } from '../../src/types'

export type BillEntity = typeof bills.$inferInsert

export class BillsRepository {
  async upsert(entity: BillEntity): Promise<number> {
    const [row] = await db.insert(bills).values(entity).returning({ id: bills.id })
    return row.id
  }

  async getById(id: number, currentKnesset: number): Promise<Partial<Bill> | null> {
    const rows = await db.select().from(bills).where(eq(bills.id, id))
    const row = rows[0]
    if (!row) return null
    return this.toBill(row, currentKnesset)
  }

  async getAll(currentKnesset: number): Promise<Partial<Bill>[]> {
    const rows = await db.select().from(bills)
    return rows.map((r) => this.toBill(r, currentKnesset))
  }

  async getByIds(ids: number[], currentKnesset: number): Promise<Partial<Bill>[]> {
    if (ids.length === 0) return []
    const rows = await db.select().from(bills).where(inArray(bills.id, ids))
    return rows.map((r) => this.toBill(r, currentKnesset))
  }

  private toBill(row: typeof bills.$inferSelect, currentKnesset: number): Partial<Bill> {
    return {
      id: row.id,
      oknesset_id: row.oknessetId,
      number: row.number,
      title: row.title,
      status: row.status as Bill['status'],
      committee: row.committee,
      sourceUrl: row.sourceUrl,
      documentUrl: row.documentUrl,
      knessetUrl: row.knessetUrl ?? undefined,
      hasNewData: row.hasNewData,
      lastPolledAt: row.lastPolledAt ? row.lastPolledAt.toISOString() : null,
      inactive: row.knessetNumber !== currentKnesset,
    }
  }
}
