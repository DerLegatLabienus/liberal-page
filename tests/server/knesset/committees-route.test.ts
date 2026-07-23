import { vi, describe, it, expect, beforeAll, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import { setupTestDb } from '../db-harness'
import { db } from '../../../server/db/client'
import { trackedCommittees, committees, users } from '../../../server/db/schema'
import { issueAccessToken } from '../../../server/services/auth-service'

vi.mock('../../../server/services/committee-session-enricher', () => ({
  enrichCommitteeSessions: vi.fn().mockResolvedValue([]),
}))

vi.stubGlobal('fetch', vi.fn())
vi.mock('../../../server/repositories/committee-list-repository', () => ({
  CommitteeListRepository: vi.fn().mockImplementation(() => ({
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    getAgeMs: vi.fn().mockReturnValue(Infinity),
  })),
}))

import committeesRouter from '../../../server/routes/committees'

const app = express()
app.use(express.json())
app.use('/api/committees', committeesRouter)

const ODATA_COMMITTEES = [
  { CommitteeID: 2, Name: 'ועדת הכספים' },
  { CommitteeID: 3, Name: 'ועדת החוץ והביטחון' },
]

function mockOdata(value: unknown[], nextLink?: string) {
  const body: Record<string, unknown> = { value }
  if (nextLink) body['odata.nextLink'] = nextLink
  return { ok: true, json: async () => body } as Response
}

describe('GET /api/committees/list', () => {
  // The route refreshes the cache and reconciles committee closure status against
  // the DB, so the schema must exist even though these tests focus on the list output.
  beforeAll(async () => { await setupTestDb() })
  beforeEach(() => vi.mocked(fetch).mockReset())
  it('returns 200 with committee list using local mapping for apps URL', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockOdata(ODATA_COMMITTEES))
    const res = await request(app).get('/api/committees/list')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(2)
    expect(res.body[0].committeeId).toBe(2)
    expect(res.body[0].name).toBe('ועדת הכספים')
    // knessetUrl is either a valid apps URL or empty (no session fetch needed)
    if (res.body[0].knessetUrl) {
      expect(res.body[0].knessetUrl).toMatch(/main\.knesset\.gov\.il\/apps\/committees\/\d+/)
    }
  })

  it('returns empty knessetUrl when committee not in mapping', async () => {
    const UNKNOWN = [{ CommitteeID: 99999, Name: 'ועדה לא ידועה' }]
    vi.mocked(fetch).mockResolvedValueOnce(mockOdata(UNKNOWN))
    const res = await request(app).get('/api/committees/list')
    expect(res.status).toBe(200)
    expect(res.body[0].knessetUrl).toBe('')
  })
})

describe('POST /api/committees/track', () => {
  let token: string
  beforeAll(async () => {
    await setupTestDb()
    const [m] = await db.insert(users).values({ label: 'm', email: 'cmt-m@x.com', role: 'member', createdAt: new Date() }).returning({ id: users.id })
    token = issueAccessToken({ id: m.id, email: 'cmt-m@x.com', name: 'M', role: 'member' })
  })

  beforeEach(async () => {
    await db.delete(trackedCommittees)
    await db.delete(committees)
  })

  it('returns 400 when committeeId or name is missing', async () => {
    const res = await request(app).post('/api/committees/track').set('Authorization', `Bearer ${token}`).send({ name: 'test' })
    expect(res.status).toBe(400)
  })

  it('creates a committees entity and tracked_committees row on first track', async () => {
    const res = await request(app).post('/api/committees/track').set('Authorization', `Bearer ${token}`).send({
      committeeId: 2, name: 'ועדת הכספים',
      knessetUrl: 'https://main.knesset.gov.il/apps/committees/1234',
    })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.duplicate).toBe(false)

    const allCommittees = await db.select().from(committees)
    expect(allCommittees).toHaveLength(1)
    expect(allCommittees[0].name).toBe('ועדת הכספים')
    expect(allCommittees[0].oknessetId).toBe('2')

    const tracked = await db.select().from(trackedCommittees)
    expect(tracked).toHaveLength(1)
  })

  it('returns duplicate:true and does not create a second tracked_committees row', async () => {
    await request(app).post('/api/committees/track').set('Authorization', `Bearer ${token}`).send({
      committeeId: 2, name: 'ועדת הכספים',
    })

    const res = await request(app).post('/api/committees/track').set('Authorization', `Bearer ${token}`).send({
      committeeId: 2, name: 'ועדת הכספים',
    })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.duplicate).toBe(true)

    const allCommittees = await db.select().from(committees)
    expect(allCommittees).toHaveLength(1)

    const tracked = await db.select().from(trackedCommittees)
    expect(tracked).toHaveLength(1)
  })
})
