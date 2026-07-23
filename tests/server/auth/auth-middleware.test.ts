import { describe, it, expect, beforeAll } from 'vitest'
import express from 'express'
import request from 'supertest'
import { setupTestDb } from '../db-harness'
import { db } from '../../../server/db/client'
import { users } from '../../../server/db/schema'
import { requireAuth, requireAdmin, optionalAuth } from '../../../server/middleware/auth'
import { issueAccessToken } from '../../../server/services/auth-service'

const app = express()
app.get('/auth', requireAuth, (req, res) => res.json({ user: req.user }))
app.get('/admin', requireAdmin, (req, res) => res.json({ user: req.user }))
app.get('/maybe', optionalAuth, (req, res) => res.json({ user: req.user ?? null }))

// requireAdmin re-reads the role from the DB, so admin/member must exist as real rows.
let memberToken: string
let adminToken: string

beforeAll(async () => {
  await setupTestDb()
  const [m] = await db.insert(users).values({ label: 'm', email: 'm@x.com', role: 'member', createdAt: new Date() }).returning({ id: users.id })
  const [a] = await db.insert(users).values({ label: 'a', email: 'a@x.com', role: 'admin', createdAt: new Date() }).returning({ id: users.id })
  memberToken = issueAccessToken({ id: m.id, email: 'm@x.com', name: 'M', role: 'member', emailAlerts: false })
  adminToken = issueAccessToken({ id: a.id, email: 'a@x.com', name: 'A', role: 'admin', emailAlerts: false })
})

describe('auth middleware', () => {
  it('requireAuth: 401 without a token, 200 with a valid one', async () => {
    expect((await request(app).get('/auth')).status).toBe(401)
    const ok = await request(app).get('/auth').set('Authorization', `Bearer ${memberToken}`)
    expect(ok.status).toBe(200)
    expect(ok.body.user.role).toBe('member')
  })

  it('requireAuth: 401 on a garbage token', async () => {
    expect((await request(app).get('/auth').set('Authorization', 'Bearer nope')).status).toBe(401)
  })

  it('requireAdmin: member → 403, admin → 200 (role re-checked against the DB)', async () => {
    expect((await request(app).get('/admin').set('Authorization', `Bearer ${memberToken}`)).status).toBe(403)
    expect((await request(app).get('/admin').set('Authorization', `Bearer ${adminToken}`)).status).toBe(200)
  })

  it('optionalAuth: passes through anonymously and with a user', async () => {
    const anon = await request(app).get('/maybe')
    expect(anon.status).toBe(200); expect(anon.body.user).toBeNull()
    const authed = await request(app).get('/maybe').set('Authorization', `Bearer ${adminToken}`)
    expect(authed.body.user.role).toBe('admin')
  })
})
