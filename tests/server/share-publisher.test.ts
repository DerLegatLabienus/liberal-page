import { vi, describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { setupTestDb } from './db-harness'
import { db } from '../../server/db/client'
import { letters, letterIssueTags } from '../../server/db/schema'
import { LettersRepository } from '../../server/repositories/letters-repository'
import { FeatureFlagsRepository } from '../../server/repositories/feature-flags-repository'

const put = vi.fn(); const del = vi.fn()
vi.mock('../../server/services/r2-client', () => ({
  isConfigured: () => true,
  putObject: (...a: unknown[]) => put(...a),
  deleteObject: (...a: unknown[]) => del(...a),
}))
vi.mock('../../server/services/share-renderer', () => ({
  renderShareHtml: () => '<html>card</html>',
  renderShareImage: async () => Buffer.from('PNG'),
}))

import { syncShareForLetter, removeShareForLetter } from '../../server/services/share-publisher'

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

  it('publishes both objects for a published letter when the flag is on', async () => {
    const l = await lettersRepo.createCore({ ...BASE, status: 'published' })
    await syncShareForLetter(l.id)
    expect(put).toHaveBeenCalledTimes(2)
    const keys = put.mock.calls.map((c) => c[0]).sort()
    expect(keys).toEqual([`letter/${l.id}.html`, `letter/${l.id}.png`])
  })

  it('removes objects for a draft (non-published) letter', async () => {
    const l = await lettersRepo.createCore({ ...BASE, status: 'draft' })
    await syncShareForLetter(l.id)
    expect(put).not.toHaveBeenCalled()
    expect(del).toHaveBeenCalledTimes(2)
  })

  it('does nothing when the flag is off', async () => {
    await flags.setFlag('publicSharePages', false, null, 'x')
    const l = await lettersRepo.createCore({ ...BASE, status: 'published' })
    await syncShareForLetter(l.id)
    expect(put).not.toHaveBeenCalled(); expect(del).not.toHaveBeenCalled()
  })

  it('removeShareForLetter deletes both objects', async () => {
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
