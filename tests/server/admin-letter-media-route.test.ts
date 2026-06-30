// tests/server/admin-letter-media-route.test.ts
import { vi, describe, it, expect, beforeAll, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import { setupTestDb } from './db-harness'
import { db } from '../../server/db/client'
import { users, refreshTokens, letterMediaAssets } from '../../server/db/schema'
import { issueAccessToken } from '../../server/services/auth-service'

vi.mock('../../server/services/r2-client', () => ({
  isConfigured: vi.fn(() => true),
  publicUrl: (key: string) => `https://pub-x.r2.dev/${key}`,
  putObject: vi.fn().mockResolvedValue(undefined),
  deleteObject: vi.fn().mockResolvedValue(undefined),
  R2NotConfiguredError: class extends Error {},
}))

import * as r2 from '../../server/services/r2-client'
import adminLetterAssetsRouter from '../../server/routes/admin-letter-assets'

const app = express()
app.use(express.json())
app.use('/api/admin/letters', adminLetterAssetsRouter)

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0])
let adminToken: string
let memberToken: string

async function mkUser(email: string, role: string) {
  const [u] = await db.insert(users).values({ label: email, email, role, createdAt: new Date() }).returning({ id: users.id })
  return u.id
}

describe('admin letter media routes', () => {
  beforeAll(async () => { await setupTestDb() })
  beforeEach(async () => {
    vi.clearAllMocks()
    ;(r2.isConfigured as unknown as ReturnType<typeof vi.fn>).mockReturnValue(true)
    await db.delete(letterMediaAssets); await db.delete(refreshTokens); await db.delete(users)
    const adminId = await mkUser('admin@x.com', 'admin')
    const memberId = await mkUser('member@x.com', 'member')
    adminToken = issueAccessToken({ id: adminId, email: 'admin@x.com', name: 'A', role: 'admin' })
    memberToken = issueAccessToken({ id: memberId, email: 'member@x.com', name: 'M', role: 'member' })
  })

  it('401 anonymous, 403 member', async () => {
    expect((await request(app).get('/api/admin/letters/media')).status).toBe(401)
    expect((await request(app).get('/api/admin/letters/media').set('Authorization', `Bearer ${memberToken}`)).status).toBe(403)
  })

  it('uploads a PNG and returns the asset with a public url', async () => {
    const res = await request(app)
      .post('/api/admin/letters/media')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', png, 'logo.png')
    expect(res.status).toBe(201)
    expect(res.body.asset.url).toMatch(/^https:\/\/pub-x\.r2\.dev\/letters\/.+\.png$/)
    expect(r2.putObject).toHaveBeenCalledTimes(1)
    expect((await request(app).get('/api/admin/letters/media').set('Authorization', `Bearer ${adminToken}`)).body.assets).toHaveLength(1)
  })

  it('400 for a non-image (SVG bytes)', async () => {
    const res = await request(app)
      .post('/api/admin/letters/media')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', Buffer.from('<svg></svg>'), 'x.svg')
    expect(res.status).toBe(400)
    expect(r2.putObject).not.toHaveBeenCalled()
  })

  it('503 when R2 is not configured', async () => {
    ;(r2.isConfigured as unknown as ReturnType<typeof vi.fn>).mockReturnValue(false)
    const res = await request(app).get('/api/admin/letters/media').set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).toBe(503)
  })

  it('deletes an asset (R2 + row)', async () => {
    const up = await request(app).post('/api/admin/letters/media').set('Authorization', `Bearer ${adminToken}`).attach('file', png, 'logo.png')
    const del = await request(app).delete(`/api/admin/letters/media/${up.body.asset.id}`).set('Authorization', `Bearer ${adminToken}`)
    expect(del.status).toBe(200)
    expect(r2.deleteObject).toHaveBeenCalledTimes(1)
  })
})
