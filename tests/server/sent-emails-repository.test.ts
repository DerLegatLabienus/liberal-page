import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { setupTestDb } from './db-harness'
import { db } from '../../server/db/client'
import { sentEmails } from '../../server/db/schema'
import { SentEmailsRepository } from '../../server/repositories/sent-emails-repository'

describe('SentEmailsRepository', () => {
  const repo = new SentEmailsRepository()
  beforeAll(async () => { await setupTestDb() })
  beforeEach(async () => { await db.delete(sentEmails) })

  it('record() + get() round-trips', async () => {
    await repo.record({ id: 'm1', toEmail: 'a@b.c', template: 'invite', subject: 'S', status: 'sent' })
    expect(await repo.get('m1')).toMatchObject({ id: 'm1', status: 'sent', toEmail: 'a@b.c' })
  })

  it('updateStatus() updates an existing row', async () => {
    await repo.record({ id: 'm1', toEmail: 'a@b.c', template: 'invite', subject: 'S', status: 'sent' })
    await repo.updateStatus('m1', 'delivered')
    expect((await repo.get('m1'))?.status).toBe('delivered')
  })

  it('updateStatus() on unknown id is a no-op (does not throw)', async () => {
    await expect(repo.updateStatus('ghost', 'bounced')).resolves.toBeUndefined()
    expect(await repo.get('ghost')).toBeNull()
  })
})
