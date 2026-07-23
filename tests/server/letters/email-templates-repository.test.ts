import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { setupTestDb } from './db-harness'
import { db } from '../../server/db/client'
import { emailTemplates } from '../../server/db/schema'
import { EmailTemplatesRepository } from '../../server/repositories/email-templates-repository'

describe('EmailTemplatesRepository', () => {
  const repo = new EmailTemplatesRepository()
  beforeAll(async () => { await setupTestDb() })
  beforeEach(async () => { await db.delete(emailTemplates); repo._resetCache() })

  it('get() returns null for unknown template', async () => {
    expect(await repo.get('nope')).toBeNull()
  })

  it('update() upserts and get() round-trips', async () => {
    await repo.update('invite', { subject: 'S', html: '<p>hi</p>' })
    const t = await repo.get('invite')
    expect(t).toMatchObject({ name: 'invite', subject: 'S', html: '<p>hi</p>' })
  })

  it('update() overwrites and clears cache', async () => {
    await repo.update('invite', { subject: 'A', html: '<p>a</p>' })
    await repo.get('invite') // populate cache
    await repo.update('invite', { subject: 'B', html: '<p>b</p>' })
    expect((await repo.get('invite'))?.subject).toBe('B')
  })

  it('getAll() lists all templates', async () => {
    await repo.update('invite', { subject: 'S', html: 'x' })
    await repo.update('_layout', { subject: '', html: 'y' })
    const all = await repo.getAll()
    expect(all.map((t) => t.name).sort()).toEqual(['_layout', 'invite'])
  })
})
