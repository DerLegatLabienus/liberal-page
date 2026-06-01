import { vi, describe, it, expect, beforeAll, afterEach, beforeEach } from 'vitest'

vi.stubGlobal('fetch', vi.fn())

vi.mock('../../server/services/knesset-api', () => ({
  getMkBySiteId: vi.fn(async () => ({ faction: 'מפלגה', isCurrent: true, positions: [] })),
}))

import { getCurrentKnesset, loadConfig, detectKnessetTransition, runTransition } from '../../server/services/knesset-config'
import { KnessetConfigRepository } from '../../server/repositories/knesset-config-repository'
import { MksRepository } from '../../server/repositories/mks-repository'
import { setupTestDb } from './db-harness'
import { db } from '../../server/db/client'
import { knessetConfig, knessetMembersCache, knessetCommitteesCache, mks, mkKnessetTerms, mkRoles, mkActivity, mkVotes } from '../../server/db/schema'

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

describe('runTransition — re-stamps mk_knesset_terms', () => {
  const mksRepo = new MksRepository()
  beforeAll(async () => { await setupTestDb() })
  beforeEach(async () => {
    await db.delete(mkVotes); await db.delete(mkActivity); await db.delete(mkRoles)
    await db.delete(mkKnessetTerms); await db.delete(mks)
  })
  afterEach(async () => {
    // Reset config back to 25 so subsequent tests are unaffected
    const repo = new KnessetConfigRepository()
    await repo.set(25)
    await loadConfig()
    vi.clearAllMocks()
  })

  it('adds a term for newKnesset for each sitting MK after transition', async () => {
    const id = await mksRepo.upsert({
      oknesset_id: '4395', knesset_site_id: '771', name: 'אבי דיכטר', email: null,
      photoUrl: null, votingSummary: null, sourceUrl: 'https://x', hasNewData: false,
      lastPolledAt: null, terms: [{ knessetNumber: 25, faction: 'הליכוד' }],
      currentRoles: [], activity: [], recentVotes: [],
    })

    // Before transition: inactive for Knesset 26
    expect((await mksRepo.getById(id, 26))?.inactive).toBe(true)

    await runTransition(26)

    // After transition: getMkBySiteId returned isCurrent=true, faction='מפלגה'
    const mk = await mksRepo.getById(id, 26)
    expect(mk?.inactive).toBe(false)
    expect(mk?.party).toBe('מפלגה')
  })
})
