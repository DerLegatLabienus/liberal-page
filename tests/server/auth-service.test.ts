import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { setupTestDb } from './db-harness'
import { db } from '../../server/db/client'
import { users, allowedEmails, refreshTokens } from '../../server/db/schema'
import { AuthRepository } from '../../server/repositories/auth-repository'
import {
  issueAccessToken, verifyAccessToken, issueRefreshToken, rotateRefreshToken, revokeRefreshToken,
} from '../../server/services/auth-service'

const repo = new AuthRepository()

async function makeUser(role = 'member') {
  return repo.upsertUserFromGoogle({ email: `u${Math.random()}@x.com`, googleSub: `g${Math.random()}`, name: 'U', role })
}

describe('auth-service', () => {
  beforeAll(async () => { await setupTestDb() })
  beforeEach(async () => { await db.delete(refreshTokens); await db.delete(allowedEmails); await db.delete(users) })

  it('issues and verifies an access token round-trip', () => {
    const token = issueAccessToken({ id: 7, email: 'a@x.com', name: 'A', role: 'admin', emailAlerts: false })
    expect(verifyAccessToken(token)).toEqual({ userId: 7, role: 'admin' })
  })

  it('rejects a tampered/garbage access token', () => {
    expect(verifyAccessToken('not.a.jwt')).toBeNull()
    const token = issueAccessToken({ id: 1, email: null, name: null, role: 'member', emailAlerts: false })
    expect(verifyAccessToken(token + 'x')).toBeNull()
  })

  it('stores only a hash of the refresh token (raw not persisted)', async () => {
    const u = await makeUser()
    const raw = await issueRefreshToken(u.id)
    const rows = await db.select().from(refreshTokens)
    expect(rows).toHaveLength(1)
    expect(rows[0].tokenHash).not.toBe(raw)
    expect(raw.startsWith(`${u.id}.`)).toBe(true) // self-identifying prefix
  })

  it('rotation deletes the old token and issues a new pair', async () => {
    const u = await makeUser()
    const raw = await issueRefreshToken(u.id)
    const res = await rotateRefreshToken(raw)
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.user.id).toBe(u.id)
      expect(verifyAccessToken(res.accessToken)).toMatchObject({ userId: u.id })
      expect(res.refreshToken).not.toBe(raw)
    }
    // old token no longer valid (rotated away)
    const reuse = await rotateRefreshToken(raw)
    expect(reuse.ok).toBe(false)
  })

  it('reuse of a rotated token revokes ALL of that user\'s sessions', async () => {
    const u = await makeUser()
    const raw = await issueRefreshToken(u.id)
    await issueRefreshToken(u.id) // a second active session
    await rotateRefreshToken(raw)  // raw now rotated away; one fresh + one other session remain
    const before = await db.select().from(refreshTokens)
    expect(before.length).toBeGreaterThanOrEqual(2)

    const res = await rotateRefreshToken(raw) // reuse of the dead token
    expect(res).toEqual({ ok: false, reason: 'reuse' })
    expect(await db.select().from(refreshTokens)).toHaveLength(0) // all sessions nuked
  })

  it('an expired refresh token is invalid and deleted', async () => {
    const u = await makeUser()
    // craft an expired token row directly with the same hashing the service uses is internal;
    // instead issue then expire by inserting a past-dated row via the repo with a known raw.
    const raw = `${u.id}.deadbeef`
    const { createHash } = await import('crypto')
    const hash = createHash('sha256').update(raw).digest('hex')
    await repo.createRefreshToken(u.id, hash, new Date(Date.now() - 1000))
    const res = await rotateRefreshToken(raw)
    expect(res).toEqual({ ok: false, reason: 'invalid' })
    expect(await repo.findRefreshToken(hash)).toBeNull()
  })

  it('revoke deletes the token', async () => {
    const u = await makeUser()
    const raw = await issueRefreshToken(u.id)
    await revokeRefreshToken(raw)
    expect(await db.select().from(refreshTokens)).toHaveLength(0)
  })
})
