// tests/server/admin-letter-contacts-route.test.ts
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import { setupTestDb } from './db-harness'
import { db } from '../../server/db/client'
import { users, refreshTokens, letterContacts, letterChannels, letters } from '../../server/db/schema'
import { issueAccessToken } from '../../server/services/auth-service'
import adminLetterAssetsRouter from '../../server/routes/admin-letter-assets'

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
    await db.delete(refreshTokens); await db.delete(users)
    const adminId = await mkUser('admin@x.com', 'admin')
    adminToken = issueAccessToken({ id: adminId, email: 'admin@x.com', name: 'A', role: 'admin' })
  })

  describe('POST /contacts', () => {
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

    it('passes through photoUrl and mkSiteId', async () => {
      const res = await request(app)
        .post('/api/admin/letters/contacts')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ displayName: 'M', email: 'm@x.com', photoUrl: 'https://p/x.jpg', mkSiteId: 1116 })
      expect(res.status).toBe(201)
      expect(res.body.contact).toMatchObject({ photoUrl: 'https://p/x.jpg', mkSiteId: 1116 })
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
