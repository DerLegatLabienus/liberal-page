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

  it('new committees default to active (inactive=false)', async () => {
    const id = await repo.upsert({ ...COMMITTEE, oknesset_id: '500' })
    const c = await repo.getById(id)
    expect(c?.inactive).toBe(false)
  })

  it('upsert does not reset an already-inactive flag', async () => {
    const id = await repo.upsert({ ...COMMITTEE, oknesset_id: '500' })
    await repo.setInactiveByIds(['500'], true)
    // A poller-style re-upsert of session data must not revive a closed committee.
    await repo.upsert({ ...COMMITTEE, oknesset_id: '500', hasNewData: true }, id)
    const c = await repo.getById(id)
    expect(c?.inactive).toBe(true)
  })

  // A trustworthy active list: padded above the safety floor (MIN_ACTIVE_COMMITTEES).
  const activeFloor = Array.from({ length: 10 }, (_, i) => 9000 + i)

  it('reconcileActiveStatus marks an absent committee inactive', async () => {
    await repo.upsert({ ...COMMITTEE, oknesset_id: '500' })
    const res = await repo.reconcileActiveStatus(activeFloor) // 500 not in active list
    expect(res.deactivated).toBe(1)
    const all = await repo.getAll()
    expect(all.find((c) => c.oknesset_id === '500')?.inactive).toBe(true)
  })

  it('reconcileActiveStatus reactivates a committee whose id reappears', async () => {
    await repo.upsert({ ...COMMITTEE, oknesset_id: '500' })
    await repo.setInactiveByIds(['500'], true)
    const res = await repo.reconcileActiveStatus([...activeFloor, 500])
    expect(res.reactivated).toBe(1)
    const all = await repo.getAll()
    expect(all.find((c) => c.oknesset_id === '500')?.inactive).toBe(false)
  })

  it('reconcileActiveStatus changes nothing when the active list is below the safety floor', async () => {
    await repo.upsert({ ...COMMITTEE, oknesset_id: '500' })
    const res = await repo.reconcileActiveStatus([1, 2, 3]) // far below floor
    expect(res).toEqual({ deactivated: 0, reactivated: 0 })
    const all = await repo.getAll()
    expect(all.find((c) => c.oknesset_id === '500')?.inactive).toBe(false)
  })
})
