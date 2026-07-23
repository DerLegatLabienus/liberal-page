import { vi, describe, it, expect, beforeAll, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import { setupTestDb } from './db-harness'
import { db } from '../../server/db/client'
import {
  users, bills, trackedBills,
  committees, trackedCommittees,
  mks, trackedMks, mkKnessetTerms, mkRoles, mkActivity, mkVotes,
} from '../../server/db/schema'
import { UsersRepository } from '../../server/repositories/users-repository'
import { TrackedBillsRepository } from '../../server/repositories/tracked-bills-repository'
import { issueAccessToken } from '../../server/services/auth-service'

vi.mock('../../server/services/oknesset', () => ({
  OknessetClient: vi.fn().mockImplementation(() => ({
    getBill: vi.fn().mockResolvedValue({ law_id: 1044632, title: 'הצעת חוק בדיקה', committee: 'ועדת הכנסת' }),
    getCommittee: vi.fn().mockResolvedValue({ name: 'ועדת הכנסת', chairperson: 'יו"ר הוועדה' }),
    getMk: vi.fn().mockResolvedValue({ name: 'חבר כנסת בדיקה', party: 'מפלגה א' }),
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
  getMkBySiteId: vi.fn().mockResolvedValue({ knsId: 999, name: 'מ"כ דוגמה', email: null, faction: 'מפלגה ב', positions: [] }),
}))
vi.mock('../../server/services/knesset-scraper', () => ({ fetchMkActivity: vi.fn().mockResolvedValue([]) }))
vi.mock('../../server/services/knesset-config', () => ({ getCurrentKnesset: vi.fn().mockReturnValue(25) }))

import trackingRouter from '../../server/routes/tracking'

const app = express()
app.use(express.json())
app.use('/api/tracking', trackingRouter)

describe('tracking routes (auth + scope)', () => {
  const usersRepo = new UsersRepository()
  const trackedBillsRepo = new TrackedBillsRepository()
  let memberId: number
  let memberToken: string
  let adminToken: string

  beforeAll(async () => {
    await setupTestDb()
    const [m] = await db.insert(users).values({ label: 'm', email: 'm@x.com', role: 'member', createdAt: new Date() }).returning({ id: users.id })
    const [a] = await db.insert(users).values({ label: 'a', email: 'a@x.com', role: 'admin', createdAt: new Date() }).returning({ id: users.id })
    memberId = m.id
    memberToken = issueAccessToken({ id: m.id, email: 'm@x.com', name: 'M', role: 'member' })
    adminToken = issueAccessToken({ id: a.id, email: 'a@x.com', name: 'A', role: 'admin' })
  })

  beforeEach(async () => {
    await db.delete(trackedMks); await db.delete(trackedCommittees); await db.delete(trackedBills)
    await db.delete(mkVotes); await db.delete(mkActivity); await db.delete(mkRoles); await db.delete(mkKnessetTerms)
    await db.delete(mks); await db.delete(committees); await db.delete(bills)
    usersRepo['cachedId'] = null
  })

  const addAs = (token: string, body: object, query = '') =>
    request(app).post(`/api/tracking/add${query}`).set('Authorization', `Bearer ${token}`).send(body)
  const delAs = (token: string, path: string, query = '') =>
    request(app).delete(`/api/tracking/${path}${query}`).set('Authorization', `Bearer ${token}`)

  describe('auth gate', () => {
    it('POST /add without a token → 401', async () => {
      const res = await request(app).post('/api/tracking/add').send({ url: 'https://oknesset.org/bill/12345' })
      expect(res.status).toBe(401)
    })
    it('DELETE without a token → 401', async () => {
      expect((await request(app).delete('/api/tracking/bill/1')).status).toBe(401)
    })
  })

  describe('personal scope (default)', () => {
    it('POST /add tracks the bill for the calling member', async () => {
      const res = await addAs(memberToken, { url: 'https://oknesset.org/bill/12345' })
      expect(res.status).toBe(200)
      const tracked = await trackedBillsRepo.getAll(memberId, 25)
      expect(tracked).toHaveLength(1)
      expect(tracked[0].title).toBe('הצעת חוק בדיקה')
    })

    it('DELETE untracks for the member but keeps the entity', async () => {
      await addAs(memberToken, { url: 'https://oknesset.org/bill/12345' })
      const tracked = await trackedBillsRepo.getAll(memberId, 25)
      const billEntityId = tracked[0].id!
      const res = await delAs(memberToken, `bill/${billEntityId}`)
      expect(res.status).toBe(200)
      expect(await trackedBillsRepo.getAll(memberId, 25)).toHaveLength(0)
      expect(await db.select().from(bills)).toHaveLength(1)
    })

    it('committee + mk flows track one row each for the member', async () => {
      await addAs(memberToken, { url: 'https://oknesset.org/committee/67890' })
      await addAs(memberToken, { url: 'https://oknesset.org/mk/1116' })
      expect(await db.select().from(trackedCommittees)).toHaveLength(1)
      expect(await db.select().from(trackedMks)).toHaveLength(1)
    })
  })

  describe('group scope (admin only)', () => {
    it('member writing scope=group → 403', async () => {
      const res = await addAs(memberToken, { url: 'https://oknesset.org/bill/12345' }, '?scope=group')
      expect(res.status).toBe(403)
      expect(await db.select().from(trackedBills)).toHaveLength(0)
    })

    it('admin writing scope=group tracks into the group list, not the admin\'s personal list', async () => {
      const res = await addAs(adminToken, { url: 'https://oknesset.org/bill/12345' }, '?scope=group')
      expect(res.status).toBe(200)
      const groupId = await usersRepo.getGroupUserId()
      expect(await trackedBillsRepo.getAll(groupId, 25)).toHaveLength(1)
    })
  })

  describe('dedup: same URL twice → one entity + one tracking row', () => {
    it('bill', async () => {
      await addAs(memberToken, { url: 'https://oknesset.org/bill/12345' })
      const res = await addAs(memberToken, { url: 'https://oknesset.org/bill/12345' })
      expect(res.status).toBe(200)
      expect(await db.select().from(bills)).toHaveLength(1)
      expect(await db.select().from(trackedBills)).toHaveLength(1)
    })
  })

  describe('error cases (authenticated)', () => {
    it('POST /add returns 400 for an unsupported URL', async () => {
      const res = await addAs(memberToken, { url: 'https://example.com/not-knesset' })
      expect(res.status).toBe(400)
    })
    it('DELETE with an unknown type returns 400', async () => {
      expect((await delAs(memberToken, 'banana/1')).status).toBe(400)
    })
  })
})
