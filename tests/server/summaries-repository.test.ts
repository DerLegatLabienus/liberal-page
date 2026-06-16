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

  it('deleteOlderThan() removes rows older than the cutoff and keeps newer ones', async () => {
    await repo.set('old', { summary: 's', createdAt: '2025-01-01T00:00:00.000Z', sourceUrl: 'https://a' })
    await repo.set('new', { summary: 's', createdAt: '2026-06-01T00:00:00.000Z', sourceUrl: 'https://b' })
    const removed = await repo.deleteOlderThan(new Date('2026-01-01T00:00:00.000Z'))
    expect(removed).toBe(1)
    expect((await db.select().from(summariesCache)).map((r) => r.md5)).toEqual(['new'])
  })
})
