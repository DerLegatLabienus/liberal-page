import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { setupTestDb } from '../db-harness'
import { db } from '../../../server/db/client'
import { mks, mkKnessetTerms, mkRoles, mkActivity, mkVotes } from '../../../server/db/schema'
import { MksRepository } from '../../../server/repositories/mks-repository'

const MK = {
  oknesset_id: '4395', knesset_site_id: '771', name: 'אבי דיכטר', email: null,
  photoUrl: null, votingSummary: null, sourceUrl: 'https://x', hasNewData: false,
  lastPolledAt: null, terms: [{ knessetNumber: 25, faction: 'הליכוד' }],
  currentRoles: [], activity: [], recentVotes: [],
}

describe('MksRepository.addTerm', () => {
  const repo = new MksRepository()
  beforeAll(async () => { await setupTestDb() })
  beforeEach(async () => {
    await db.delete(mkVotes); await db.delete(mkActivity); await db.delete(mkRoles)
    await db.delete(mkKnessetTerms); await db.delete(mks)
  })

  it('addTerm makes an MK current for the new Knesset (inactive=false, party=faction)', async () => {
    const id = await repo.upsert(MK)
    expect((await repo.getById(id, 26))?.inactive).toBe(true)   // no term for 26 yet
    await repo.addTerm(id, 26, 'הליכוד')
    const mk = await repo.getById(id, 26)
    expect(mk?.inactive).toBe(false)
    expect(mk?.party).toBe('הליכוד')
  })

  it('addTerm is idempotent on (mk, knesset)', async () => {
    const id = await repo.upsert(MK)
    await repo.addTerm(id, 26, 'הליכוד')
    await repo.addTerm(id, 26, 'אחר')  // conflict → do nothing
    // assert exactly one term row for knesset 26
    const all = await db.select().from(mkKnessetTerms)
    expect(all.filter((t) => t.knessetNumber === 26)).toHaveLength(1)
    expect((await repo.getById(id, 26))?.party).toBe('הליכוד')
  })
})
