import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { setupTestDb } from './db-harness'
import { db } from '../../server/db/client'
import { mks, mkKnessetTerms, mkRoles, mkActivity, mkVotes } from '../../server/db/schema'
import { MksRepository } from '../../server/repositories/mks-repository'

const MK = {
  oknesset_id: '4395', knesset_site_id: '771', name: 'אבי דיכטר',
  email: 'x@knesset.gov.il', photoUrl: 'https://example.gov.il/p/771',
  votingSummary: null, sourceUrl: 'https://example.gov.il/mk/771',
  hasNewData: false, lastPolledAt: null,
  terms: [{ knessetNumber: 25, faction: 'הליכוד' }],
  currentRoles: [{ positionId: 43, description: 'חבר כנסת', committeeName: undefined, isCurrent: true, startDate: '2006-04-17T00:00:00.000Z' }],
  activity: [{ type: 'bill_initiated' as const, date: '2026-05-01T00:00:00.000Z', title: 'הצעת חוק', detail: undefined, sourceUrl: undefined }],
  recentVotes: [{ date: '2026-05-02T00:00:00.000Z', billTitle: 'חוק', vote: 'בעד' as const }],
}

describe('MksRepository', () => {
  const repo = new MksRepository()
  beforeAll(async () => { await setupTestDb() })
  beforeEach(async () => {
    await db.delete(mkVotes); await db.delete(mkActivity); await db.delete(mkRoles)
    await db.delete(mkKnessetTerms); await db.delete(mks)
  })

  it('upsert() then getById() reassembles full MK', async () => {
    const id = await repo.upsert(MK)
    const mk = await repo.getById(id, 25)
    expect(mk?.name).toBe('אבי דיכטר')
    expect(mk?.currentRoles).toHaveLength(1)
    expect(mk?.activity).toHaveLength(1)
    expect(mk?.recentVotes).toHaveLength(1)
  })

  it('derives party from current-Knesset term', async () => {
    const id = await repo.upsert(MK)
    expect((await repo.getById(id, 25))?.party).toBe('הליכוד')
  })

  it('derives inactive when no term for current Knesset', async () => {
    const id = await repo.upsert(MK)
    expect((await repo.getById(id, 25))?.inactive).toBe(false)
    expect((await repo.getById(id, 26))?.inactive).toBe(true)
  })
})
