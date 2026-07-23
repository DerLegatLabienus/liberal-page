import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import { setupTestDb } from '../db-harness'
import { db } from '../../../server/db/client'
import { eq } from 'drizzle-orm'
import { users, allowedEmails, refreshTokens, joinAnalytics } from '../../../server/db/schema'
import { issueAccessToken } from '../../../server/services/auth-service'
import adminRouter from '../../../server/routes/admin'

const app = express()
app.use(express.json())
app.use('/api/admin', adminRouter)

let adminToken: string
let memberToken: string
let adminId: number

async function mkUser(email: string, role: string) {
  const [u] = await db.insert(users).values({ label: email, email, role, createdAt: new Date() }).returning({ id: users.id })
  return u.id
}

describe('admin routes', () => {
  beforeAll(async () => { await setupTestDb() })
  beforeEach(async () => {
    await db.delete(refreshTokens); await db.delete(allowedEmails); await db.delete(users)
    adminId = await mkUser('admin@x.com', 'admin')
    const memberId = await mkUser('member@x.com', 'member')
    adminToken = issueAccessToken({ id: adminId, email: 'admin@x.com', name: 'A', role: 'admin' })
    memberToken = issueAccessToken({ id: memberId, email: 'member@x.com', name: 'M', role: 'member' })
  })

  const asAdmin = (m: 'get'|'post'|'delete'|'patch', path: string) =>
    request(app)[m](path).set('Authorization', `Bearer ${adminToken}`)
  const asMember = (m: 'get'|'post'|'patch', path: string) =>
    request(app)[m](path).set('Authorization', `Bearer ${memberToken}`)

  it('requires admin: member is 403, anonymous is 401', async () => {
    expect((await request(app).get('/api/admin/invites')).status).toBe(401)
    expect((await asMember('get', '/api/admin/invites')).status).toBe(403)
    expect((await asAdmin('get', '/api/admin/invites')).status).toBe(200)
  })

  it('revokes admin immediately when the DB role is downgraded (token still valid)', async () => {
    expect((await asAdmin('get', '/api/admin/invites')).status).toBe(200)
    // Demote in the DB without touching the still-valid admin JWT.
    await db.update(users).set({ role: 'member' }).where(eq(users.id, adminId))
    expect((await asAdmin('get', '/api/admin/invites')).status).toBe(403)
  })

  it('invites: add, list, remove', async () => {
    await asAdmin('post', '/api/admin/invites').send({ email: 'New@X.com', role: 'member' })
    let res = await asAdmin('get', '/api/admin/invites')
    expect(res.body.invites).toHaveLength(1)
    expect(res.body.invites[0].email).toBe('new@x.com') // normalized
    await asAdmin('delete', '/api/admin/invites/new%40x.com')
    res = await asAdmin('get', '/api/admin/invites')
    expect(res.body.invites).toHaveLength(0)
  })

  it('lists real users (excludes the group account)', async () => {
    await mkUser('grp', 'group')
    const res = await asAdmin('get', '/api/admin/users')
    const roles = res.body.users.map((u: { role: string }) => u.role).sort()
    expect(roles).toEqual(['admin', 'member'])
  })

  it('promotes a member to admin', async () => {
    const all = await db.select().from(users)
    const memberId = all.find((u) => u.role === 'member')!.id
    const res = await asAdmin('patch', `/api/admin/users/${memberId}/role`).send({ role: 'admin' })
    expect(res.status).toBe(200)
    expect((await db.select().from(users)).filter((u) => u.role === 'admin')).toHaveLength(2)
  })

  it('blocks demoting the last admin (409)', async () => {
    const res = await asAdmin('patch', `/api/admin/users/${adminId}/role`).send({ role: 'member' })
    expect(res.status).toBe(409)
  })

  it('allows demoting an admin when another admin remains', async () => {
    const other = await mkUser('admin2@x.com', 'admin')
    const res = await asAdmin('patch', `/api/admin/users/${other}/role`).send({ role: 'member' })
    expect(res.status).toBe(200)
  })

  describe('GET /analytics/join', () => {
    beforeEach(async () => { await db.delete(joinAnalytics) })

    it('returns 401 for anonymous, 403 for member', async () => {
      expect((await request(app).get('/api/admin/analytics/join')).status).toBe(401)
      expect((await asMember('get', '/api/admin/analytics/join')).status).toBe(403)
    })

    it('returns empty state when no data exists', async () => {
      const res = await asAdmin('get', '/api/admin/analytics/join')
      expect(res.status).toBe(200)
      expect(res.body.lifetime).toBeNull()
      expect(res.body.daily).toEqual([])
    })

    it('returns lifetime and daily rows newest-first', async () => {
      const now = new Date()
      await db.insert(joinAnalytics).values([
        { bucket: 'lifetime', total: 5, breakdown: { 'new:individual': 3, 'renewal:couple': 2 }, createdAt: now },
        { bucket: '2026-06-10', total: 2, breakdown: { 'new:individual': 2 }, createdAt: now },
        { bucket: '2026-06-12', total: 3, breakdown: { 'new:individual': 1, 'renewal:couple': 2 }, createdAt: now },
      ])
      const res = await asAdmin('get', '/api/admin/analytics/join')
      expect(res.status).toBe(200)
      expect(res.body.lifetime.total).toBe(5)
      expect(res.body.lifetime.breakdown['new:individual']).toBe(3)
      expect(res.body.daily).toHaveLength(2)
      expect(res.body.daily[0].bucket).toBe('2026-06-12') // newest first
      expect(res.body.daily[1].bucket).toBe('2026-06-10')
    })
  })
})
