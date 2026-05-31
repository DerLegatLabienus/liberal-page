import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { setupTestDb } from './db-harness'
import { db } from '../../server/db/client'
import { users, trackedMks, mks, mkKnessetTerms, mkRoles, mkActivity, mkVotes } from '../../server/db/schema'
import { MksRepository } from '../../server/repositories/mks-repository'
import { UsersRepository } from '../../server/repositories/users-repository'
import { TrackedMksRepository } from '../../server/repositories/tracked-mks-repository'

const MK = {
  oknesset_id: '4395', knesset_site_id: '771', name: 'אבי דיכטר', email: null,
  photoUrl: null, votingSummary: null, sourceUrl: 'https://x', hasNewData: false,
  lastPolledAt: null, terms: [{ knessetNumber: 25, faction: 'הליכוד' }],
  currentRoles: [], activity: [], recentVotes: [],
}

describe('TrackedMksRepository', () => {
  const usersRepo = new UsersRepository()
  const mksRepo = new MksRepository()
  const repo = new TrackedMksRepository()
  let userId: number
  beforeAll(async () => { await setupTestDb() })
  beforeEach(async () => {
    await db.delete(trackedMks); await db.delete(mkVotes); await db.delete(mkActivity)
    await db.delete(mkRoles); await db.delete(mkKnessetTerms); await db.delete(mks); await db.delete(users)
    usersRepo['cachedId'] = null
    userId = await usersRepo.getSharedUserId()
  })

  it('track/getAll/untrack round-trips; derives party; entity persists', async () => {
    const id = await mksRepo.upsert(MK)
    await repo.track(userId, id)
    const list = await repo.getAll(userId, 25)
    expect(list).toHaveLength(1)
    expect(list[0].party).toBe('הליכוד')
    await repo.untrack(userId, id)
    expect(await repo.getAll(userId, 25)).toHaveLength(0)
    expect(await db.select().from(mks)).toHaveLength(1)
  })
})
