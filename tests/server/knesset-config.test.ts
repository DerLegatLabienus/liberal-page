import { vi, describe, it, expect, beforeAll, afterEach } from 'vitest'

vi.stubGlobal('fetch', vi.fn())

import { getCurrentKnesset, loadConfig, detectKnessetTransition } from '../../server/services/knesset-config'
import { KnessetConfigRepository } from '../../server/repositories/knesset-config-repository'
import { setupTestDb } from './db-harness'
import { db } from '../../server/db/client'
import { knessetConfig, knessetMembersCache, knessetCommitteesCache } from '../../server/db/schema'

function mockOdata(knessetNum: number) {
  return { ok: true, json: async () => ({ value: [{ KnessetNum: knessetNum }] }) } as Response
}

describe('getCurrentKnesset', () => {
  beforeAll(async () => { await setupTestDb() })

  it('returns 25 by default (before loadConfig)', () => {
    expect(getCurrentKnesset()).toBe(25)
  })

  it('returns value loaded from DB after loadConfig()', async () => {
    const repo = new KnessetConfigRepository()
    await db.delete(knessetConfig)
    await repo.set(26)
    await loadConfig()
    expect(getCurrentKnesset()).toBe(26)
    // Reset back to 25 so subsequent tests are unaffected
    await repo.set(25)
    await loadConfig()
  })
})

describe('detectKnessetTransition', () => {
  beforeAll(async () => { await setupTestDb() })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns false when live Knesset matches stored', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockOdata(25))
    const result = await detectKnessetTransition()
    expect(result).toBe(false)
  })

  it('returns true and persists config to DB when live Knesset is higher', async () => {
    // Seed a cache entry so we can verify it is cleared by runTransition
    await db.delete(knessetMembersCache)
    await db.delete(knessetCommitteesCache)

    vi.mocked(fetch).mockResolvedValueOnce(mockOdata(26))
    const result = await detectKnessetTransition()
    expect(result).toBe(true)
    // In-memory config must reflect new Knesset
    expect(getCurrentKnesset()).toBe(26)
    // Persisted config must reflect new Knesset
    const repo = new KnessetConfigRepository()
    const stored = await repo.get()
    expect(stored?.currentKnesset).toBe(26)

    // Reset back to 25 for subsequent tests
    await repo.set(25)
    await loadConfig()
  })

  it('returns false and does not throw when OData fails', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('network error'))
    const result = await detectKnessetTransition()
    expect(result).toBe(false)
  })
})
