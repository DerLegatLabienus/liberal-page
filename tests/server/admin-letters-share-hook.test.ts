import { vi, describe, it, expect, beforeAll, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import { setupTestDb } from './db-harness'
import { db } from '../../server/db/client'
import { users, refreshTokens, letters } from '../../server/db/schema'
import { issueAccessToken } from '../../server/services/auth-service'

const sync = vi.fn().mockResolvedValue(undefined)
const remove = vi.fn().mockResolvedValue(undefined)
vi.mock('../../server/services/share-publisher', () => ({
  syncShareForLetter: (...a: unknown[]) => sync(...a),
  removeShareForLetter: (...a: unknown[]) => remove(...a),
}))

import adminLettersRouter from '../../server/routes/admin-letters'

const app = express()
app.use(express.json())
app.use('/api/admin/letters', adminLettersRouter)
let token: string

async function flush() { await new Promise((r) => setImmediate(r)) }

describe('admin-letters share hooks', () => {
  beforeAll(async () => { await setupTestDb() })
  beforeEach(async () => {
    sync.mockClear(); remove.mockClear()
    await db.delete(refreshTokens); await db.delete(users); await db.delete(letters)
    const [u] = await db.insert(users).values({ label: 'a@x.com', email: 'a@x.com', role: 'admin', createdAt: new Date() }).returning({ id: users.id })
    token = issueAccessToken({ id: u.id, email: 'a@x.com', name: 'A', role: 'admin' })
  })

  // Publishing now requires at least one channel with a recipient (publish guard) — carry a
  // minimal email channel alongside the legacy top-level fields these tests otherwise exercise.
  const body = {
    title: 't', subject: 's', bodyHtml: '<p>x</p>', toAddresses: [{ email: 'mk@k.il', display_name: 'ח"כ' }], status: 'published',
    channels: [{ kind: 'email', recipientIds: [1], bodyText: 'x', subject: 's', bodyHtml: '<p>x</p>' }],
  }

  it('syncs share on create', async () => {
    const res = await request(app).post('/api/admin/letters').set('Authorization', `Bearer ${token}`).send(body)
    expect(res.status).toBe(201)
    await flush()
    expect(sync).toHaveBeenCalledWith(res.body.letter.id)
  })

  it('syncs share on update', async () => {
    const created = await request(app).post('/api/admin/letters').set('Authorization', `Bearer ${token}`).send(body)
    sync.mockClear()
    await request(app).put(`/api/admin/letters/${created.body.letter.id}`).set('Authorization', `Bearer ${token}`).send({ title: 'new' })
    await flush()
    expect(sync).toHaveBeenCalledWith(created.body.letter.id)
  })

  it('removes share on delete', async () => {
    const created = await request(app).post('/api/admin/letters').set('Authorization', `Bearer ${token}`).send(body)
    await request(app).delete(`/api/admin/letters/${created.body.letter.id}`).set('Authorization', `Bearer ${token}`)
    await flush()
    expect(remove).toHaveBeenCalledWith(created.body.letter.id)
  })

  it('regenerate-shares syncs every published letter (and skips drafts)', async () => {
    const p1 = await request(app).post('/api/admin/letters').set('Authorization', `Bearer ${token}`).send(body)
    const p2 = await request(app).post('/api/admin/letters').set('Authorization', `Bearer ${token}`).send({ ...body, title: 't2' })
    await request(app).post('/api/admin/letters').set('Authorization', `Bearer ${token}`).send({ ...body, title: 'd', status: 'draft' })
    await flush()        // drain the create-time setImmediate syncs...
    sync.mockClear()     // ...so we count only the regenerate calls
    const res = await request(app).post('/api/admin/letters/regenerate-shares').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.regenerated).toBe(2)
    expect(sync).toHaveBeenCalledTimes(2)
    const ids = sync.mock.calls.map((c) => c[0] as number).sort((a, b) => a - b)
    expect(ids).toEqual([p1.body.letter.id, p2.body.letter.id].sort((a, b) => a - b))
  })
})
