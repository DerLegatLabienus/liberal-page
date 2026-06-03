import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import { requireAuth, requireAdmin, optionalAuth } from '../../server/middleware/auth'
import { issueAccessToken } from '../../server/services/auth-service'

const app = express()
app.get('/auth', requireAuth, (req, res) => res.json({ user: req.user }))
app.get('/admin', requireAdmin, (req, res) => res.json({ user: req.user }))
app.get('/maybe', optionalAuth, (req, res) => res.json({ user: req.user ?? null }))

const memberToken = issueAccessToken({ id: 5, email: 'm@x.com', name: 'M', role: 'member' })
const adminToken = issueAccessToken({ id: 1, email: 'a@x.com', name: 'A', role: 'admin' })

describe('auth middleware', () => {
  it('requireAuth: 401 without a token, 200 with a valid one', async () => {
    expect((await request(app).get('/auth')).status).toBe(401)
    const ok = await request(app).get('/auth').set('Authorization', `Bearer ${memberToken}`)
    expect(ok.status).toBe(200)
    expect(ok.body.user).toEqual({ id: 5, role: 'member' })
  })

  it('requireAuth: 401 on a garbage token', async () => {
    expect((await request(app).get('/auth').set('Authorization', 'Bearer nope')).status).toBe(401)
  })

  it('requireAdmin: member → 403, admin → 200', async () => {
    expect((await request(app).get('/admin').set('Authorization', `Bearer ${memberToken}`)).status).toBe(403)
    expect((await request(app).get('/admin').set('Authorization', `Bearer ${adminToken}`)).status).toBe(200)
  })

  it('optionalAuth: passes through anonymously and with a user', async () => {
    const anon = await request(app).get('/maybe')
    expect(anon.status).toBe(200); expect(anon.body.user).toBeNull()
    const authed = await request(app).get('/maybe').set('Authorization', `Bearer ${adminToken}`)
    expect(authed.body.user).toEqual({ id: 1, role: 'admin' })
  })
})
