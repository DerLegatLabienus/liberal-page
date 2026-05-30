import { db } from '../db/client'
import { knessetConfig } from '../db/schema'

export interface KnessetConfigValue {
  currentKnesset: number
  detectedAt: string
}

export class KnessetConfigRepository {
  async get(): Promise<KnessetConfigValue | null> {
    const rows = await db.select().from(knessetConfig)
    const row = rows[0]
    if (!row) return null
    return { currentKnesset: row.currentKnesset, detectedAt: row.detectedAt.toISOString() }
  }

  async set(currentKnesset: number): Promise<void> {
    await db
      .insert(knessetConfig)
      .values({ id: 1, currentKnesset, detectedAt: new Date() })
      .onConflictDoUpdate({
        target: knessetConfig.id,
        set: { currentKnesset, detectedAt: new Date() },
      })
  }
}
