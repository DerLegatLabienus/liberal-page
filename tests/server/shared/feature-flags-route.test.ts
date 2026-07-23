import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import { setupTestDb } from '../db-harness'
import { db } from '../../../server/db/client'
import { featureFlags } from '../../../server/db/schema'
import { FeatureFlagsRepository } from '../../../server/repositories/feature-flags-repository'
import featureFlagsRouter from '../../../server/routes/feature-flags'

const app = express()
app.use(express.json())
app.use('/api/feature-flags', featureFlagsRouter)

describe('GET /api/feature-flags', () => {
  const repo = new FeatureFlagsRepository()

  beforeAll(async () => { await setupTestDb() })
  beforeEach(async () => { await db.delete(featureFlags) })

  it('returns empty object when no flags are set', async () => {
    const res = await request(app).get('/api/feature-flags')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({})
  })

  it('returns flat flag map after seeding', async () => {
    await repo.setFlag('policyFilter', true, null)
    const res = await request(app).get('/api/feature-flags')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ policyFilter: { enabled: true, value: null } })
  })

  it('returns multiple flags with correct shapes', async () => {
    await repo.setFlag('policyFilter', false, null)
    await repo.setFlag('trendingAlgorithm', true, 'manual')
    await repo.setFlag('recentRanking', true, 'newest')
    const res = await request(app).get('/api/feature-flags')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      policyFilter: { enabled: false, value: null },
      trendingAlgorithm: { enabled: true, value: 'manual' },
      recentRanking: { enabled: true, value: 'newest' },
    })
  })
})
