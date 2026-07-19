import { vi, describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import { setupTestDb } from './db-harness'
import { db } from '../../server/db/client'
import { users, refreshTokens, letters } from '../../server/db/schema'
import { issueAccessToken } from '../../server/services/auth-service'
import { FeatureFlagsRepository } from '../../server/repositories/feature-flags-repository'

const sync = vi.fn().mockResolvedValue(undefined)
const remove = vi.fn().mockResolvedValue(undefined)
vi.mock('../../server/services/share-publisher', () => ({
  syncShareForLetter: (...a: unknown[]) => sync(...a),
  removeShareForLetter: (...a: unknown[]) => remove(...a),
}))

import adminLettersRouter from '../../server/routes/admin-letters'

const app = express()
app.use(express.json())
app.use('/api/admin/letters', adminLettersRouter)
let token: string

describe('GET /api/admin/letters shareUrl', () => {
  beforeAll(async () => { await setupTestDb() })
  beforeEach(async () => {
    sync.mockClear(); remove.mockClear()
    await db.delete(refreshTokens); await db.delete(users); await db.delete(letters)
    const [u] = await db.insert(users).values({ label: 'a@x.com', email: 'a@x.com', role: 'admin', createdAt: new Date() }).returning({ id: users.id })
    token = issueAccessToken({ id: u.id, email: 'a@x.com', name: 'A', role: 'admin' })
  })
  afterEach(() => { vi.unstubAllEnvs() })

  it('published letter with R2 + publicBaseUrl configured + publicSharePages ON → shareUrl; draft → null', async () => {
    vi.stubEnv('R2_ACCOUNT_ID', 'a'); vi.stubEnv('R2_ACCESS_KEY_ID', 'b')
    vi.stubEnv('R2_SECRET_ACCESS_KEY', 'c'); vi.stubEnv('R2_BUCKET', 'd')
    vi.stubEnv('R2_PUBLIC_BASE_URL', 'https://cdn.example')
    await new FeatureFlagsRepository().setFlag('publicSharePages', true, null)
    const [pub] = await db.insert(letters).values({ title: 'P', status: 'published', priority: 'normal', publishedAt: new Date() }).returning()
    const [draft] = await db.insert(letters).values({ title: 'D', status: 'draft', priority: 'normal' }).returning()

    const res = await request(app).get('/api/admin/letters').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    const byId = Object.fromEntries(res.body.letters.map((l: { id: number; shareUrl: string | null }) => [l.id, l.shareUrl]))
    expect(byId[pub.id]).toBe(`https://cdn.example/letter/${pub.id}.html`)
    expect(byId[draft.id]).toBeNull()
  })

  it('published but R2 unconfigured → shareUrl null', async () => {
    vi.stubEnv('R2_PUBLIC_BASE_URL', ''); vi.stubEnv('R2_ACCOUNT_ID', '')
    await new FeatureFlagsRepository().setFlag('publicSharePages', true, null)
    const [pub] = await db.insert(letters).values({ title: 'P', status: 'published', priority: 'normal', publishedAt: new Date() }).returning()
    const res = await request(app).get('/api/admin/letters').set('Authorization', `Bearer ${token}`)
    expect(res.body.letters.find((l: { id: number }) => l.id === pub.id).shareUrl).toBeNull()
  })

  it('published + R2 configured but publicSharePages flag OFF → shareUrl null', async () => {
    vi.stubEnv('R2_ACCOUNT_ID', 'a'); vi.stubEnv('R2_ACCESS_KEY_ID', 'b')
    vi.stubEnv('R2_SECRET_ACCESS_KEY', 'c'); vi.stubEnv('R2_BUCKET', 'd')
    vi.stubEnv('R2_PUBLIC_BASE_URL', 'https://cdn.example')
    await new FeatureFlagsRepository().setFlag('publicSharePages', false, null)
    const [pub] = await db.insert(letters).values({ title: 'P', status: 'published', priority: 'normal', publishedAt: new Date() }).returning()
    const res = await request(app).get('/api/admin/letters').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.letters.find((l: { id: number }) => l.id === pub.id).shareUrl).toBeNull()
  })
})
