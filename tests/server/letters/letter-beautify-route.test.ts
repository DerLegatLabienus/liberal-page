import { vi, describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { createTestApp } from '../../support/test-app'
import request from 'supertest'
import { setupTestDb } from '../db-harness'
import { db } from '../../../server/db/client'
import { users, refreshTokens } from '../../../server/db/schema'
import { issueAccessToken } from '../../../server/services/auth-service'
import { FeatureFlagsRepository } from '../../../server/repositories/feature-flags-repository'

// Mock the AI service so the route test never calls Anthropic.
vi.mock('../../../server/services/letter-beautifier', () => ({
  beautifyLetterHtml: vi.fn().mockResolvedValue('<p dir="rtl">נקי</p>'),
}))

import adminLettersRouter from '../../../server/routes/admin-letters'

const app = createTestApp('/api/admin/letters', adminLettersRouter)

const flags = new FeatureFlagsRepository()
let adminToken: string
let memberToken: string

async function mkUser(email: string, role: string) {
  const [u] = await db.insert(users).values({ label: email, email, role, createdAt: new Date() }).returning({ id: users.id })
  return u.id
}

describe('POST /api/admin/letters/beautify', () => {
  beforeAll(async () => { await setupTestDb() })
  beforeEach(async () => {
    await db.delete(refreshTokens); await db.delete(users)
    const adminId = await mkUser('admin@x.com', 'admin')
    const memberId = await mkUser('member@x.com', 'member')
    adminToken = issueAccessToken({ id: adminId, email: 'admin@x.com', name: 'A', role: 'admin' })
    memberToken = issueAccessToken({ id: memberId, email: 'member@x.com', name: 'M', role: 'member' })
    await flags.setFlag('lettersBeautifyEnabled', false, '')
  })

  const beautify = (token?: string, body: unknown = { html: '<p>x</p>' }) => {
    const r = request(app).post('/api/admin/letters/beautify')
    return (token ? r.set('Authorization', `Bearer ${token}`) : r).send(body)
  }

  it('401 for anonymous', async () => {
    expect((await beautify()).status).toBe(401)
  })

  it('403 for a non-admin member', async () => {
    expect((await beautify(memberToken)).status).toBe(403)
  })

  it('404 for admin when the flag is off', async () => {
    expect((await beautify(adminToken)).status).toBe(404)
  })

  it('200 with beautified html for admin when the flag is on', async () => {
    await flags.setFlag('lettersBeautifyEnabled', true, '')
    const res = await beautify(adminToken)
    expect(res.status).toBe(200)
    expect(res.body.html).toContain('dir="rtl"')
  })

  it('400 for empty body when enabled', async () => {
    await flags.setFlag('lettersBeautifyEnabled', true, '')
    expect((await beautify(adminToken, { html: '' })).status).toBe(400)
  })
})
