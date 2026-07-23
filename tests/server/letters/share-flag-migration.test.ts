import { describe, it, expect, beforeAll } from 'vitest'
import { setupTestDb } from '../db-harness'
import { FeatureFlagsRepository } from '../../../server/repositories/feature-flags-repository'

describe('publicSharePages flag (migration 0022)', () => {
  beforeAll(async () => { await setupTestDb() })
  it('exists and is disabled by default', async () => {
    const flags = await new FeatureFlagsRepository().getAll()
    expect(flags['publicSharePages']).toBeDefined()
    expect(flags['publicSharePages'].enabled).toBe(false)
  })
})
