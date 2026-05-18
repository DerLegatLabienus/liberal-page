import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFile, writeFile } from 'fs/promises'

vi.mock('fs/promises')

import { MkListRepository } from '../../server/repositories/mk-list-repository'

const MEMBER = { siteId: 1116, name: 'דן אילוז', party: 'הליכוד', photoUrl: null, isLiberal: true, isSupporter: false }

describe('MkListRepository', () => {
  let repo: MkListRepository

  beforeEach(() => {
    repo = new MkListRepository()
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'))
    vi.mocked(writeFile).mockResolvedValue()
  })

  afterEach(() => vi.clearAllMocks())

  it('get() returns null when cache file is absent', async () => {
    expect(await repo.get()).toBeNull()
  })

  it('get() returns members when cache file exists', async () => {
    const payload = JSON.stringify({ cachedAt: new Date().toISOString(), members: [MEMBER] })
    vi.mocked(readFile).mockResolvedValue(payload as never)
    const result = await repo.get()
    expect(result).toHaveLength(1)
    expect(result![0].siteId).toBe(1116)
  })

  it('set() writes JSON with cachedAt timestamp', async () => {
    await repo.set([MEMBER])
    expect(writeFile).toHaveBeenCalledOnce()
    const [, content] = vi.mocked(writeFile).mock.calls[0]
    const parsed = JSON.parse(content as string)
    expect(parsed.members).toHaveLength(1)
    expect(parsed.cachedAt).toBeTruthy()
  })

  it('getAgeMs() returns Infinity before any get/set', () => {
    expect(repo.getAgeMs()).toBe(Infinity)
  })

  it('getAgeMs() returns approximate elapsed time after set()', async () => {
    await repo.set([MEMBER])
    expect(repo.getAgeMs()).toBeGreaterThanOrEqual(0)
    expect(repo.getAgeMs()).toBeLessThan(1000)
  })
})
