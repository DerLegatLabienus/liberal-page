import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { setupTestDb } from './db-harness'
import { db } from '../../server/db/client'
import { users, trackedCommittees, committees, committeeSessions } from '../../server/db/schema'
import { CommitteesRepository } from '../../server/repositories/committees-repository'
import { UsersRepository } from '../../server/repositories/users-repository'
import { TrackedCommitteesRepository } from '../../server/repositories/tracked-committees-repository'

const C = {
  oknesset_id: '', name: 'ועדת הכספים', chair: '', lastSessionDate: null,
  lastSessionSummary: null, lastSessionDocumentUrl: null, sourceUrl: 'https://x',
  hasNewData: false, lastPolledAt: null, recentSessions: [],
}

describe('TrackedCommitteesRepository', () => {
  const usersRepo = new UsersRepository()
  const cRepo = new CommitteesRepository()
  const repo = new TrackedCommitteesRepository()
  let userId: number
  beforeAll(async () => { await setupTestDb() })
  beforeEach(async () => {
    await db.delete(trackedCommittees); await db.delete(committeeSessions)
    await db.delete(committees); await db.delete(users)
    usersRepo['cachedId'] = null
    userId = await usersRepo.getGroupUserId()
  })

  it('track/getAll/untrack round-trips; entity persists after untrack', async () => {
    const id = await cRepo.upsert(C)
    await repo.track(userId, id)
    const list = await repo.getAll(userId)
    expect(list).toHaveLength(1)
    expect(list[0].name).toBe('ועדת הכספים')
    await repo.untrack(userId, id)
    expect(await repo.getAll(userId)).toHaveLength(0)
    expect(await db.select().from(committees)).toHaveLength(1)
  })
})
