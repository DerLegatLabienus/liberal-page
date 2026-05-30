import { db } from '../db/client'
import { mkAnnotations } from '../db/schema'

interface Annotation { isLiberal: boolean; isSupporter: boolean }

export class MkAnnotationsRepository {
  async getAll(): Promise<Record<string, Annotation>> {
    const rows = await db.select().from(mkAnnotations)
    return Object.fromEntries(rows.map((r) => [r.knessetSiteId, { isLiberal: r.isLiberal, isSupporter: r.isSupporter }]))
  }

  async set(siteId: string, annotation: Annotation): Promise<void> {
    await db
      .insert(mkAnnotations)
      .values({ knessetSiteId: siteId, isLiberal: annotation.isLiberal, isSupporter: annotation.isSupporter })
      .onConflictDoUpdate({ target: mkAnnotations.knessetSiteId, set: { isLiberal: annotation.isLiberal, isSupporter: annotation.isSupporter } })
  }
}
