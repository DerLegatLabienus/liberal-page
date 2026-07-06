import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { setupTestDb } from './db-harness'
import { db } from '../../server/db/client'
import { users, allowedEmails, refreshTokens, userIdentities } from '../../server/db/schema'
import { AuthRepository } from '../../server/repositories/auth-repository'
import { loginWithIdentity, AuthError } from '../../server/services/auth-service'

const repo = new AuthRepository()

describe('loginWithIdentity', () => {
  beforeAll(async () => { await setupTestDb() })
  beforeEach(async () => {
    await db.delete(refreshTokens)
    await db.delete(userIdentities)
    await db.delete(allowedEmails)
    await db.delete(users)
  })

  it('an invited email signs in, gets tokens, and creates a user_identities row', async () => {
    await db.insert(allowedEmails).values({ email: 'a@x.com', role: 'admin', createdAt: new Date() })

    const result = await loginWithIdentity({ provider: 'google', sub: 's1', email: 'a@x.com', name: 'A' })

    expect(result.accessToken).toBeTruthy()
    expect(result.refreshToken).toBeTruthy()
    expect(result.user).toMatchObject({ email: 'a@x.com', role: 'admin' })

    const rows = await db.select().from(userIdentities).where(eq(userIdentities.userId, result.user.id))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ provider: 'google', providerSub: 's1', userId: result.user.id })
  })

  it('a not-invited, non-existing email is rejected with not_invited', async () => {
    await expect(
      loginWithIdentity({ provider: 'google', sub: 's2', email: 'stranger@x.com', name: 'S' }),
    ).rejects.toMatchObject({ code: 'not_invited' })
    await expect(
      loginWithIdentity({ provider: 'google', sub: 's2', email: 'stranger@x.com', name: 'S' }),
    ).rejects.toBeInstanceOf(AuthError)
    expect(await db.select().from(users)).toHaveLength(0)
  })

  it('an existing-but-not-allowlisted user is grandfathered in and succeeds', async () => {
    const existing = await repo.upsertUserFromGoogle({ email: 'b@x.com', googleSub: 'g-existing', name: 'B', role: 'member' })

    const result = await loginWithIdentity({ provider: 'google', sub: 'g-existing', email: 'b@x.com', name: 'B2' })

    expect(result.user.id).toBe(existing.id)
    expect(result.user.role).toBe('member')
    expect(result.accessToken).toBeTruthy()
    expect(result.refreshToken).toBeTruthy()
  })
})
