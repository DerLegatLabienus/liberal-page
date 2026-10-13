import { vi, describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
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

import adminLettersRouter, { _resetBeautifyLimiter } from '../../../server/routes/admin-letters'
import { beautifyLetterHtml } from '../../../server/services/letter-beautifier'

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
    _resetBeautifyLimiter()
    vi.mocked(beautifyLetterHtml).mockClear()
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

  describe('rate limit', () => {
    const LIMIT = 1
    const WINDOW_MS = 120_000

    // The limiter reads Date.now(). Only Date is faked: faking the timers too would hang
    // supertest and pglite.
    afterEach(() => { vi.useRealTimers() })

    it('lets the same caller through again only after two minutes', async () => {
      await flags.setFlag('lettersBeautifyEnabled', true, '')
      const start = new Date('2026-01-01T00:00:00Z').getTime()
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(start)
      expect((await beautify(adminToken)).status).toBe(200)
      expect((await beautify(adminToken)).status).toBe(429)
      vi.setSystemTime(start + WINDOW_MS - 1_000)
      expect((await beautify(adminToken)).status).toBe(429)
      vi.setSystemTime(start + WINDOW_MS + 1_000)
      expect((await beautify(adminToken)).status).toBe(200)
    })

    it('allows requests under the limit, then answers 429 rate_limited', async () => {
      await flags.setFlag('lettersBeautifyEnabled', true, '')
      for (let i = 0; i < LIMIT; i++) {
        expect((await beautify(adminToken)).status).toBe(200)
      }
      const res = await beautify(adminToken)
      expect(res.status).toBe(429)
      expect(res.body.error).toBe('rate_limited')
    })

    it('checks the limiter before calling the LLM', async () => {
      await flags.setFlag('lettersBeautifyEnabled', true, '')
      for (let i = 0; i < LIMIT; i++) await beautify(adminToken)
      expect(beautifyLetterHtml).toHaveBeenCalledTimes(LIMIT)
      expect((await beautify(adminToken)).status).toBe(429)
      expect(beautifyLetterHtml).toHaveBeenCalledTimes(LIMIT)
    })

    it('an empty body does not use up the slot', async () => {
      await flags.setFlag('lettersBeautifyEnabled', true, '')
      expect((await beautify(adminToken, { html: '' })).status).toBe(400)
      expect((await beautify(adminToken)).status).toBe(200)
    })

    it('gives the slot back when the AI service is not configured', async () => {
      await flags.setFlag('lettersBeautifyEnabled', true, '')
      vi.mocked(beautifyLetterHtml).mockRejectedValueOnce(new Error('beautify_unavailable'))
      expect((await beautify(adminToken)).status).toBe(503)
      expect((await beautify(adminToken)).status).toBe(200)
    })

    it('a call that reached the LLM and failed still uses up the slot', async () => {
      await flags.setFlag('lettersBeautifyEnabled', true, '')
      vi.mocked(beautifyLetterHtml).mockRejectedValueOnce(new Error('upstream exploded'))
      expect((await beautify(adminToken)).status).toBe(500)
      expect((await beautify(adminToken)).status).toBe(429)
      expect(beautifyLetterHtml).toHaveBeenCalledTimes(1)
    })

    it('limits each caller separately', async () => {
      await flags.setFlag('lettersBeautifyEnabled', true, '')
      for (let i = 0; i < LIMIT; i++) await beautify(adminToken)
      expect((await beautify(adminToken)).status).toBe(429)
      const otherId = await mkUser('admin2@x.com', 'admin')
      const otherToken = issueAccessToken({ id: otherId, email: 'admin2@x.com', name: 'B', role: 'admin' })
      expect((await beautify(otherToken)).status).toBe(200)
    })
  })
})
