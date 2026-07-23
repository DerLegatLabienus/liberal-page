import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { setupTestDb } from './db-harness'
import { db } from '../../server/db/client'
import { knessetMembersCache } from '../../server/db/schema'
import { MkListRepository } from '../../server/repositories/mk-list-repository'

const MEMBER = { siteId: 1116, name: 'דן אילוז', party: 'הליכוד', photoUrl: null, isLiberal: true, isSupporter: false }

describe('MkListRepository', () => {
  const repo = new MkListRepository()
  beforeAll(async () => { await setupTestDb() })
  beforeEach(async () => { await db.delete(knessetMembersCache) })

  it('get() returns null when cache empty', async () => {
    expect(await repo.get()).toBeNull()
  })

  it('set() then get() round-trips members', async () => {
    await repo.set([MEMBER])
    const result = await repo.get()
    expect(result).toHaveLength(1)
    expect(result![0].siteId).toBe(1116)
  })

  it('set() replaces previous members wholesale', async () => {
    await repo.set([MEMBER])
    await repo.set([{ ...MEMBER, siteId: 1117, name: 'אחר' }])
    const result = await repo.get()
    expect(result).toHaveLength(1)
    expect(result![0].siteId).toBe(1117)
  })
})
