import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { setupTestDb } from './db-harness'
import { db } from '../../server/db/client'
import { summariesCache } from '../../server/db/schema'
import { SummariesRepository } from '../../server/repositories/summaries-repository'

describe('SummariesRepository', () => {
  const repo = new SummariesRepository()
  beforeAll(async () => { await setupTestDb() })
  beforeEach(async () => { await db.delete(summariesCache) })

  it('get() returns null for a missing md5', async () => {
    expect(await repo.get('abc')).toBeNull()
  })

  it('set() then get() round-trips, including attendees', async () => {
    await repo.set('abc', { summary: 'תקציר', createdAt: '2026-05-01T00:00:00.000Z', sourceUrl: 'https://x', attendees: ['1116'] })
    const e = await repo.get('abc')
    expect(e?.summary).toBe('תקציר')
    expect(e?.attendees).toEqual(['1116'])
  })
})
