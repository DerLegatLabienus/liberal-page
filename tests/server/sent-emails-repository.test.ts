import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { setupTestDb } from './db-harness'
import { db } from '../../server/db/client'
import { sentEmails } from '../../server/db/schema'
import { SentEmailsRepository } from '../../server/repositories/sent-emails-repository'

const repo = new SentEmailsRepository()

describe('SentEmailsRepository', () => {
  beforeAll(async () => { await setupTestDb() })
  beforeEach(async () => { await db.delete(sentEmails) })

  it('records a send and counts it', async () => {
    await repo.record({ id: 're_1', toEmail: 'a@x.com', template: 'invite', status: 'sent', error: null })
    expect(await repo.count()).toBe(1)
  })

  it('record is idempotent on id', async () => {
    await repo.record({ id: 're_1', toEmail: 'a@x.com', template: 'invite', status: 'sent', error: null })
    await repo.record({ id: 're_1', toEmail: 'a@x.com', template: 'invite', status: 'sent', error: null })
    expect(await repo.count()).toBe(1)
  })

  it('deleteOldest removes the oldest N by createdAt and returns the count', async () => {
    await db.insert(sentEmails).values([
      { id: 'a', toEmail: 'a@x.com', template: 't', status: 'sent', createdAt: new Date('2020-01-01') },
      { id: 'b', toEmail: 'b@x.com', template: 't', status: 'sent', createdAt: new Date('2021-01-01') },
      { id: 'c', toEmail: 'c@x.com', template: 't', status: 'sent', createdAt: new Date('2022-01-01') },
    ])
    const deleted = await repo.deleteOldest(2)
    expect(deleted).toBe(2)
    const remaining = await repo.list(10)
    expect(remaining.map((r) => r.id)).toEqual(['c'])
  })

  it('deleteOldest on empty table returns 0', async () => {
    expect(await repo.deleteOldest(5)).toBe(0)
  })
})
