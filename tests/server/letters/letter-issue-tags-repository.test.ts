import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { setupTestDb } from '../db-harness'
import { db } from '../../../server/db/client'
import { letterIssueTags } from '../../../server/db/schema'
import { LetterIssueTagsRepository } from '../../../server/repositories/letter-issue-tags-repository'

const tagsRepo = new LetterIssueTagsRepository()

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
