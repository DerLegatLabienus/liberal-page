import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { setupTestDb } from '../db-harness'
import { db } from '../../../server/db/client'
import { letterIssueTags, letterContacts, letterTemplates, letters, letterAnalytics } from '../../../server/db/schema'
import { LetterIssueTagsRepository } from '../../../server/repositories/letter-issue-tags-repository'
import { LetterContactsRepository } from '../../../server/repositories/letter-contacts-repository'
import { LetterTemplatesRepository } from '../../../server/repositories/letter-templates-repository'
import { LettersRepository } from '../../../server/repositories/letters-repository'
import { LetterAnalyticsRepository } from '../../../server/repositories/letter-analytics-repository'

const tagsRepo = new LetterIssueTagsRepository()
const contactsRepo = new LetterContactsRepository()
const templatesRepo = new LetterTemplatesRepository()
const lettersRepo = new LettersRepository()
const analyticsRepo = new LetterAnalyticsRepository()

const BASE_LETTER = {
  title: 'Test Letter',
  issueTagIds: [] as number[],
}

describe('LetterIssueTagsRepository', () => {
  beforeAll(async () => { await setupTestDb() })
  beforeEach(async () => { await db.delete(letterIssueTags) })

  it('creates and lists tags', async () => {
    await tagsRepo.create({ name: 'חירות אזרחית', slug: 'civil-liberties' })
    const tags = await tagsRepo.list()
    expect(tags).toHaveLength(1)
    expect(tags[0].name).toBe('חירות אזרחית')
    expect(tags[0].slug).toBe('civil-liberties')
  })

  it('updates a tag name and slug', async () => {
    const tag = await tagsRepo.create({ name: 'old', slug: 'old-slug' })
    await tagsRepo.update(tag.id, { name: 'new', slug: 'new-slug' })
    const [updated] = await tagsRepo.list()
    expect(updated.name).toBe('new')
  })

  it('deletes a tag', async () => {
    const tag = await tagsRepo.create({ name: 'temp', slug: 'temp' })
    await tagsRepo.delete(tag.id)
    expect(await tagsRepo.list()).toHaveLength(0)
  })
})

describe('LetterContactsRepository', () => {
  beforeAll(async () => { await setupTestDb() })
  beforeEach(async () => { await db.delete(letterContacts) })

  it('creates and lists contacts', async () => {
    await contactsRepo.create({ displayName: 'חיים כץ', email: 'haim@knesset.gov.il', category: 'mk' })
    const contacts = await contactsRepo.list()
    expect(contacts).toHaveLength(1)
    expect(contacts[0].displayName).toBe('חיים כץ')
  })

  it('searches contacts by query string', async () => {
    await contactsRepo.create({ displayName: 'חיים כץ', email: 'haim@knesset.gov.il', category: 'mk' })
    await contactsRepo.create({ displayName: 'אורי מקלב', email: 'uri@knesset.gov.il', category: 'mk' })
    const results = await contactsRepo.search('חיים')
    expect(results).toHaveLength(1)
    expect(results[0].displayName).toBe('חיים כץ')
  })

  it('deletes a contact', async () => {
    const c = await contactsRepo.create({ displayName: 'temp', email: 'temp@example.com', category: 'custom' })
    await contactsRepo.delete(c.id)
    expect(await contactsRepo.list()).toHaveLength(0)
  })

  it('bulkUpsert is idempotent: seeding twice yields no duplicates, preserves categories', async () => {
    const seed = [
      { displayName: 'אבי דיכטר', email: 'davraham@knesset.gov.il', category: 'mk' },
      { displayName: 'משרד הביטחון', email: 'dover@mod.gov.il', category: 'ministry' },
      { displayName: 'משרד הבריאות', email: 'dover@moh.gov.il', category: 'ministry' },
    ]
    await contactsRepo.bulkUpsert(seed)
    await contactsRepo.bulkUpsert(seed) // re-run must not duplicate

    const all = await contactsRepo.list()
    expect(all).toHaveLength(3)
    expect(all.filter((c) => c.category === 'mk')).toHaveLength(1)
    expect(all.filter((c) => c.category === 'ministry')).toHaveLength(2)
    // unique email is the conflict key
    expect(new Set(all.map((c) => c.email)).size).toBe(3)
  })

  it('bulkUpsert does not clobber an existing manually-created contact on conflict', async () => {
    await contactsRepo.create({ displayName: 'Custom Name', email: 'dover@mod.gov.il', category: 'custom' })
    await contactsRepo.bulkUpsert([{ displayName: 'משרד הביטחון', email: 'dover@mod.gov.il', category: 'ministry' }])

    const all = await contactsRepo.list()
    expect(all).toHaveLength(1)
    expect(all[0].displayName).toBe('Custom Name')
    expect(all[0].category).toBe('custom')
  })

  it('bulkUpsert is a no-op on empty input', async () => {
    await contactsRepo.bulkUpsert([])
    expect(await contactsRepo.list()).toHaveLength(0)
  })
})

