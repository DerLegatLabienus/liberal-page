import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { setupTestDb } from './db-harness'
import { db } from '../../server/db/client'
import { users } from '../../server/db/schema'
import { UsersRepository } from '../../server/repositories/users-repository'

describe('UsersRepository', () => {
  beforeAll(async () => { await setupTestDb() })
  beforeEach(async () => { await db.delete(users) })

  it('getSharedUserId() creates the shared account on first call', async () => {
    const repo = new UsersRepository()
    const id = await repo.getSharedUserId()
    expect(id).toBeGreaterThan(0)
    const rows = await db.select().from(users)
    expect(rows).toHaveLength(1)
    expect(rows[0].label).toBe('shared')
  })

  it('getSharedUserId() is idempotent (no duplicate shared rows)', async () => {
    const repo = new UsersRepository()
    const a = await repo.getSharedUserId()
    const b = await repo.getSharedUserId()
    expect(a).toBe(b)
    expect(await db.select().from(users)).toHaveLength(1)
  })
})
