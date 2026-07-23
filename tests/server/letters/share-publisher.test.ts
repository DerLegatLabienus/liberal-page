import { vi, describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { setupTestDb } from '../db-harness'
import { db } from '../../../server/db/client'
import { letters, letterIssueTags } from '../../../server/db/schema'
import { LettersRepository } from '../../../server/repositories/letters-repository'
import { FeatureFlagsRepository } from '../../../server/repositories/feature-flags-repository'

const put = vi.fn(); const del = vi.fn()
vi.mock('../../../server/services/r2-client', () => ({
  isConfigured: () => true,
  putObject: (...a: unknown[]) => put(...a),
  deleteObject: (...a: unknown[]) => del(...a),
}))
vi.mock('../../../server/services/share-renderer', () => ({
  renderShareHtml: () => '<html>card</html>',
  renderShareImage: async () => Buffer.from('PNG'),
}))

import { syncShareForLetter, removeShareForLetter } from '../../../server/services/share-publisher'

const lettersRepo = new LettersRepository()
const flags = new FeatureFlagsRepository()
const BASE = { title: 'כותרת' }

describe('share-publisher', () => {
  beforeAll(async () => { await setupTestDb() })
  beforeEach(async () => {
    put.mockReset(); del.mockReset(); put.mockResolvedValue(true); del.mockResolvedValue(true)
    await db.delete(letters); await db.delete(letterIssueTags)
    await flags.setFlag('publicSharePages', true, null, 'x')
  })

  it('publishes under the opaque slug AND the legacy id key (so old links keep working)', async () => {
    const l = await lettersRepo.createCore({ ...BASE, status: 'published' })
    await syncShareForLetter(l.id)
    expect(put).toHaveBeenCalledTimes(4)
    const keys = put.mock.calls.map((c) => c[0]).sort()
    expect(keys).toEqual([
      `letter/${l.id}.html`, `letter/${l.id}.png`,
      `letter/${l.shareSlug}.html`, `letter/${l.shareSlug}.png`,
    ].sort())
    // the slug is opaque: a 32-char random hex, not the id in any form
    expect(l.shareSlug).toMatch(/^[0-9a-f]{32}$/)
    expect(l.shareSlug).not.toBe(String(l.id))
    const other = await lettersRepo.createCore({ ...BASE, status: 'published' })
    expect(other.shareSlug).not.toBe(l.shareSlug)
    // both copies are byte-identical
    const htmls = put.mock.calls.filter((c) => String(c[0]).endsWith('.html')).map((c) => c[1])
    expect(htmls[0]).toBe(htmls[1])
  })

  it('removes objects for a draft (non-published) letter', async () => {
    const l = await lettersRepo.createCore({ ...BASE, status: 'draft' })
    await syncShareForLetter(l.id)
    expect(put).not.toHaveBeenCalled()
    // slug pair + legacy id pair
    expect(del).toHaveBeenCalledTimes(4)
  })

  it('does nothing when the flag is off', async () => {
    await flags.setFlag('publicSharePages', false, null, 'x')
    const l = await lettersRepo.createCore({ ...BASE, status: 'published' })
    await syncShareForLetter(l.id)
    expect(put).not.toHaveBeenCalled(); expect(del).not.toHaveBeenCalled()
  })

  it('removeShareForLetter deletes the slug pair and the legacy id pair', async () => {
    const l = await lettersRepo.createCore({ ...BASE, status: 'published' })
    del.mockClear()
    await removeShareForLetter(l.id)
    const keys = del.mock.calls.map((c) => c[0]).sort()
    expect(keys).toEqual([
      `letter/${l.id}.html`, `letter/${l.id}.png`,
      `letter/${l.shareSlug}.html`, `letter/${l.shareSlug}.png`,
    ].sort())
  })

  it('removeShareForLetter falls back to the legacy id keys when the row is already gone', async () => {
    await removeShareForLetter(99)
    const keys = del.mock.calls.map((c) => c[0]).sort()
    expect(keys).toEqual(['letter/99.html', 'letter/99.png'])
  })

  it('never throws when rendering/upload fails', async () => {
    put.mockRejectedValue(new Error('boom'))
    const l = await lettersRepo.createCore({ ...BASE, status: 'published' })
    await expect(syncShareForLetter(l.id)).resolves.toBeUndefined()
  })
})
