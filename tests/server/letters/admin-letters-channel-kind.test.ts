import { vi, describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { createTestApp } from '../../support/test-app'
import request from 'supertest'
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

describe('admin-letters channel kind validation', () => {
  beforeAll(async () => { await setupTestDb() })
  beforeEach(async () => {
    await db.delete(letterChannels); await db.delete(refreshTokens); await db.delete(users); await db.delete(letters)
    const [u] = await db.insert(users).values({ label: 'a@x.com', email: 'a@x.com', role: 'admin', createdAt: new Date() }).returning({ id: users.id })
    token = issueAccessToken({ id: u.id, email: 'a@x.com', name: 'A', role: 'admin' })
  })

  describe('POST', () => {
    it.each(['email', 'sms', 'whatsapp'])('accepts kind "%s"', async (kind) => {
      const res = await request(app).post('/api/admin/letters').set('Authorization', `Bearer ${token}`)
        .send({ title: 'X', status: 'draft', channels: [{ kind, recipientIds: [1], bodyText: 'hi', subject: 'S', bodyHtml: '<p>x</p>' }] })
      expect(res.status).toBe(201)
      expect(res.body.letter.channels.map((c: { kind: string }) => c.kind)).toEqual([kind])
    })

    it('rejects an unknown kind with 400 and writes nothing', async () => {
      const res = await request(app).post('/api/admin/letters').set('Authorization', `Bearer ${token}`)
        .send({ title: 'X', status: 'draft', channels: [{ kind: 'telegram', recipientIds: [1], bodyText: 'hi' }] })
      expect(res.status).toBe(400)
      expect(res.body.error).toMatch(/telegram/)
      expect(res.body.error).toMatch(/email, sms, whatsapp/)
      expect(await db.select().from(letters)).toHaveLength(0)
      expect(await db.select().from(letterChannels)).toHaveLength(0)
    })

    it('rejects a missing kind alongside a valid channel', async () => {
      const res = await request(app).post('/api/admin/letters').set('Authorization', `Bearer ${token}`)
        .send({ title: 'X', status: 'draft', channels: [{ kind: 'email', recipientIds: [1] }, { recipientIds: [1], bodyText: 'hi' }] })
      expect(res.status).toBe(400)
      expect(await db.select().from(letters)).toHaveLength(0)
    })
  })

  describe('PUT', () => {
    async function createDraft() {
      const created = await request(app).post('/api/admin/letters').set('Authorization', `Bearer ${token}`)
        .send({ title: 'Original', status: 'draft', channels: [{ kind: 'sms', recipientIds: [1], bodyText: 'hi' }] })
      return created.body.letter.id as number
    }

    it.each(['email', 'sms', 'whatsapp'])('accepts kind "%s"', async (kind) => {
      const id = await createDraft()
      const res = await request(app).put(`/api/admin/letters/${id}`).set('Authorization', `Bearer ${token}`)
        .send({ channels: [{ kind, recipientIds: [1], bodyText: 'hi', subject: 'S', bodyHtml: '<p>x</p>' }] })
      expect(res.status).toBe(200)
      expect(res.body.letter.channels.map((c: { kind: string }) => c.kind)).toEqual([kind])
    })

    it('rejects an unknown kind with 400 and leaves the letter and its channels untouched', async () => {
      const id = await createDraft()
      const res = await request(app).put(`/api/admin/letters/${id}`).set('Authorization', `Bearer ${token}`)
        .send({ title: 'Renamed', channels: [{ kind: 'Email', recipientIds: [1], bodyText: 'hi' }] })
      expect(res.status).toBe(400)
      expect(res.body.error).toMatch(/Email/)
      const [stored] = await db.select().from(letters)
      expect(stored.title).toBe('Original')
      const storedChannels = await db.select().from(letterChannels)
      expect(storedChannels.map((c) => c.kind)).toEqual(['sms'])
    })
  })
})
