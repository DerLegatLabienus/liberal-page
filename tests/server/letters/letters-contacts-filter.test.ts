import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import { setupTestDb } from './db-harness'
import { db } from '../../server/db/client'
import { users, refreshTokens, letterContacts } from '../../server/db/schema'
import { issueAccessToken } from '../../server/services/auth-service'
import { FeatureFlagsRepository } from '../../server/repositories/feature-flags-repository'
import lettersRouter from '../../server/routes/letters'

const app = express()
app.use(express.json())
app.use('/api/letters', lettersRouter)
const flags = new FeatureFlagsRepository()
let token: string

describe('GET /api/letters/contacts?channel=', () => {
  beforeAll(async () => { await setupTestDb() })
  beforeEach(async () => {
    await db.delete(refreshTokens); await db.delete(users)
    const [u] = await db.insert(users).values({ label: 'm@x.com', email: 'm@x.com', role: 'member', createdAt: new Date() }).returning({ id: users.id })
    token = issueAccessToken({ id: u.id, email: 'm@x.com', name: 'M', role: 'member' })
    await flags.setFlag('lettersEnabled', true, '')

    await db.delete(letterContacts)
    await db.insert(letterContacts).values([
      { displayName: 'Email only', email: 'e@x.com' },
      { displayName: 'SMS only', phone: '+972520000001', hasWhatsapp: false },
      { displayName: 'WA', phone: '+972520000002', hasWhatsapp: true },
    ])
  })

  it('channel=whatsapp returns only phone+hasWhatsapp contacts', async () => {
    const res = await request(app)
      .get('/api/letters/contacts?channel=whatsapp')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.contacts.map((c: { displayName: string }) => c.displayName)).toEqual(['WA'])
  })

  it('channel=sms returns phone-having contacts regardless of hasWhatsapp', async () => {
    const res = await request(app)
      .get('/api/letters/contacts?channel=sms')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.contacts.map((c: { displayName: string }) => c.displayName).sort()).toEqual(['SMS only', 'WA'])
  })

  it('channel=email returns only email-having contacts', async () => {
    const res = await request(app)
      .get('/api/letters/contacts?channel=email')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.contacts.map((c: { displayName: string }) => c.displayName)).toEqual(['Email only'])
  })

  it('no channel param returns all contacts unfiltered', async () => {
    const res = await request(app)
      .get('/api/letters/contacts')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.contacts).toHaveLength(3)
  })

  it('invalid channel param returns 400', async () => {
    const res = await request(app)
      .get('/api/letters/contacts?channel=bogus')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('invalid channel')
  })
})
