import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { setupTestDb } from './db-harness'
import { db } from '../../server/db/client'
import { knessetConfig } from '../../server/db/schema'
import { KnessetConfigRepository } from '../../server/repositories/knesset-config-repository'

describe('KnessetConfigRepository', () => {
  const repo = new KnessetConfigRepository()
  beforeAll(async () => { await setupTestDb() })
  beforeEach(async () => { await db.delete(knessetConfig) })

  it('get() returns null when unset', async () => {
    expect(await repo.get()).toBeNull()
  })

  it('set() then get() round-trips currentKnesset', async () => {
    await repo.set(25)
    const cfg = await repo.get()
    expect(cfg?.currentKnesset).toBe(25)
    expect(cfg?.detectedAt).toBeTruthy()
  })

  it('set() is upsert (single row id=1)', async () => {
    await repo.set(25)
    await repo.set(26)
    const rows = await db.select().from(knessetConfig)
    expect(rows).toHaveLength(1)
    expect(rows[0].currentKnesset).toBe(26)
  })
})
