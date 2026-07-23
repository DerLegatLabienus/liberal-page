// tests/server/admin-letter-contacts-route.test.ts
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import express from 'express'
import request from 'supertest'
import { setupTestDb } from '../db-harness'
import { db } from '../../../server/db/client'
import { users, refreshTokens, letterContacts, letterChannels, letters, knessetMembersCache } from '../../../server/db/schema'
import { issueAccessToken } from '../../../server/services/auth-service'
import adminLetterAssetsRouter from '../../../server/routes/admin-letter-assets'

// The live MK-photo lookup is a network call — mock it so contact resolution is deterministic.
vi.mock('../../../server/services/knesset-scraper', () => ({ fetchMkImageUrl: vi.fn() }))
import { fetchMkImageUrl } from '../../../server/services/knesset-scraper'
const mockFetchMkImageUrl = vi.mocked(fetchMkImageUrl)

const LIVE_MK_PHOTO = 'https://fs.knesset.gov.il/globaldocs/MK/1116/1_1116_3_19861.jpeg'

const app = express()
app.use(express.json())
app.use('/api/admin/letters', adminLetterAssetsRouter)

let adminToken: string

async function mkUser(email: string, role: string) {
  const [u] = await db.insert(users).values({ label: email, email, role, createdAt: new Date() }).returning({ id: users.id })
  return u.id
}

