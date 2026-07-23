import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import express from 'express'
import request from 'supertest'
import { setupTestDb } from './db-harness'
import { db } from '../../server/db/client'
import { users, refreshTokens, letters, letterChannels } from '../../server/db/schema'
import { issueAccessToken } from '../../server/services/auth-service'
import { FeatureFlagsRepository } from '../../server/repositories/feature-flags-repository'
import lettersRouter from '../../server/routes/letters'

const app = express()
app.use(express.json())
app.use('/api/letters', lettersRouter)
const flags = new FeatureFlagsRepository()
let token: string
let letterId: number
let letterSlug: string

function configureR2() {
  vi.stubEnv('R2_ACCOUNT_ID', 'a')
  vi.stubEnv('R2_ACCESS_KEY_ID', 'b')
  vi.stubEnv('R2_SECRET_ACCESS_KEY', 'c')
  vi.stubEnv('R2_BUCKET', 'd')
  vi.stubEnv('R2_PUBLIC_BASE_URL', 'https://cdn.example')
}

describe('member letters endpoints expose shareUrl', () => {
  beforeAll(async () => { await setupTestDb() })

  beforeEach(async () => {
    await db.delete(refreshTokens); await db.delete(users)
    const [u] = await db.insert(users).values({ label: 'm@x.com', email: 'm@x.com', role: 'member', createdAt: new Date() }).returning({ id: users.id })
    token = issueAccessToken({ id: u.id, email: 'm@x.com', name: 'M', role: 'member' })
    await flags.setFlag('lettersEnabled', true, '')

    await db.delete(letterChannels); await db.delete(letters)
    const [l] = await db.insert(letters).values({
      title: 'Shareable', status: 'published', priority: 'normal', publishedAt: new Date(),
    }).returning()
    letterId = l.id
    letterSlug = l.shareSlug
  })

  afterEach(() => { vi.unstubAllEnvs() })

  it('list + detail return the share URL when R2 is configured and publicSharePages is on', async () => {
    configureR2()
    await flags.setFlag('publicSharePages', true, '')

    const list = await request(app).get('/api/letters').set('Authorization', `Bearer ${token}`)
    expect(list.status).toBe(200)
    expect(list.body.letters.find((l: { id: number }) => l.id === letterId).shareUrl)
      .toBe(`https://cdn.example/letter/${letterSlug}.html`)

    const detail = await request(app).get(`/api/letters/${letterId}`).set('Authorization', `Bearer ${token}`)
    expect(detail.status).toBe(200)
    expect(detail.body.letter.shareUrl).toBe(`https://cdn.example/letter/${letterSlug}.html`)
  })

  it('returns null when the publicSharePages flag is off (no R2 object is ever written)', async () => {
    configureR2()
    await flags.setFlag('publicSharePages', false, '')

    const list = await request(app).get('/api/letters').set('Authorization', `Bearer ${token}`)
    expect(list.body.letters.find((l: { id: number }) => l.id === letterId).shareUrl).toBeNull()

    const detail = await request(app).get(`/api/letters/${letterId}`).set('Authorization', `Bearer ${token}`)
    expect(detail.body.letter.shareUrl).toBeNull()
  })

  it('returns null when R2 is not configured, even with the flag on', async () => {
    vi.stubEnv('R2_ACCOUNT_ID', ''); vi.stubEnv('R2_PUBLIC_BASE_URL', '')
    await flags.setFlag('publicSharePages', true, '')

    const list = await request(app).get('/api/letters').set('Authorization', `Bearer ${token}`)
    expect(list.body.letters.find((l: { id: number }) => l.id === letterId).shareUrl).toBeNull()

    const detail = await request(app).get(`/api/letters/${letterId}`).set('Authorization', `Bearer ${token}`)
    expect(detail.body.letter.shareUrl).toBeNull()
  })
})
