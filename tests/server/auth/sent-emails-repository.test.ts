import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { setupTestDb } from '../db-harness'
import { db } from '../../../server/db/client'
import { sentEmails } from '../../../server/db/schema'
import { SentEmailsRepository } from '../../../server/repositories/sent-emails-repository'

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

  it('setStatus advances the status and stamps last_status_at', async () => {
    await repo.record({ id: 're_1', toEmail: 'a@x.com', template: 'invite', status: 'sent', error: null })
    const at = new Date('2030-01-01')
    await repo.setStatus('re_1', 'delivered', at)
    const [row] = await db.select().from(sentEmails)
    expect(row.status).toBe('delivered')
    expect(row.lastStatusAt.getTime()).toBe(at.getTime())
  })

  it('listPollable returns non-terminal rows within the retention window, oldest-first', async () => {
    const recent = new Date(Date.now() - 60 * 60 * 1000) // 1h ago
    await db.insert(sentEmails).values([
      { id: 'sent1', toEmail: 's1@x.com', template: 't', status: 'sent', createdAt: new Date(recent.getTime() - 2000) },
      { id: 'delayed', toEmail: 's2@x.com', template: 't', status: 'delivery_delayed', createdAt: new Date(recent.getTime() - 1000) },
      { id: 'done', toEmail: 's3@x.com', template: 't', status: 'delivered', createdAt: recent },     // terminal → excluded
      { id: 'stale', toEmail: 's4@x.com', template: 't', status: 'sent', createdAt: new Date('2000-01-01') }, // before window → excluded
    ])
    const sentAfter = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const rows = await repo.listPollable(['delivered', 'bounced', 'failed', 'suppressed', 'canceled', 'complained'], sentAfter, 100)
    expect(rows.map((r) => r.id)).toEqual(['sent1', 'delayed'])
  })

  it('listPollable respects the limit', async () => {
    const base = Date.now() - 60 * 60 * 1000
    await db.insert(sentEmails).values([
      { id: 'p1', toEmail: 'a@x.com', template: 't', status: 'sent', createdAt: new Date(base) },
      { id: 'p2', toEmail: 'b@x.com', template: 't', status: 'sent', createdAt: new Date(base + 1000) },
      { id: 'p3', toEmail: 'c@x.com', template: 't', status: 'sent', createdAt: new Date(base + 2000) },
    ])
    const sentAfter = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const rows = await repo.listPollable([], sentAfter, 2)
    expect(rows.map((r) => r.id)).toEqual(['p1', 'p2'])
  })
})
