import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import request from 'supertest'
import { createTestApp } from '../../support/test-app'
import { setupTestDb } from '../db-harness'
import { db } from '../../../server/db/client'
import { joinAnalytics } from '../../../server/db/schema'
import { eq } from 'drizzle-orm'
import analyticsRouter from '../../../server/routes/analytics'

const app = createTestApp('/api/analytics', analyticsRouter)

describe('POST /api/analytics/join', () => {
  beforeAll(async () => { await setupTestDb() })
  beforeEach(async () => { await db.delete(joinAnalytics) })

  it('records a valid click-through and returns 200', async () => {
    const res = await request(app).post('/api/analytics/join').send({ status: 'new', mode: 'individual' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })

    const life = await db.select().from(joinAnalytics).where(eq(joinAnalytics.bucket, 'lifetime'))
    expect(life[0].total).toBe(1)
    expect(life[0].breakdown).toEqual({ 'new:individual': 1 })
  })

  it('rejects an invalid combo with 400 and writes nothing', async () => {
    const res = await request(app).post('/api/analytics/join').send({ status: 'hacker', mode: 'individual' })
    expect(res.status).toBe(400)
    const all = await db.select().from(joinAnalytics)
    expect(all).toHaveLength(0)
  })

  it('rejects a missing body with 400', async () => {
    const res = await request(app).post('/api/analytics/join').send({})
    expect(res.status).toBe(400)
  })
})
