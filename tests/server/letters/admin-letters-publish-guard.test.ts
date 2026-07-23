import { vi, describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { createTestApp } from '../../support/test-app'
import request from 'supertest'
import { eq } from 'drizzle-orm'
import { setupTestDb } from '../db-harness'
import { db } from '../../../server/db/client'
import { users, refreshTokens, letters, letterChannels } from '../../../server/db/schema'
import { issueAccessToken } from '../../../server/services/auth-service'

vi.mock('../../../server/services/share-publisher', () => ({
  syncShareForLetter: vi.fn().mockResolvedValue(undefined),
  removeShareForLetter: vi.fn().mockResolvedValue(undefined),
}))

import adminLettersRouter from '../../../server/routes/admin-letters'

const app = createTestApp('/api/admin/letters', adminLettersRouter)
let token: string

describe('admin-letters publish guard', () => {
  beforeAll(async () => { await setupTestDb() })
  beforeEach(async () => {
    await db.delete(letterChannels); await db.delete(refreshTokens); await db.delete(users); await db.delete(letters)
    const [u] = await db.insert(users).values({ label: 'a@x.com', email: 'a@x.com', role: 'admin', createdAt: new Date() }).returning({ id: users.id })
    token = issueAccessToken({ id: u.id, email: 'a@x.com', name: 'A', role: 'admin' })
  })

  it('publishing with an enabled sms channel that has 0 recipients → 400', async () => {
    const res = await request(app).post('/api/admin/letters').set('Authorization', `Bearer ${token}`)
      .send({ title: 'X', status: 'published', channels: [{ kind: 'sms', recipientIds: [], bodyText: 'hi' }] })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/sms/)
    expect(await db.select().from(letters)).toHaveLength(0) // nothing persisted
  })

  it('same letter as a DRAFT → allowed (201)', async () => {
    const res = await request(app).post('/api/admin/letters').set('Authorization', `Bearer ${token}`)
      .send({ title: 'X', status: 'draft', channels: [{ kind: 'sms', recipientIds: [], bodyText: 'hi' }] })
    expect(res.status).toBe(201)
  })

  it('publishing with recipients present → allowed', async () => {
    const res = await request(app).post('/api/admin/letters').set('Authorization', `Bearer ${token}`)
      .send({ title: 'X', status: 'published', channels: [{ kind: 'sms', recipientIds: [1], bodyText: 'hi' }] })
    expect(res.status).toBe(201)
  })

  it('publishing with a disabled zero-recipient channel → allowed', async () => {
    const res = await request(app).post('/api/admin/letters').set('Authorization', `Bearer ${token}`)
      .send({ title: 'X', status: 'published', channels: [{ kind: 'sms', enabled: false, recipientIds: [], bodyText: 'hi' }] })
    expect(res.status).toBe(201)
  })

  it('PUT: setting status to published on an existing draft with a zero-recipient channel → 400, letter left as draft', async () => {
    const created = await request(app).post('/api/admin/letters').set('Authorization', `Bearer ${token}`)
      .send({ title: 'X', status: 'draft', channels: [{ kind: 'sms', recipientIds: [], bodyText: 'hi' }] })
    const id = created.body.letter.id
    const res = await request(app).put(`/api/admin/letters/${id}`).set('Authorization', `Bearer ${token}`)
      .send({ status: 'published', channels: [{ kind: 'sms', recipientIds: [], bodyText: 'hi' }] })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/sms/)
    const list = await db.select().from(letters)
    expect(list.find((l) => l.id === id)?.status).toBe('draft')
  })

  it('PUT: updating an already-published letter without touching channels/status → unaffected by guard', async () => {
    const created = await request(app).post('/api/admin/letters').set('Authorization', `Bearer ${token}`)
      .send({ title: 'X', status: 'published', channels: [{ kind: 'sms', recipientIds: [1], bodyText: 'hi' }] })
    const id = created.body.letter.id
    const res = await request(app).put(`/api/admin/letters/${id}`).set('Authorization', `Bearer ${token}`)
      .send({ title: 'Renamed' })
    expect(res.status).toBe(200)
  })

  it('PUT: publishing via status-only body (no channels key) must still guard the STORED zero-recipient channel', async () => {
    const created = await request(app).post('/api/admin/letters').set('Authorization', `Bearer ${token}`)
      .send({ title: 'X', status: 'draft', channels: [{ kind: 'sms', recipientIds: [], bodyText: 'hi' }] })
    const id = created.body.letter.id
    const res = await request(app).put(`/api/admin/letters/${id}`).set('Authorization', `Bearer ${token}`)
      .send({ status: 'published' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/sms/)
    const list = await db.select().from(letters)
    expect(list.find((l) => l.id === id)?.status).toBe('draft')
  })

  it('PUT: installing a zero-recipient channel on an ALREADY-published letter with no status key → 400, channels left untouched', async () => {
    const created = await request(app).post('/api/admin/letters').set('Authorization', `Bearer ${token}`)
      .send({ title: 'X', status: 'published', channels: [{ kind: 'sms', recipientIds: [1], bodyText: 'hi' }] })
    const id = created.body.letter.id
    const res = await request(app).put(`/api/admin/letters/${id}`).set('Authorization', `Bearer ${token}`)
      .send({ channels: [{ kind: 'sms', recipientIds: [], bodyText: 'hi' }] })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/sms/)
    const stored = await db.select().from(letterChannels).where(eq(letterChannels.letterId, id))
    expect(stored[0].recipientIds).toEqual([1]) // untouched — the bad channel set was never persisted
  })

  it('PUT: demoting an already-published letter to draft while installing a zero-recipient channel → allowed (200)', async () => {
    const created = await request(app).post('/api/admin/letters').set('Authorization', `Bearer ${token}`)
      .send({ title: 'X', status: 'published', channels: [{ kind: 'sms', recipientIds: [1], bodyText: 'hi' }] })
    const id = created.body.letter.id
    const res = await request(app).put(`/api/admin/letters/${id}`).set('Authorization', `Bearer ${token}`)
      .send({ status: 'draft', channels: [{ kind: 'sms', recipientIds: [], bodyText: 'hi' }] })
    expect(res.status).toBe(200)
  })

  it('POST: publishing with the channels key entirely omitted → 400, nothing persisted', async () => {
    const res = await request(app).post('/api/admin/letters').set('Authorization', `Bearer ${token}`)
      .send({ title: 'X', status: 'published' })
    expect(res.status).toBe(400)
    expect(await db.select().from(letters)).toHaveLength(0)
  })

  it('POST: publishing with an empty channels array → 400, nothing persisted', async () => {
    const res = await request(app).post('/api/admin/letters').set('Authorization', `Bearer ${token}`)
      .send({ title: 'X', status: 'published', channels: [] })
    expect(res.status).toBe(400)
    expect(await db.select().from(letters)).toHaveLength(0)
  })
})
