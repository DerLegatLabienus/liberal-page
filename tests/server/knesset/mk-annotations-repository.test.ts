import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { setupTestDb } from '../db-harness'
import { db } from '../../../server/db/client'
import { mkAnnotations } from '../../../server/db/schema'
import { MkAnnotationsRepository } from '../../../server/repositories/mk-annotations-repository'

describe('MkAnnotationsRepository', () => {
  const repo = new MkAnnotationsRepository()
  beforeAll(async () => { await setupTestDb() })
  beforeEach(async () => { await db.delete(mkAnnotations) })

  it('set() then getAll() round-trips', async () => {
    await repo.set('1116', { isLiberal: true, isSupporter: false })
    expect(await repo.getAll()).toEqual({ '1116': { isLiberal: true, isSupporter: false } })
  })

  it('set() upserts existing site id', async () => {
    await repo.set('1116', { isLiberal: true, isSupporter: false })
    await repo.set('1116', { isLiberal: false, isSupporter: true })
    expect((await repo.getAll())['1116']).toEqual({ isLiberal: false, isSupporter: true })
  })
})
