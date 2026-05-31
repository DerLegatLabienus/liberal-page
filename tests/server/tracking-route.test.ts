import { vi, describe, it, expect, beforeAll, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import { setupTestDb } from './db-harness'
import { db } from '../../server/db/client'
import {
  bills, trackedBills,
  committees, trackedCommittees,
  mks, trackedMks, mkKnessetTerms, mkRoles, mkActivity, mkVotes,
} from '../../server/db/schema'
import { UsersRepository } from '../../server/repositories/users-repository'
import { TrackedBillsRepository } from '../../server/repositories/tracked-bills-repository'

// Mock external services — network only
vi.mock('../../server/services/oknesset', () => ({
  OknessetClient: vi.fn().mockImplementation(() => ({
    getBill: vi.fn().mockResolvedValue({
      law_id: 1044632,
      title: 'הצעת חוק בדיקה',
      committee: 'ועדת הכנסת',
    }),
    getCommittee: vi.fn().mockResolvedValue({
      name: 'ועדת הכנסת',
      chairperson: 'יו"ר הוועדה',
    }),
    getMk: vi.fn().mockResolvedValue({
      name: 'חבר כנסת בדיקה',
      party: 'מפלגה א',
    }),
  })),
}))

vi.mock('../../server/services/url-parser', () => ({
  parseKnessetUrl: vi.fn((url: string) => {
    if (url.includes('/bill/')) return { type: 'bill', id: '12345' }
    if (url.includes('/committee/')) return { type: 'committee', id: '67890' }
    if (url.includes('/mk/')) return { type: 'mk', id: '1116' }
    return null
  }),
  isKnessetSiteUrl: vi.fn(() => false),
}))

vi.mock('../../server/services/knesset-api', () => ({
  getMkBySiteId: vi.fn().mockResolvedValue({
    knsId: 999,
    name: 'מ"כ דוגמה',
    email: null,
    faction: 'מפלגה ב',
    positions: [],
  }),
}))

vi.mock('../../server/services/knesset-scraper', () => ({
  fetchMkActivity: vi.fn().mockResolvedValue([]),
}))

vi.mock('../../server/services/knesset-config', () => ({
  getCurrentKnesset: vi.fn().mockReturnValue(25),
}))

import trackingRouter from '../../server/routes/tracking'

const app = express()
app.use(express.json())
app.use('/api/tracking', trackingRouter)

describe('POST /api/tracking/add + DELETE /api/tracking/:type/:id', () => {
  const usersRepo = new UsersRepository()
  const trackedBillsRepo = new TrackedBillsRepository()

  beforeAll(async () => { await setupTestDb() })

  beforeEach(async () => {
    // Delete in dependency order: tracked rows, then MK child tables, then entities
    // Keep users to avoid stale cache in module-level singleton
    await db.delete(trackedMks)
    await db.delete(trackedCommittees)
    await db.delete(trackedBills)
    await db.delete(mkVotes)
    await db.delete(mkActivity)
    await db.delete(mkRoles)
    await db.delete(mkKnessetTerms)
    await db.delete(mks)
    await db.delete(committees)
    await db.delete(bills)
    // Do NOT delete users — the module-level UsersRepository singleton in the route
    // caches the shared user ID; re-creating users each test causes FK violations.
    // Instead ensure the shared user exists once.
    usersRepo['cachedId'] = null
    await usersRepo.getSharedUserId()
  })

  describe('bill flow', () => {
    it('POST /add creates a bills row and tracks it for the shared user', async () => {
      const res = await request(app)
        .post('/api/tracking/add')
        .send({ url: 'https://oknesset.org/bill/12345' })

      expect(res.status).toBe(200)
      expect(res.body.ok).toBe(true)

      const sharedUserId = await usersRepo.getSharedUserId()
      const tracked = await trackedBillsRepo.getAll(sharedUserId, 25)
      expect(tracked).toHaveLength(1)
      expect(tracked[0].title).toBe('הצעת חוק בדיקה')
      expect(tracked[0].position).toBe('עוקבים')
    })

    it('DELETE /bill/:id untracks but keeps the bills row', async () => {
      // First add
      await request(app)
        .post('/api/tracking/add')
        .send({ url: 'https://oknesset.org/bill/12345' })

      const sharedUserId = await usersRepo.getSharedUserId()
      const tracked = await trackedBillsRepo.getAll(sharedUserId, 25)
      expect(tracked).toHaveLength(1)
      const billEntityId = tracked[0].id!

      // Then delete
      const res = await request(app).delete(`/api/tracking/bill/${billEntityId}`)
      expect(res.status).toBe(200)
      expect(res.body.ok).toBe(true)

      // Tracking row gone
      const afterDelete = await trackedBillsRepo.getAll(sharedUserId, 25)
      expect(afterDelete).toHaveLength(0)

      // But entity still exists
      const billRows = await db.select().from(bills)
      expect(billRows).toHaveLength(1)
    })
  })

  describe('committee flow', () => {
    it('POST /add creates a committees row and tracks it', async () => {
      const res = await request(app)
        .post('/api/tracking/add')
        .send({ url: 'https://oknesset.org/committee/67890' })

      expect(res.status).toBe(200)
      expect(res.body.ok).toBe(true)

      const committeeRows = await db.select().from(committees)
      expect(committeeRows).toHaveLength(1)
      expect(committeeRows[0].name).toBe('ועדת הכנסת')

      const trackedRows = await db.select().from(trackedCommittees)
      expect(trackedRows).toHaveLength(1)
    })

    it('DELETE /committee/:id untracks but keeps the entity', async () => {
      await request(app)
        .post('/api/tracking/add')
        .send({ url: 'https://oknesset.org/committee/67890' })

      const committeeRows = await db.select().from(committees)
      const committeeId = committeeRows[0].id

      const res = await request(app).delete(`/api/tracking/committee/${committeeId}`)
      expect(res.status).toBe(200)

      const tracked = await db.select().from(trackedCommittees)
      expect(tracked).toHaveLength(0)

      const stillExists = await db.select().from(committees)
      expect(stillExists).toHaveLength(1)
    })
  })

  describe('mk flow (oknesset path)', () => {
    it('POST /add creates an mks row and tracks it', async () => {
      const res = await request(app)
        .post('/api/tracking/add')
        .send({ url: 'https://oknesset.org/mk/1116' })

      expect(res.status).toBe(200)
      expect(res.body.ok).toBe(true)

      const mkRows = await db.select().from(mks)
      expect(mkRows).toHaveLength(1)
      expect(mkRows[0].name).toBe('חבר כנסת בדיקה')

      const trackedRows = await db.select().from(trackedMks)
      expect(trackedRows).toHaveLength(1)
    })

    it('DELETE /mk/:id untracks but keeps the entity', async () => {
      await request(app)
        .post('/api/tracking/add')
        .send({ url: 'https://oknesset.org/mk/1116' })

      const mkRows = await db.select().from(mks)
      const mkId = mkRows[0].id

      const res = await request(app).delete(`/api/tracking/mk/${mkId}`)
      expect(res.status).toBe(200)

      const tracked = await db.select().from(trackedMks)
      expect(tracked).toHaveLength(0)

      const stillExists = await db.select().from(mks)
      expect(stillExists).toHaveLength(1)
    })
  })

  describe('error cases', () => {
    it('POST /add returns 400 for unsupported URL with no rawId', async () => {
      const res = await request(app)
        .post('/api/tracking/add')
        .send({ url: 'https://example.com/not-knesset' })
      expect(res.status).toBe(400)
    })

    it('DELETE with unknown type returns 400', async () => {
      const res = await request(app).delete('/api/tracking/banana/1')
      expect(res.status).toBe(400)
    })
  })
})