describe('LetterTemplatesRepository', () => {
  beforeAll(async () => { await setupTestDb() })
  beforeEach(async () => { await db.delete(letterTemplates) })

  it('creates and lists templates', async () => {
    await templatesRepo.create({ name: 'formal', html: '<table>{{CONTENT}}</table>' })
    const templates = await templatesRepo.list()
    expect(templates).toHaveLength(1)
    expect(templates[0].name).toBe('formal')
  })

  it('retrieves a template by id', async () => {
    const t = await templatesRepo.create({ name: 'minimal', html: '{{CONTENT}}' })
    const found = await templatesRepo.getById(t.id)
    expect(found?.html).toBe('{{CONTENT}}')
  })

  it('updates template html', async () => {
    const t = await templatesRepo.create({ name: 'advocacy', html: 'old' })
    await templatesRepo.update(t.id, { html: 'new {{CONTENT}}' })
    const updated = await templatesRepo.getById(t.id)
    expect(updated?.html).toBe('new {{CONTENT}}')
  })

  it('deletes a template', async () => {
    const t = await templatesRepo.create({ name: 'temp', html: '{{CONTENT}}' })
    await templatesRepo.delete(t.id)
    expect(await templatesRepo.list()).toHaveLength(0)
  })
})

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

describe('LetterAnalyticsRepository', () => {
  beforeAll(async () => { await setupTestDb() })
  beforeEach(async () => {
    await db.delete(letterAnalytics)
    await db.delete(letters)
  })

  it('records a send event into both day and lifetime buckets', async () => {
    const letter = await lettersRepo.createCore(BASE_LETTER)
    const now = new Date('2026-06-14T10:00:00Z')
    await analyticsRepo.record(letter.id, 'mailto', now)

    const stats = await analyticsRepo.getForLetter(letter.id)
    expect(stats.lifetime?.total).toBe(1)
    expect(stats.lifetime?.breakdown).toEqual({ mailto: 1 })
    expect(stats.daily).toHaveLength(1)
    expect(stats.daily[0].bucket).toBe('2026-06-14')
  })

  it('accumulates repeated events', async () => {
    const letter = await lettersRepo.createCore(BASE_LETTER)
    const now = new Date('2026-06-14T10:00:00Z')
    await analyticsRepo.record(letter.id, 'copy', now)
    await analyticsRepo.record(letter.id, 'mailto', now)
    await analyticsRepo.record(letter.id, 'copy', now)

    const stats = await analyticsRepo.getForLetter(letter.id)
    expect(stats.lifetime?.total).toBe(3)
    expect(stats.lifetime?.breakdown).toEqual({ copy: 2, mailto: 1 })
  })

  it('getLifetimeForLetters returns batched totals keyed by letter, omitting letters with no sends', async () => {
    const now = new Date('2026-06-14T10:00:00Z')
    const a = await lettersRepo.createCore({ ...BASE_LETTER, title: 'A' })
    const b = await lettersRepo.createCore({ ...BASE_LETTER, title: 'B' })
    const c = await lettersRepo.createCore({ ...BASE_LETTER, title: 'C' }) // no sends
    await analyticsRepo.record(a.id, 'mailto', now)
    await analyticsRepo.record(a.id, 'copy', now)
    await analyticsRepo.record(b.id, 'mailto', now)

    const map = await analyticsRepo.getLifetimeForLetters([a.id, b.id, c.id])
    expect(map.get(a.id)).toEqual({ total: 2, breakdown: { mailto: 1, copy: 1 } })
    expect(map.get(b.id)?.total).toBe(1)
    expect(map.has(c.id)).toBe(false)
    expect(await analyticsRepo.getLifetimeForLetters([])).toEqual(new Map())
  })
})
