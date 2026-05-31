import { vi, describe, it, expect, beforeAll, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import { setupTestDb } from './db-harness'
import { db } from '../../server/db/client'
import { trackedBills, bills } from '../../server/db/schema'

vi.mock('../../server/services/knesset-config', () => ({
  getCurrentKnesset: vi.fn().mockReturnValue(25),
}))
vi.stubGlobal('fetch', vi.fn())

import billsRouter from '../../server/routes/bills'

const app = express()
app.use(express.json())
app.use('/api/bills', billsRouter)

const ODATA_BILLS = [
  { BillID: 1038990, Name: 'הצעת חוק חופש העיסוק, התשפ"ו-2026', StatusID: 141 },
  { BillID: 1040059, Name: 'הצעת חוק חינוך חופשי, התשפ"ה-2025', StatusID: 141 },
]

function mockOdata(value: unknown[]) {
  return { ok: true, json: async () => ({ value }) } as Response
}

describe('GET /api/bills/search', () => {
  beforeEach(() => {
    vi.mocked(fetch).mockReset()
  })

  it('returns 400 when q is missing', async () => {
    const res = await request(app).get('/api/bills/search')
    expect(res.status).toBe(400)
  })

  it('returns 400 when q is fewer than 3 chars', async () => {
    const res = await request(app).get('/api/bills/search?q=חו')
    expect(res.status).toBe(400)
  })

  it('returns 200 with bill search results for valid query', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockOdata(ODATA_BILLS))
    const res = await request(app).get('/api/bills/search?q=חופש')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(2)
    expect(res.body[0].billId).toBe(1038990)
    expect(res.body[0].name).toBe('הצעת חוק חופש העיסוק, התשפ"ו-2026')
    expect(res.body[0].knessetUrl).toContain('lawitemid=1038990')
  })
})

describe('POST /api/bills/track', () => {
  beforeAll(async () => { await setupTestDb() })

  beforeEach(async () => {
    // Delete in FK-dependency order; keep users row to avoid stale cache in module-level singleton
    await db.delete(trackedBills)
    await db.delete(bills)
  })

  it('returns 400 when billId is missing', async () => {
    const res = await request(app).post('/api/bills/track').send({ name: 'test' })
    expect(res.status).toBe(400)
  })

  it('returns 400 when name is missing', async () => {
    const res = await request(app).post('/api/bills/track').send({ billId: 1038990 })
    expect(res.status).toBe(400)
  })

  it('creates a bills entity and tracked_bills row on first track', async () => {
    const res = await request(app).post('/api/bills/track').send({
      billId: 1038990,
      name: 'הצעת חוק חופש העיסוק',
      knessetUrl: 'https://www.knesset.gov.il/privatelaw/hql_knesset_det.aspx?knesset=25&hql_id=1038990',
    })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.duplicate).toBeUndefined()

    const allBills = await db.select().from(bills)
    expect(allBills).toHaveLength(1)
    expect(allBills[0].title).toBe('הצעת חוק חופש העיסוק')

    const tracked = await db.select().from(trackedBills)
    expect(tracked).toHaveLength(1)
    expect(tracked[0].position).toBe('עוקבים')
  })

  it('returns duplicate:true and does not create a second tracked_bills row', async () => {
    await request(app).post('/api/bills/track').send({
      billId: 1038990,
      name: 'הצעת חוק חופש העיסוק',
    })

    const res = await request(app).post('/api/bills/track').send({
      billId: 1038990,
      name: 'הצעת חוק חופש העיסוק',
    })
    expect(res.status).toBe(200)
    expect(res.body.duplicate).toBe(true)

    expect(await db.select().from(bills)).toHaveLength(1)
    expect(await db.select().from(trackedBills)).toHaveLength(1)
  })
})
