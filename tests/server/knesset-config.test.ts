import { vi, describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { readFile, writeFile, unlink } from 'fs/promises'

vi.mock('fs/promises')
vi.stubGlobal('fetch', vi.fn())

import { getCurrentKnesset, loadConfig, detectKnessetTransition } from '../../server/services/knesset-config'
import { KnessetConfigRepository } from '../../server/repositories/knesset-config-repository'
import { setupTestDb } from './db-harness'
import { db } from '../../server/db/client'
import { knessetConfig } from '../../server/db/schema'

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
  beforeEach(() => {
    vi.mocked(readFile).mockResolvedValue('[]' as never)
    vi.mocked(writeFile).mockResolvedValue()
    vi.mocked(unlink).mockResolvedValue()
  })
  afterEach(() => vi.clearAllMocks())

  it('returns false when live Knesset matches stored', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockOdata(25))
    const result = await detectKnessetTransition()
    expect(result).toBe(false)
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('returns true and writes config when live Knesset is higher', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockOdata(26))
    vi.mocked(readFile).mockResolvedValue('[]' as never)
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ value: [] }) } as Response)
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ value: [] }) } as Response)
    const result = await detectKnessetTransition()
    expect(result).toBe(true)
    expect(writeFile).toHaveBeenCalled()
    const [, written] = vi.mocked(writeFile).mock.calls[0]
    const config = JSON.parse(written as string)
    expect(config.currentKnesset).toBe(26)
  })

  it('returns false and does not throw when OData fails', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('network error'))
    const result = await detectKnessetTransition()
    expect(result).toBe(false)
  })
})
