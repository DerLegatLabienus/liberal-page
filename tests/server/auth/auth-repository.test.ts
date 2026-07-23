import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { setupTestDb } from './db-harness'
import { db } from '../../server/db/client'
import { users, allowedEmails, refreshTokens } from '../../server/db/schema'
import { AuthRepository } from '../../server/repositories/auth-repository'

const repo = new AuthRepository()

describe('AuthRepository', () => {
  beforeAll(async () => { await setupTestDb() })
  beforeEach(async () => {
    await db.delete(refreshTokens)
    await db.delete(allowedEmails) // migration 0010 seeds the first admin into every test DB
    await db.delete(users)
  })

  it('getAllowedEmail returns the invite or null', async () => {
    await db.insert(allowedEmails).values({ email: 'a@x.com', role: 'admin', createdAt: new Date() })
    expect(await repo.getAllowedEmail('a@x.com')).toEqual({ email: 'a@x.com', role: 'admin' })
    expect(await repo.getAllowedEmail('nope@x.com')).toBeNull()
  })

  it('upsertUserFromGoogle creates with the given role, then preserves role on re-login', async () => {
    const created = await repo.upsertUserFromGoogle({ email: 'a@x.com', googleSub: 'g1', name: 'A', role: 'admin' })
    expect(created.role).toBe('admin')
    expect(created.email).toBe('a@x.com')

    // A subsequent login must not downgrade/alter the role.
    const again = await repo.upsertUserFromGoogle({ email: 'a@x.com', googleSub: 'g1', name: 'A2', role: 'member' })
    expect(again.id).toBe(created.id)
    expect(again.role).toBe('admin')
    expect(again.name).toBe('A2')
    expect(await db.select().from(users)).toHaveLength(1)
  })

  it('refresh tokens: create / find / delete', async () => {
    const u = await repo.upsertUserFromGoogle({ email: 'a@x.com', googleSub: 'g1', name: 'A', role: 'member' })
    const exp = new Date(Date.now() + 60_000)
    await repo.createRefreshToken(u.id, 'hash1', exp)
    expect(await repo.findRefreshToken('hash1')).toMatchObject({ userId: u.id })
    await repo.deleteRefreshToken('hash1')
    expect(await repo.findRefreshToken('hash1')).toBeNull()
  })

  it('deleteUserRefreshTokens removes all sessions for a user', async () => {
    const u = await repo.upsertUserFromGoogle({ email: 'a@x.com', googleSub: 'g1', name: 'A', role: 'member' })
    await repo.createRefreshToken(u.id, 'h1', new Date(Date.now() + 60_000))
    await repo.createRefreshToken(u.id, 'h2', new Date(Date.now() + 60_000))
    await repo.deleteUserRefreshTokens(u.id)
    expect(await repo.findRefreshToken('h1')).toBeNull()
    expect(await repo.findRefreshToken('h2')).toBeNull()
  })

  it('deleteExpired removes only past-dated rows', async () => {
    const u = await repo.upsertUserFromGoogle({ email: 'a@x.com', googleSub: 'g1', name: 'A', role: 'member' })
    await repo.createRefreshToken(u.id, 'old', new Date(Date.now() - 1000))
    await repo.createRefreshToken(u.id, 'fresh', new Date(Date.now() + 60_000))
    const n = await repo.deleteExpired(new Date())
    expect(n).toBe(1)
    expect(await repo.findRefreshToken('old')).toBeNull()
    expect(await repo.findRefreshToken('fresh')).not.toBeNull()
  })
})
