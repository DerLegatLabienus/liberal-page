import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFile, writeFile } from 'fs/promises'

vi.mock('fs/promises')

import { MkAnnotationsRepository } from '../../server/repositories/mk-annotations-repository'

describe('MkAnnotationsRepository', () => {
  let repo: MkAnnotationsRepository

  beforeEach(() => {
    repo = new MkAnnotationsRepository()
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'))
    vi.mocked(writeFile).mockResolvedValue()
  })

  afterEach(() => vi.clearAllMocks())

  it('getAll() returns empty object when file is absent', async () => {
    expect(await repo.getAll()).toEqual({})
  })

  it('getAll() returns parsed annotations', async () => {
    const payload = JSON.stringify({ '1116': { isLiberal: true, isSupporter: false } })
    vi.mocked(readFile).mockResolvedValue(payload as never)
    const result = await repo.getAll()
    expect(result['1116'].isLiberal).toBe(true)
  })

  it('set() merges new annotation with existing', async () => {
    const existing = JSON.stringify({ '1116': { isLiberal: true, isSupporter: false } })
    vi.mocked(readFile).mockResolvedValue(existing as never)
    await repo.set('1117', { isLiberal: false, isSupporter: true })
    const [, content] = vi.mocked(writeFile).mock.calls[0]
    const parsed = JSON.parse(content as string)
    expect(parsed['1116']).toBeTruthy()
    expect(parsed['1117'].isSupporter).toBe(true)
  })
})
