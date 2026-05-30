import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { setupTestDb } from './db-harness'
import { db } from '../../server/db/client'
import { featureFlags } from '../../server/db/schema'
import { FeatureFlagsRepository } from '../../server/repositories/feature-flags-repository'

describe('FeatureFlagsRepository', () => {
  const repo = new FeatureFlagsRepository()
  beforeAll(async () => { await setupTestDb() })
  beforeEach(async () => { await db.delete(featureFlags) })

  it('getBillsFlags() returns defaults when empty', async () => {
    const flags = await repo.getBillsFlags()
    expect(flags).toEqual({ trendingAlgorithm: 'manual', recentRanking: 'newest', policyFilterEnabled: false })
  })

  it('round-trips a full flag set', async () => {
    await repo.setBillsFlags({ trendingAlgorithm: 'manual', recentRanking: 'newest', policyFilterEnabled: true })
    const flags = await repo.getBillsFlags()
    expect(flags).toEqual({ trendingAlgorithm: 'manual', recentRanking: 'newest', policyFilterEnabled: true })
  })
})
