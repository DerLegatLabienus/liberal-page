import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { setupTestDb } from '../db-harness'
import { db } from '../../../server/db/client'
import { letters, letterAnalytics } from '../../../server/db/schema'
import { LettersRepository } from '../../../server/repositories/letters-repository'
import { BASE_LETTER } from '../../support/fixtures'

const lettersRepo = new LettersRepository()

describe('LettersRepository', () => {
  beforeAll(async () => { await setupTestDb() })
  beforeEach(async () => {
    await db.delete(letterAnalytics)
    await db.delete(letters)
  })

  it('creates a letter in draft status by default', async () => {
    const letter = await lettersRepo.createCore(BASE_LETTER)
    expect(letter.status).toBe('draft')
    expect(letter.id).toBeTypeOf('number')
  })

  it('stamps publishedAt when created already published, leaves it null for drafts', async () => {
    const draft = await lettersRepo.createCore(BASE_LETTER)
    expect(draft.publishedAt).toBeNull()
    const published = await lettersRepo.createCore({ ...BASE_LETTER, status: 'published' })
    expect(published.publishedAt).not.toBeNull()
  })

  it('sets publishedAt on the draft→published transition', async () => {
    const draft = await lettersRepo.createCore(BASE_LETTER)
    await lettersRepo.updateCore(draft.id, { status: 'published' })
    const found = await lettersRepo.getById(draft.id)
    expect(found?.publishedAt).not.toBeNull()
  })

  it('does not bump publishedAt when editing an already-published letter', async () => {
    const published = await lettersRepo.createCore({ ...BASE_LETTER, status: 'published' })
    const firstDate = (await lettersRepo.getById(published.id))?.publishedAt?.getTime()
    await new Promise((r) => setTimeout(r, 5))
    await lettersRepo.updateCore(published.id, { status: 'published', title: 'Edited typo' })
    const after = await lettersRepo.getById(published.id)
    expect(after?.publishedAt?.getTime()).toBe(firstDate)
    expect(after?.title).toBe('Edited typo')
  })

  it('listAll returns both draft and published', async () => {
    await lettersRepo.createCore(BASE_LETTER)
    await lettersRepo.createCore({ ...BASE_LETTER, title: 'Published', status: 'published' })
    const all = await lettersRepo.listAll()
    expect(all).toHaveLength(2)
  })

  it('listPublished returns only published letters, pinned first', async () => {
    const pinned = await lettersRepo.createCore({ ...BASE_LETTER, title: 'Pinned', status: 'published', pinnedAt: new Date() })
    await lettersRepo.createCore({ ...BASE_LETTER, title: 'Normal', status: 'published' })
    await lettersRepo.createCore({ ...BASE_LETTER, title: 'Draft' })
    const published = await lettersRepo.listPublished()
    expect(published).toHaveLength(2)
    expect(published[0].id).toBe(pinned.id)
    expect(published[0].title).toBe('Pinned')
  })

  it('listPublished filters by tag with OR semantics', async () => {
    const a = await lettersRepo.createCore({ ...BASE_LETTER, title: 'A', status: 'published', issueTagIds: [1, 2] })
    const b = await lettersRepo.createCore({ ...BASE_LETTER, title: 'B', status: 'published', issueTagIds: [3] })
    await lettersRepo.createCore({ ...BASE_LETTER, title: 'C', status: 'published', issueTagIds: [] })
    // a draft with a matching tag must never surface
    await lettersRepo.createCore({ ...BASE_LETTER, title: 'D-draft', issueTagIds: [1] })

    const onlyTag1 = await lettersRepo.listPublished([1])
    expect(onlyTag1.map((l) => l.id)).toEqual([a.id])

    const tag2or3 = await lettersRepo.listPublished([2, 3])
    expect(new Set(tag2or3.map((l) => l.id))).toEqual(new Set([a.id, b.id]))

    const noFilter = await lettersRepo.listPublished()
    expect(noFilter).toHaveLength(3)

    const noMatch = await lettersRepo.listPublished([999])
    expect(noMatch).toHaveLength(0)
  })

  it('getById returns the letter', async () => {
    const created = await lettersRepo.createCore(BASE_LETTER)
    const found = await lettersRepo.getById(created.id)
    expect(found?.id).toBe(created.id)
  })

  it('update changes fields', async () => {
    const letter = await lettersRepo.createCore(BASE_LETTER)
    await lettersRepo.updateCore(letter.id, { title: 'Updated' })
    const found = await lettersRepo.getById(letter.id)
    expect(found?.title).toBe('Updated')
  })

  it('delete removes the letter', async () => {
    const letter = await lettersRepo.createCore(BASE_LETTER)
    await lettersRepo.delete(letter.id)
    expect(await lettersRepo.getById(letter.id)).toBeNull()
  })

  it('setPinned sets pinnedAt when pinning, clears when unpinning', async () => {
    const letter = await lettersRepo.createCore(BASE_LETTER)
    await lettersRepo.setPinned(letter.id, true)
    const pinned = await lettersRepo.getById(letter.id)
    expect(pinned?.pinnedAt).not.toBeNull()

    await lettersRepo.setPinned(letter.id, false)
    const unpinned = await lettersRepo.getById(letter.id)
    expect(unpinned?.pinnedAt).toBeNull()
  })

  it('listUnnotifiedPinned returns pinned letters with pin_notified_at null', async () => {
    await lettersRepo.createCore({ ...BASE_LETTER, status: 'published', pinnedAt: new Date() })
    const notified = await lettersRepo.createCore({ ...BASE_LETTER, status: 'published', pinnedAt: new Date(), pinNotifiedAt: new Date() })
    const unnotified = await lettersRepo.listUnnotifiedPinned()
    expect(unnotified.some((l) => l.id === notified.id)).toBe(false)
    expect(unnotified).toHaveLength(1)
  })
})
