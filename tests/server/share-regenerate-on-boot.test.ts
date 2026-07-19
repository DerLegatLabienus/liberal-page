import { vi, describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { setupTestDb } from './db-harness'
import { db } from '../../server/db/client'
import { letters } from '../../server/db/schema'
import { LettersRepository } from '../../server/repositories/letters-repository'
import { FeatureFlagsRepository } from '../../server/repositories/feature-flags-repository'

const put = vi.fn()
const del = vi.fn()
const configured = vi.fn(() => true)
vi.mock('../../server/services/r2-client', () => ({
  isConfigured: () => configured(),
  putObject: (...a: unknown[]) => put(...a),
  deleteObject: (...a: unknown[]) => del(...a),
}))
// The version constant is what the boot sync compares against, so it must be mocked too.
vi.mock('../../server/services/share-renderer', () => ({
  renderShareHtml: () => '<html>card</html>',
  renderShareImage: async () => Buffer.from('PNG'),
  SHARE_RENDERER_VERSION: 2,
}))

import { syncSharesIfRendererChanged } from '../../server/services/share-publisher'

const lettersRepo = new LettersRepository()
const flags = new FeatureFlagsRepository()

async function seedPublished(n: number) {
  for (let i = 0; i < n; i++) {
    await lettersRepo.createCore({ title: `מכתב ${i}`, status: 'published' })
  }
}

describe('syncSharesIfRendererChanged (boot self-heal)', () => {
  beforeAll(async () => { await setupTestDb() })

  beforeEach(async () => {
    put.mockReset(); del.mockReset()
    configured.mockReturnValue(true)
    await db.delete(letters)
    await flags.setFlag('publicSharePages', true, 'true')
    await flags.setFlag('shareRendererVersion', true, null)
  })

  it('regenerates every published letter when no version has been stored yet', async () => {
    await seedPublished(2)
    await syncSharesIfRendererChanged()

    // one .html + one .png per letter
    const keys = put.mock.calls.map((c) => c[0]).sort()
    expect(keys).toHaveLength(4)
    expect(keys.filter((k: string) => k.endsWith('.html'))).toHaveLength(2)

    const stored = (await flags.getAll())['shareRendererVersion']?.value
    expect(stored).toBe('2')
  })

  it('does nothing when the stored version already matches', async () => {
    await seedPublished(2)
    await flags.setFlag('shareRendererVersion', true, '2')

    await syncSharesIfRendererChanged()
    expect(put).not.toHaveBeenCalled()
  })

  it('regenerates when the stored version is stale, then records the new one', async () => {
    await seedPublished(1)
    await flags.setFlag('shareRendererVersion', true, '1')

    await syncSharesIfRendererChanged()
    expect(put).toHaveBeenCalled()
    expect((await flags.getAll())['shareRendererVersion']?.value).toBe('2')
  })

  it('no-ops when publicSharePages is off — and does not record a version', async () => {
    await seedPublished(2)
    await flags.setFlag('publicSharePages', false, 'false')

    await syncSharesIfRendererChanged()
    expect(put).not.toHaveBeenCalled()
    // leaving the version unset matters: turning sharing on later must still regenerate
    expect((await flags.getAll())['shareRendererVersion']?.value).toBeNull()
  })

  it('no-ops when R2 is unconfigured', async () => {
    await seedPublished(2)
    configured.mockReturnValue(false)

    await syncSharesIfRendererChanged()
    expect(put).not.toHaveBeenCalled()
    expect((await flags.getAll())['shareRendererVersion']?.value).toBeNull()
  })
})
