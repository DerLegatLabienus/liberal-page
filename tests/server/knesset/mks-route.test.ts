import { vi, describe, it, expect } from 'vitest'
import request from 'supertest'
import express from 'express'

vi.mock('../../../server/services/knesset-members', () => ({
  fetchAllKnessetMembers: vi.fn().mockResolvedValue([
    { siteId: 1116, name: 'דן אילוז', party: 'הליכוד', photoUrl: null, isLiberal: false, isSupporter: false },
  ]),
}))
vi.mock('../../../server/services/knesset-scraper', () => ({
  fetchMkActivity: vi.fn().mockResolvedValue([
    { type: 'vote', date: '2026-05-13T11:42:00', title: 'הצבעה', detail: 'הצביע בעד' },
  ]),
}))
vi.mock('../../../server/repositories/mk-list-repository', () => ({
  MkListRepository: vi.fn().mockImplementation(() => ({
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    getAgeMs: vi.fn().mockReturnValue(Infinity),
  })),
}))
vi.mock('../../../server/repositories/mk-annotations-repository', () => ({
  MkAnnotationsRepository: vi.fn().mockImplementation(() => ({
    getAll: vi.fn().mockResolvedValue({ '1116': { isLiberal: true, isSupporter: false } }),
  })),
}))

import mksRouter from '../../../server/routes/mks'

const app = express()
app.use(express.json())
app.use('/api/mks', mksRouter)

describe('GET /api/mks/list', () => {
  it('returns 200 with array of KnessetMember', async () => {
    const res = await request(app).get('/api/mks/list')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].siteId).toBe(1116)
  })

  it('merges isLiberal annotation from repository', async () => {
    const res = await request(app).get('/api/mks/list')
    expect(res.body[0].isLiberal).toBe(true)
  })
})

describe('GET /api/mks/activity', () => {
  it('returns 400 when siteId is missing', async () => {
    const res = await request(app).get('/api/mks/activity')
    expect(res.status).toBe(400)
  })

  it('returns 200 with activity array for valid siteId', async () => {
    const res = await request(app).get('/api/mks/activity?siteId=1116')
    expect(res.status).toBe(200)
    expect(res.body[0].type).toBe('vote')
  })
})
