import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { setupTestDb } from '../db-harness'
import { db } from '../../../server/db/client'
import { letterTemplates } from '../../../server/db/schema'
import { LetterTemplatesRepository } from '../../../server/repositories/letter-templates-repository'

const templatesRepo = new LetterTemplatesRepository()

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
