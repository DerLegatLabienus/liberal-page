import { createHash } from 'crypto'
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { createTestApp } from '../../support/test-app'
import request from 'supertest'
import { eq } from 'drizzle-orm'
import { setupTestDb } from '../db-harness'
import { db } from '../../../server/db/client'
import { users, allowedEmails, refreshTokens, magicLinkTokens, emailTemplates } from '../../../server/db/schema'

const { sendEmailMock } = vi.hoisted(() => ({ sendEmailMock: vi.fn() }))
vi.mock('../../../server/services/email', () => ({ sendEmail: sendEmailMock }))

import authRouter, { _resetMagicLinkLimiter } from '../../../server/routes/auth'
import { verifyMagicLink } from '../../../server/services/auth-providers/magic-link'

const app = createTestApp('/api/auth', authRouter)

function extractToken(): string {
  const call = sendEmailMock.mock.calls.at(-1)?.[0] as { params: { link: string } }
  const match = call.params.link.match(/token=([a-f0-9]+)/)
  if (!match) throw new Error('no token in link')
  return match[1]
}

describe('auth: email magic-link', () => {
  beforeAll(async () => { await setupTestDb() })
  beforeEach(async () => {
    await db.delete(magicLinkTokens); await db.delete(refreshTokens)
    await db.delete(allowedEmails); await db.delete(users)
    vi.clearAllMocks()
    sendEmailMock.mockResolvedValue({ status: 'sent', id: 're_1' })
    _resetMagicLinkLimiter()
  })

  describe('POST /magic-link/request', () => {
    it('stores a hashed (not raw) token and emails the link for an allowlisted email', async () => {
      await db.insert(allowedEmails).values({ email: 'a@x.com', role: 'member', createdAt: new Date() })

      const res = await request(app).post('/api/auth/magic-link/request').send({ email: 'A@X.com' })
      expect(res.status).toBe(200)
      expect(res.body).toEqual({ ok: true })

      // The response returns before the DB/email work runs (off the response path, see
      // magic-link/request handler), so wait for it to land instead of asserting immediately.
      await vi.waitFor(() => expect(sendEmailMock).toHaveBeenCalledTimes(1))
      const [args] = sendEmailMock.mock.calls[0] as [{ to: string; template: string; params: { link: string } }]
      expect(args.to).toBe('a@x.com')
      expect(args.template).toBe('magic_link')

      const token = extractToken()
      const rows = await vi.waitFor(async () => {
        const r = await db.select().from(magicLinkTokens)
        expect(r).toHaveLength(1)
        return r
      })
      expect(rows[0].email).toBe('a@x.com')
      expect(rows[0].tokenHash).toBe(createHash('sha256').update(token).digest('hex'))
      // The raw token must never be persisted — only its hash.
      expect(rows[0].tokenHash).not.toBe(token)
      expect(JSON.stringify(rows[0])).not.toContain(token)
    })

    it('is neutral for an unknown email: 200, nothing stored, nothing emailed', async () => {
      const res = await request(app).post('/api/auth/magic-link/request').send({ email: 'stranger@x.com' })
      expect(res.status).toBe(200)
      expect(res.body).toEqual({ ok: true })
      expect(sendEmailMock).not.toHaveBeenCalled()
      expect(await db.select().from(magicLinkTokens)).toHaveLength(0)
    })

    it('is neutral for a grandfathered existing user with no current allowlist entry', async () => {
      // Existing user but removed from allowlist should still get a link (grandfathered login).
      await db.insert(users).values({
        label: 'ghost@x.com', email: 'ghost@x.com', name: null, role: 'member', createdAt: new Date(),
      })
      const res = await request(app).post('/api/auth/magic-link/request').send({ email: 'ghost@x.com' })
      expect(res.status).toBe(200)
      await vi.waitFor(() => expect(sendEmailMock).toHaveBeenCalledTimes(1))
      await vi.waitFor(async () => expect(await db.select().from(magicLinkTokens)).toHaveLength(1))
    })

    it('400s when email is missing', async () => {
      const res = await request(app).post('/api/auth/magic-link/request').send({})
      expect(res.status).toBe(400)
    })

    it('rate-limits repeated requests for the same (ip, email)', async () => {
      await db.insert(allowedEmails).values({ email: 'a@x.com', role: 'member', createdAt: new Date() })
      for (let i = 0; i < 5; i++) {
        const r = await request(app).post('/api/auth/magic-link/request').send({ email: 'a@x.com' })
        expect(r.status).toBe(200)
      }
      const sixth = await request(app).post('/api/auth/magic-link/request').send({ email: 'a@x.com' })
      expect(sixth.status).toBe(429)
    })
  })

  describe('POST /magic-link/verify', () => {
    it('logs in via loginWithIdentity for a verified allowlisted email', async () => {
      await db.insert(allowedEmails).values({ email: 'a@x.com', role: 'admin', createdAt: new Date() })
      await request(app).post('/api/auth/magic-link/request').send({ email: 'a@x.com' })
      await vi.waitFor(() => expect(sendEmailMock).toHaveBeenCalledTimes(1))
      const token = extractToken()

      const res = await request(app).post('/api/auth/magic-link/verify').send({ token })
      expect(res.status).toBe(200)
      expect(res.body.accessToken).toBeTruthy()
      expect(res.body.refreshToken).toBeTruthy()
      expect(res.body.user).toMatchObject({ email: 'a@x.com', role: 'admin' })
    })

    it('is single-use: a second verify with the same token fails', async () => {
      await db.insert(allowedEmails).values({ email: 'a@x.com', role: 'member', createdAt: new Date() })
      await request(app).post('/api/auth/magic-link/request').send({ email: 'a@x.com' })
      await vi.waitFor(() => expect(sendEmailMock).toHaveBeenCalledTimes(1))
      const token = extractToken()

      const first = await request(app).post('/api/auth/magic-link/verify').send({ token })
      expect(first.status).toBe(200)

      const second = await request(app).post('/api/auth/magic-link/verify').send({ token })
      expect(second.status).toBe(401)
    })

    it('is single-use under concurrency: two simultaneous verifies race for one winner', async () => {
      await db.insert(allowedEmails).values({ email: 'a@x.com', role: 'member', createdAt: new Date() })
      await request(app).post('/api/auth/magic-link/request').send({ email: 'a@x.com' })
      await vi.waitFor(() => expect(sendEmailMock).toHaveBeenCalledTimes(1))
      const token = extractToken()

      // Fire both verifies concurrently (no await between them) so they race for the same
      // token row. The atomic DELETE ... RETURNING in verifyMagicLink means the DB itself
      // arbitrates: exactly one caller can get the row back, the other gets zero rows.
      const results = await Promise.allSettled([verifyMagicLink(token), verifyMagicLink(token)])

      const fulfilled = results.filter((r) => r.status === 'fulfilled')
      const rejected = results.filter((r) => r.status === 'rejected')
      expect(fulfilled).toHaveLength(1)
      expect(rejected).toHaveLength(1)
      expect((fulfilled[0] as PromiseFulfilledResult<{ email: string }>).value.email).toBe('a@x.com')
      expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ code: 'invalid_token' })
    })

    it('rejects an unknown token', async () => {
      const res = await request(app).post('/api/auth/magic-link/verify').send({ token: 'deadbeef'.repeat(8) })
      expect(res.status).toBe(401)
    })

    it('rejects an expired token', async () => {
      await db.insert(allowedEmails).values({ email: 'a@x.com', role: 'member', createdAt: new Date() })
      const tokenHash = createHash('sha256').update('expired-token').digest('hex')
      await db.insert(magicLinkTokens).values({
        email: 'a@x.com', tokenHash, expiresAt: new Date(Date.now() - 1000), createdAt: new Date(),
      })
      const res = await request(app).post('/api/auth/magic-link/verify').send({ token: 'expired-token' })
      expect(res.status).toBe(401)
      // Expired-and-consumed: gone either way (single-use semantics apply to expired rows too).
      expect(await db.select().from(magicLinkTokens).where(eq(magicLinkTokens.tokenHash, tokenHash))).toHaveLength(0)
    })

    it('400s when token is missing', async () => {
      const res = await request(app).post('/api/auth/magic-link/verify').send({})
      expect(res.status).toBe(400)
    })

    it('preserves an existing name instead of clobbering it with null', async () => {
      await db.insert(allowedEmails).values({ email: 'a@x.com', role: 'member', createdAt: new Date() })
      await db.insert(users).values({
        label: 'a@x.com', email: 'a@x.com', name: 'Alice', role: 'member', createdAt: new Date(),
      })
      await request(app).post('/api/auth/magic-link/request').send({ email: 'a@x.com' })
      await vi.waitFor(() => expect(sendEmailMock).toHaveBeenCalledTimes(1))
      const token = extractToken()

      const res = await request(app).post('/api/auth/magic-link/verify').send({ token })
      expect(res.status).toBe(200)
      expect(res.body.user.name).toBe('Alice')
    })
  })

  describe('magic_link email template', () => {
    it('is seeded and contains the {{link}} placeholder', async () => {
      const [tpl] = await db.select().from(emailTemplates).where(eq(emailTemplates.name, 'magic_link'))
      expect(tpl).toBeTruthy()
      expect(tpl.html).toContain('{{link}}')
    })
  })
})
