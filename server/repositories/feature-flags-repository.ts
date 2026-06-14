import { eq } from 'drizzle-orm'
import { db } from '../db/client'
import { featureFlags } from '../db/schema'
import type { FeatureFlags } from '../../src/types'

export class FeatureFlagsRepository {
  async getAll(): Promise<FeatureFlags> {
    const rows = await db.select().from(featureFlags)
    return Object.fromEntries(rows.map((r) => [r.name, { enabled: r.enabled, value: r.value }]))
  }

  /** True when the named flag exists and is enabled. Missing flag → false. */
  async isEnabled(name: string): Promise<boolean> {
    const [row] = await db.select().from(featureFlags).where(eq(featureFlags.name, name))
    return row?.enabled ?? false
  }

  async setFlag(name: string, enabled: boolean, value: string | null, description: string | null = null): Promise<void> {
    const now = new Date()
    await db
      .insert(featureFlags)
      .values({ name, enabled, value, description, updatedAt: now })
      .onConflictDoUpdate({ target: featureFlags.name, set: { enabled, value, updatedAt: now } })
  }
}
