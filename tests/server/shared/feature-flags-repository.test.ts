import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { setupTestDb } from '../db-harness'
import { db } from '../../../server/db/client'
import { featureFlags } from '../../../server/db/schema'
import { FeatureFlagsRepository } from '../../../server/repositories/feature-flags-repository'

describe('FeatureFlagsRepository', () => {
  const repo = new FeatureFlagsRepository()
  beforeAll(async () => { await setupTestDb() })
  beforeEach(async () => { await db.delete(featureFlags) })

  it('getAll() returns empty map when table is empty', async () => {
    const flags = await repo.getAll()
    expect(flags).toEqual({})
  })

  it('setFlag + getAll round-trips a boolean flag', async () => {
    await repo.setFlag('policyFilter', true, null)
    const flags = await repo.getAll()
    expect(flags).toEqual({ policyFilter: { enabled: true, value: null } })
  })

  it('setFlag + getAll round-trips a value flag', async () => {
    await repo.setFlag('trendingAlgorithm', true, 'manual')
    const flags = await repo.getAll()
    expect(flags).toEqual({ trendingAlgorithm: { enabled: true, value: 'manual' } })
  })

  it('setFlag upserts — second call on same name overwrites', async () => {
    await repo.setFlag('trendingAlgorithm', true, 'manual')
    await repo.setFlag('trendingAlgorithm', true, 'amendments')
    const flags = await repo.getAll()
    expect(flags['trendingAlgorithm']).toEqual({ enabled: true, value: 'amendments' })
  })

  it('getAll returns multiple flags', async () => {
    await repo.setFlag('policyFilter', false, null)
    await repo.setFlag('trendingAlgorithm', true, 'manual')
    await repo.setFlag('recentRanking', true, 'newest')
    const flags = await repo.getAll()
    expect(flags).toEqual({
      policyFilter: { enabled: false, value: null },
      trendingAlgorithm: { enabled: true, value: 'manual' },
      recentRanking: { enabled: true, value: 'newest' },
    })
  })
})
