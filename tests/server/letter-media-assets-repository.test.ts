import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { setupTestDb } from './db-harness'
import { db } from '../../server/db/client'
import { letterMediaAssets } from '../../server/db/schema'
import { LetterMediaAssetsRepository } from '../../server/repositories/letter-media-assets-repository'

const repo = new LetterMediaAssetsRepository()

describe('LetterMediaAssetsRepository', () => {
  beforeAll(async () => { await setupTestDb() })
  beforeEach(async () => { await db.delete(letterMediaAssets) })

  it('creates, lists newest-first, gets by id, and deletes', async () => {
    const a = await repo.create({ key: 'letters/a.png', filename: 'a.png', contentType: 'image/png', sizeBytes: 10, uploadedBy: null })
    const b = await repo.create({ key: 'letters/b.png', filename: 'b.png', contentType: 'image/png', sizeBytes: 20, uploadedBy: null })

    const list = await repo.list()
    expect(list.map((r) => r.key)).toEqual(['letters/b.png', 'letters/a.png'])

    expect((await repo.getById(a.id))?.key).toBe('letters/a.png')

    await repo.delete(b.id)
    expect((await repo.list()).map((r) => r.key)).toEqual(['letters/a.png'])
  })
})
