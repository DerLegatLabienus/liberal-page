import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { setupTestDb } from './db-harness'
import { db } from '../../server/db/client'
import { committees, committeeSessions } from '../../server/db/schema'
import { CommitteesRepository } from '../../server/repositories/committees-repository'

const COMMITTEE = {
  oknesset_id: '', name: 'ועדת הכספים', chair: '',
  lastSessionDate: null, lastSessionSummary: null, lastSessionDocumentUrl: null,
  sourceUrl: 'https://example.gov.il/c/2213', hasNewData: false, lastPolledAt: null,
  recentSessions: [
    { sessionId: 9001, date: '2026-05-27T10:15:00.000Z', knessetNum: 25, title: 'דיון', sessionUrl: 'https://example.gov.il/s/9001', attendingSiteIds: ['1116'], aiSummary: 'תקציר' },
  ],
}

describe('CommitteesRepository', () => {
  const repo = new CommitteesRepository()
  beforeAll(async () => { await setupTestDb() })
  beforeEach(async () => { await db.delete(committeeSessions); await db.delete(committees) })

  it('upsert() then getById() reassembles committee with sessions', async () => {
    const id = await repo.upsert(COMMITTEE)
    const c = await repo.getById(id)
    expect(c?.name).toBe('ועדת הכספים')
    expect(c?.recentSessions).toHaveLength(1)
    expect(c?.recentSessions?.[0].sessionId).toBe(9001)
    expect(c?.recentSessions?.[0].attendingSiteIds).toEqual(['1116'])
  })

  it('re-upsert replaces sessions (replace-set)', async () => {
    const id = await repo.upsert(COMMITTEE)
    await repo.upsert({ ...COMMITTEE, recentSessions: [] }, id)
    const c = await repo.getById(id)
    expect(c?.recentSessions).toHaveLength(0)
  })
})
