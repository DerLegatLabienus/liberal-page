import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import express from 'express'
import request from 'supertest'
import { setupTestDb } from './db-harness'
import { db } from '../../server/db/client'
import { users, allowedEmails, refreshTokens } from '../../server/db/schema'

// Mock only the provider verifiers; keep real JWT/refresh/allowlist logic.
vi.mock('../../server/services/auth-service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/services/auth-service')>()
  return { ...actual, verifyGoogleIdToken: vi.fn() }
})
vi.mock('../../server/services/auth-providers/microsoft', () => ({ verifyMicrosoftIdToken: vi.fn() }))

import { verifyGoogleIdToken } from '../../server/services/auth-service'
import { verifyMicrosoftIdToken } from '../../server/services/auth-providers/microsoft'
import { AuthError } from '../../server/services/auth-service'
import authRouter from '../../server/routes/auth'

const app = express()
app.use(express.json())
app.use('/api/auth', authRouter)

function asGoogle(email: string, sub = 'gsub', name = 'Name') {
  vi.mocked(verifyGoogleIdToken).mockResolvedValueOnce({ email, sub, name })
}

function asMicrosoft(email: string, sub = 'ms-sub', name = 'Name') {
  vi.mocked(verifyMicrosoftIdToken).mockResolvedValueOnce({ provider: 'microsoft', sub, email, name })
}

describe('auth routes', () => {
  beforeAll(async () => { await setupTestDb() })
  beforeEach(async () => {
    await db.delete(refreshTokens); await db.delete(allowedEmails); await db.delete(users)
    vi.clearAllMocks()
  })

  it('POST /google: allowed email signs in and gets tokens + user', async () => {
    await db.insert(allowedEmails).values({ email: 'a@x.com', role: 'admin', createdAt: new Date() })
    asGoogle('a@x.com')
    const res = await request(app).post('/api/auth/google').send({ idToken: 'tok' })
    expect(res.status).toBe(200)
    expect(res.body.accessToken).toBeTruthy()
    expect(res.body.refreshToken).toBeTruthy()
    expect(res.body.user).toMatchObject({ email: 'a@x.com', role: 'admin' })
  })

  it('POST /google: not-invited email is rejected with 403', async () => {
    asGoogle('stranger@x.com')
    const res = await request(app).post('/api/auth/google').send({ idToken: 'tok' })
    expect(res.status).toBe(403)
    expect(await db.select().from(users)).toHaveLength(0)
  })

  it('POST /google: invalid Google token → 401', async () => {
    vi.mocked(verifyGoogleIdToken).mockRejectedValueOnce(new Error('bad'))
    const res = await request(app).post('/api/auth/google').send({ idToken: 'tok' })
    expect(res.status).toBe(401)
  })

  it('POST /refresh rotates the token; the old one then fails', async () => {
    await db.insert(allowedEmails).values({ email: 'a@x.com', role: 'member', createdAt: new Date() })
    asGoogle('a@x.com')
    const login = await request(app).post('/api/auth/google').send({ idToken: 'tok' })
    const oldRefresh = login.body.refreshToken

    const refreshed = await request(app).post('/api/auth/refresh').send({ refreshToken: oldRefresh })
    expect(refreshed.status).toBe(200)
    expect(refreshed.body.refreshToken).not.toBe(oldRefresh)

    const reused = await request(app).post('/api/auth/refresh').send({ refreshToken: oldRefresh })
    expect(reused.status).toBe(401)
  })

  it('POST /logout deletes the refresh token', async () => {
    await db.insert(allowedEmails).values({ email: 'a@x.com', role: 'member', createdAt: new Date() })
    asGoogle('a@x.com')
    const login = await request(app).post('/api/auth/google').send({ idToken: 'tok' })
    await request(app).post('/api/auth/logout').send({ refreshToken: login.body.refreshToken })
    expect(await db.select().from(refreshTokens)).toHaveLength(0)
  })

  it('POST /microsoft: allowed email signs in and gets tokens + user', async () => {
    await db.insert(allowedEmails).values({ email: 'a@x.com', role: 'member', createdAt: new Date() })
    asMicrosoft('a@x.com')
    const res = await request(app).post('/api/auth/microsoft').send({ idToken: 'tok' })
    expect(res.status).toBe(200)
    expect(res.body.accessToken).toBeTruthy()
    expect(res.body.user).toMatchObject({ email: 'a@x.com', role: 'member' })
  })

  it('POST /microsoft: provider not configured → 503', async () => {
    vi.mocked(verifyMicrosoftIdToken).mockRejectedValueOnce(new AuthError('provider_unconfigured'))
    const res = await request(app).post('/api/auth/microsoft').send({ idToken: 'tok' })
    expect(res.status).toBe(503)
  })

  it('POST /microsoft: invalid token → 401', async () => {
    vi.mocked(verifyMicrosoftIdToken).mockRejectedValueOnce(new AuthError('invalid_token'))
    const res = await request(app).post('/api/auth/microsoft').send({ idToken: 'tok' })
    expect(res.status).toBe(401)
  })

  it('POST /unknown-provider → 400', async () => {
    const res = await request(app).post('/api/auth/facebook').send({ idToken: 'tok' })
    expect(res.status).toBe(400)
  })

  it('GET /me returns the current user with a valid access token', async () => {
    await db.insert(allowedEmails).values({ email: 'a@x.com', role: 'member', createdAt: new Date() })
    asGoogle('a@x.com')
    const login = await request(app).post('/api/auth/google').send({ idToken: 'tok' })
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${login.body.accessToken}`)
    expect(me.status).toBe(200)
    expect(me.body.user.email).toBe('a@x.com')
    expect((await request(app).get('/api/auth/me')).status).toBe(401)
  })
})
