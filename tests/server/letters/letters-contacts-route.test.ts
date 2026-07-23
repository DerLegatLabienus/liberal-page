import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import { setupTestDb } from './db-harness'
import { db } from '../../server/db/client'
import { users, refreshTokens } from '../../server/db/schema'
import { issueAccessToken } from '../../server/services/auth-service'
import { FeatureFlagsRepository } from '../../server/repositories/feature-flags-repository'
import lettersRouter from '../../server/routes/letters'

const app = express()
app.use(express.json())
app.use('/api/letters', lettersRouter)
const flags = new FeatureFlagsRepository()
let token: string

describe('GET /api/letters/contacts', () => {
  beforeAll(async () => { await setupTestDb() })
  beforeEach(async () => {
    await db.delete(refreshTokens); await db.delete(users)
    const [u] = await db.insert(users).values({ label: 'm@x.com', email: 'm@x.com', role: 'member', createdAt: new Date() }).returning({ id: users.id })
    token = issueAccessToken({ id: u.id, email: 'm@x.com', name: 'M', role: 'member' })
    await flags.setFlag('lettersEnabled', true, '')
  })

  it('401 for anonymous', async () => {
    expect((await request(app).get('/api/letters/contacts')).status).toBe(401)
  })

  it('returns contacts and filters by q for an authed member', async () => {
    // The seed migration populated contacts; assert the shape and that q filters.
    const all = await request(app).get('/api/letters/contacts').set('Authorization', `Bearer ${token}`)
    expect(all.status).toBe(200)
    expect(Array.isArray(all.body.contacts)).toBe(true)
    expect(all.body.contacts.length).toBeGreaterThan(0)
    const filtered = await request(app).get('/api/letters/contacts?q=zzz-no-match-zzz').set('Authorization', `Bearer ${token}`)
    expect(filtered.body.contacts).toHaveLength(0)
  })

  it('404 when lettersEnabled is off', async () => {
    await flags.setFlag('lettersEnabled', false, '')
    expect((await request(app).get('/api/letters/contacts').set('Authorization', `Bearer ${token}`)).status).toBe(404)
  })
})
