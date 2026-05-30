import { db } from '../db/client'
import { featureFlags } from '../db/schema'
import type { BillsFeatureFlags } from '../../src/types'

const DEFAULTS: BillsFeatureFlags = {
  trendingAlgorithm: 'manual',
  recentRanking: 'newest',
  policyFilterEnabled: false,
}

export class FeatureFlagsRepository {
  async getBillsFlags(): Promise<BillsFeatureFlags> {
    const rows = await db.select().from(featureFlags)
    const byName = new Map(rows.map((r) => [r.name, r]))
    return {
      trendingAlgorithm:
        (byName.get('trendingAlgorithm')?.value as BillsFeatureFlags['trendingAlgorithm']) ??
        DEFAULTS.trendingAlgorithm,
      recentRanking:
        (byName.get('recentRanking')?.value as BillsFeatureFlags['recentRanking']) ??
        DEFAULTS.recentRanking,
      policyFilterEnabled: byName.get('policyFilter')?.enabled ?? DEFAULTS.policyFilterEnabled,
    }
  }

  async setBillsFlags(flags: BillsFeatureFlags): Promise<void> {
    const now = new Date()
    const rows = [
      { name: 'trendingAlgorithm', enabled: true, value: flags.trendingAlgorithm, description: 'Trending tab ranking source', updatedAt: now },
      { name: 'recentRanking', enabled: true, value: flags.recentRanking, description: 'Recent tab ordering', updatedAt: now },
      { name: 'policyFilter', enabled: flags.policyFilterEnabled, value: null, description: 'Policy-aligned tab toggle', updatedAt: now },
    ]
    for (const row of rows) {
      await db
        .insert(featureFlags)
        .values(row)
        .onConflictDoUpdate({ target: featureFlags.name, set: { enabled: row.enabled, value: row.value, updatedAt: now } })
    }
  }
}
