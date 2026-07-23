import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import { setupTestDb } from './db-harness'
import { db } from '../../server/db/client'
import { users, refreshTokens, letters, letterChannels } from '../../server/db/schema'
import { issueAccessToken } from '../../server/services/auth-service'
import adminLettersRouter from '../../server/routes/admin-letters'

const app = express()
app.use(express.json())
app.use('/api/admin/letters', adminLettersRouter)
let token: string

describe('POST /api/admin/letters with channels', () => {
  beforeAll(async () => { await setupTestDb() })
  beforeEach(async () => {
    await db.delete(letterChannels); await db.delete(refreshTokens); await db.delete(users); await db.delete(letters)
    const [u] = await db.insert(users).values({ label: 'a@x.com', email: 'a@x.com', role: 'admin', createdAt: new Date() }).returning({ id: users.id })
    token = issueAccessToken({ id: u.id, email: 'a@x.com', name: 'A', role: 'admin' })
  })

  it('creates a letter with email + sms channels', async () => {
    const res = await request(app)
      .post('/api/admin/letters')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Housing reform', status: 'draft', priority: 'high', issueTagIds: [],
        channels: [
          { kind: 'email', recipientIds: [1], bodyText: 'plain', subject: 'S', bodyHtml: '<p>x</p>' },
          { kind: 'sms', recipientIds: [1], bodyText: 'קצר' },
        ],
      })
    expect(res.status).toBe(201)
    expect(res.body.letter.channels.map((c: { kind: string }) => c.kind).sort()).toEqual(['email', 'sms'])
    const chans = await db.select().from(letterChannels)
    expect(chans.map((c) => c.kind).sort()).toEqual(['email', 'sms'])
  })

  it('updates a letter and replaces its channels', async () => {
    const created = await request(app)
      .post('/api/admin/letters')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Initial', status: 'draft', priority: 'normal', issueTagIds: [],
        channels: [{ kind: 'email', recipientIds: [1], bodyText: 'body', subject: 'S', bodyHtml: '<p>x</p>' }],
      })
    const id = created.body.letter.id

    const res = await request(app)
      .put(`/api/admin/letters/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Updated', channels: [{ kind: 'whatsapp', recipientIds: [2], bodyText: 'hi' }] })

    expect(res.status).toBe(200)
    expect(res.body.letter.title).toBe('Updated')
    expect(res.body.letter.channels.map((c: { kind: string }) => c.kind)).toEqual(['whatsapp'])
    const chans = await db.select().from(letterChannels)
    expect(chans).toHaveLength(1)
    expect(chans[0].kind).toBe('whatsapp')
  })
})