describe('admin letter contacts routes', () => {
  beforeAll(async () => { await setupTestDb() })
  beforeEach(async () => {
    await db.delete(letterChannels); await db.delete(letters); await db.delete(letterContacts)
    await db.delete(knessetMembersCache)
    await db.delete(refreshTokens); await db.delete(users)
    mockFetchMkImageUrl.mockReset()
    const adminId = await mkUser('admin@x.com', 'admin')
    adminToken = issueAccessToken({ id: adminId, email: 'admin@x.com', name: 'A', role: 'admin' })
  })

  describe('POST /contacts', () => {
    it('resolves an MK-linked contact photo from the live header API and stores it', async () => {
      mockFetchMkImageUrl.mockResolvedValue(LIVE_MK_PHOTO)
      const res = await request(app)
        .post('/api/admin/letters/contacts')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ displayName: 'MK', phone: '0501234567', mkSiteId: 1116 })
      expect(res.status).toBe(201)
      expect(mockFetchMkImageUrl).toHaveBeenCalledWith(1116)
      expect(res.body.contact.photoUrl).toBe(LIVE_MK_PHOTO)
    })

    it('falls back to the cached member photo when the live API returns null', async () => {
      mockFetchMkImageUrl.mockResolvedValue(null)
      await db.insert(knessetMembersCache).values({
        siteId: 1116, name: 'דן אילוז', party: 'הליכוד',
        photoUrl: 'https://cached/mk_1116.jpg',
        isLiberal: true, isSupporter: false, cachedAt: new Date(),
      })
      const res = await request(app)
        .post('/api/admin/letters/contacts')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ displayName: 'MK', phone: '0501234567', mkSiteId: 1116 })
      expect(res.status).toBe(201)
      expect(res.body.contact.photoUrl).toBe('https://cached/mk_1116.jpg')
    })

    it('stores null when neither the live API nor the cache has a photo', async () => {
      mockFetchMkImageUrl.mockResolvedValue(null)
      const res = await request(app)
        .post('/api/admin/letters/contacts')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ displayName: 'MK', phone: '0501234567', mkSiteId: 99999 })
      expect(res.status).toBe(201)
      expect(res.body.contact.photoUrl).toBeNull()
    })

    it('an MK link overrides a manually-typed photo URL', async () => {
      mockFetchMkImageUrl.mockResolvedValue(LIVE_MK_PHOTO)
      const res = await request(app)
        .post('/api/admin/letters/contacts')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ displayName: 'MK', phone: '0501234567', mkSiteId: 1116, photoUrl: 'https://custom/x.jpg' })
      expect(res.body.contact.photoUrl).toBe(LIVE_MK_PHOTO)
    })

    it('keeps the provided photo URL when there is no MK link', async () => {
      const res = await request(app)
        .post('/api/admin/letters/contacts')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ displayName: 'C', email: 'c@x.com', photoUrl: 'https://custom/y.jpg' })
      expect(res.body.contact.photoUrl).toBe('https://custom/y.jpg')
      expect(mockFetchMkImageUrl).not.toHaveBeenCalled()
    })

    it('creates an email-only contact (backward compatible)', async () => {
      const res = await request(app)
        .post('/api/admin/letters/contacts')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ displayName: 'E', email: 'e@x.com' })
      expect(res.status).toBe(201)
      expect(res.body.contact).toMatchObject({ displayName: 'E', email: 'e@x.com', phone: null, hasWhatsapp: false })
    })

    it('creates a phone-only contact, normalizing a local Israeli number to E.164', async () => {
      const res = await request(app)
        .post('/api/admin/letters/contacts')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ displayName: 'P', phone: '0521234567', hasWhatsapp: true })
      expect(res.status).toBe(201)
      expect(res.body.contact).toMatchObject({ displayName: 'P', email: null, phone: '+972521234567', hasWhatsapp: true })
    })

    it('stores mkSiteId and resolves its photo (MK link overrides the sent photoUrl)', async () => {
      mockFetchMkImageUrl.mockResolvedValue(LIVE_MK_PHOTO)
      const res = await request(app)
        .post('/api/admin/letters/contacts')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ displayName: 'M', email: 'm@x.com', photoUrl: 'https://p/x.jpg', mkSiteId: 1116 })
      expect(res.status).toBe(201)
      expect(res.body.contact).toMatchObject({ photoUrl: LIVE_MK_PHOTO, mkSiteId: 1116 })
    })

    it('400 when neither email nor phone is provided', async () => {
      const res = await request(app)
        .post('/api/admin/letters/contacts')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ displayName: 'X' })
      expect(res.status).toBe(400)
    })

    it('400 for an invalid phone number', async () => {
      const res = await request(app)
        .post('/api/admin/letters/contacts')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ displayName: 'X', phone: 'not-a-phone' })
      expect(res.status).toBe(400)
      expect(res.body.error).toMatch(/phone/i)
    })
  })

  describe('PUT /contacts/:id', () => {
    it('updates and normalizes phone', async () => {
      const create = await request(app)
        .post('/api/admin/letters/contacts')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ displayName: 'U', email: 'u@x.com' })
      const id = create.body.contact.id
      const res = await request(app)
        .put(`/api/admin/letters/contacts/${id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ displayName: 'U2', email: 'u@x.com', phone: '0501112222' })
      expect(res.status).toBe(200)
      const list = await request(app).get('/api/admin/letters/contacts').set('Authorization', `Bearer ${adminToken}`)
      const row = list.body.contacts.find((c: { id: number }) => c.id === id)
      expect(row).toMatchObject({ displayName: 'U2', phone: '+972501112222' })
    })

    it('400 for an invalid phone on update', async () => {
      const create = await request(app)
        .post('/api/admin/letters/contacts')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ displayName: 'U', email: 'u2@x.com' })
      const id = create.body.contact.id
      const res = await request(app)
        .put(`/api/admin/letters/contacts/${id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ displayName: 'U', email: 'u2@x.com', phone: 'garbage' })
      expect(res.status).toBe(400)
    })
  })

  describe('DELETE /contacts/:id', () => {
    it('deletes an unreferenced contact', async () => {
      const create = await request(app)
        .post('/api/admin/letters/contacts')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ displayName: 'D', email: 'd@x.com' })
      const id = create.body.contact.id
      const res = await request(app).delete(`/api/admin/letters/contacts/${id}`).set('Authorization', `Bearer ${adminToken}`)
      expect(res.status).toBe(200)
      const list = await request(app).get('/api/admin/letters/contacts').set('Authorization', `Bearer ${adminToken}`)
      expect(list.body.contacts.find((c: { id: number }) => c.id === id)).toBeUndefined()
    })

    it('409s when the contact is referenced by a letter, and does not delete it', async () => {
      const create = await request(app)
        .post('/api/admin/letters/contacts')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ displayName: 'Ref', email: 'ref@x.com' })
      const id = create.body.contact.id
      const [l] = await db.insert(letters).values({ title: 'T', status: 'draft', priority: 'normal' }).returning()
      await db.insert(letterChannels).values({ letterId: l.id, kind: 'email', recipientIds: [id], subject: 'S', bodyHtml: '<p>x</p>' })

      const res = await request(app).delete(`/api/admin/letters/contacts/${id}`).set('Authorization', `Bearer ${adminToken}`)
      expect(res.status).toBe(409)
      expect(res.body.error).toMatch(/used by a letter/)

      const list = await request(app).get('/api/admin/letters/contacts').set('Authorization', `Bearer ${adminToken}`)
      expect(list.body.contacts.find((c: { id: number }) => c.id === id)).toBeDefined()
    })
  })
})
