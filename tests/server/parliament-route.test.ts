import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import { setupTestDb } from './db-harness'
import { db } from '../../server/db/client'
import { users, bills, trackedBills } from '../../server/db/schema'
import { UsersRepository } from '../../server/repositories/users-repository'
import { BillsRepository } from '../../server/repositories/bills-repository'
import { TrackedBillsRepository } from '../../server/repositories/tracked-bills-repository'
import parliamentRouter from '../../server/routes/parliament'

const app = express()
app.use(express.json())
app.use('/api/parliament', parliamentRouter)

describe('GET /api/parliament/:type', () => {
  beforeAll(async () => { await setupTestDb() })
  beforeEach(async () => { await db.delete(trackedBills); await db.delete(bills); await db.delete(users) })

  it('returns tracked bills for the shared user', async () => {
    const userId = await new UsersRepository().getSharedUserId()
    const billId = await new BillsRepository().upsert({
      oknessetId: '', number: '1', title: 'חוק', status: 'בוועדה', committee: '',
      sourceUrl: '', documentUrl: null, knessetUrl: null, knessetNumber: 25, hasNewData: false, lastPolledAt: null,
    })
    await new TrackedBillsRepository().track(userId, billId, 'תומכים', '', 25)
    const res = await request(app).get('/api/parliament/bill')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].position).toBe('תומכים')
  })

  it('returns 400 for an unknown type', async () => {
    const res = await request(app).get('/api/parliament/banana')
    expect(res.status).toBe(400)
  })
})
