import { eq, desc } from 'drizzle-orm'
import { db } from '../db/client'
import { letterMediaAssets } from '../db/schema'

export type LetterMediaAssetRow = typeof letterMediaAssets.$inferSelect

export class LetterMediaAssetsRepository {
  async list(): Promise<LetterMediaAssetRow[]> {
    return db.select().from(letterMediaAssets).orderBy(desc(letterMediaAssets.createdAt), desc(letterMediaAssets.id))
  }

  async getById(id: number): Promise<LetterMediaAssetRow | null> {
    const [row] = await db.select().from(letterMediaAssets).where(eq(letterMediaAssets.id, id))
    return row ?? null
  }

  async create(input: {
    key: string; filename: string; contentType: string; sizeBytes: number; uploadedBy: number | null
  }): Promise<LetterMediaAssetRow> {
    const [row] = await db.insert(letterMediaAssets).values(input).returning()
    return row
  }

  async delete(id: number): Promise<void> {
    await db.delete(letterMediaAssets).where(eq(letterMediaAssets.id, id))
  }
}
