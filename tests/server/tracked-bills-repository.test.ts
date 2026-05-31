import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { setupTestDb } from './db-harness'
import { db } from '../../server/db/client'
import { users, trackedBills, bills } from '../../server/db/schema'
import { BillsRepository } from '../../server/repositories/bills-repository'
import { UsersRepository } from '../../server/repositories/users-repository'
import { TrackedBillsRepository } from '../../server/repositories/tracked-bills-repository'

const ENTITY = {
  oknessetId: '', number: '1044632', title: 'הצעת חוק', status: 'בוועדה',
  committee: '', sourceUrl: 'https://x', documentUrl: null, knessetUrl: null,
  knessetNumber: 25, hasNewData: false, lastPolledAt: null,
}

describe('TrackedBillsRepository', () => {
  const usersRepo = new UsersRepository()
  const billsRepo = new BillsRepository()
  const repo = new TrackedBillsRepository()
  let userId: number
  beforeAll(async () => { await setupTestDb() })
  beforeEach(async () => {
    await db.delete(trackedBills); await db.delete(bills); await db.delete(users)
    usersRepo['cachedId'] = null
    userId = await usersRepo.getSharedUserId()
  })

  it('track() then getAll() returns the bill with position/notes', async () => {
    const billId = await billsRepo.upsert(ENTITY)
    await repo.track(userId, billId, 'תומכים', 'my note', 25)
    const list = await repo.getAll(userId, 25)
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe(billId)
    expect(list[0].position).toBe('תומכים')
    expect(list[0].notes).toBe('my note')
  })

  it('track() is idempotent on (user, bill)', async () => {
    const billId = await billsRepo.upsert(ENTITY)
    await repo.track(userId, billId, 'עוקבים', '', 25)
    await repo.track(userId, billId, 'מתנגדים', 'changed', 25)
    const list = await repo.getAll(userId, 25)
    expect(list).toHaveLength(1)
    expect(list[0].position).toBe('מתנגדים')
  })

  it('untrack() removes the tracking row but keeps the bill entity', async () => {
    const billId = await billsRepo.upsert(ENTITY)
    await repo.track(userId, billId, 'עוקבים', '', 25)
    await repo.untrack(userId, billId)
    expect(await repo.getAll(userId, 25)).toHaveLength(0)
    expect(await db.select().from(bills)).toHaveLength(1)
  })
})
