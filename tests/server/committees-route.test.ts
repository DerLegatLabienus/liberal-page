import { vi, describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import { readFile, writeFile } from 'fs/promises'

vi.mock('fs/promises')
vi.stubGlobal('fetch', vi.fn())
vi.mock('../../server/repositories/committee-list-repository', () => ({
  CommitteeListRepository: vi.fn().mockImplementation(() => ({
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    getAgeMs: vi.fn().mockReturnValue(Infinity),
  })),
}))

import committeesRouter from '../../server/routes/committees'

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
  beforeEach(() => vi.mocked(fetch).mockReset())
  it('returns 200 with committee list including SiteId-based URLs', async () => {
    // committees batch first, then site code batch (filtered by committeeIds)
    const SITE_CODES = [
      { KnsID: 2, SiteId: 100 },
      { KnsID: 3, SiteId: 200 },
    ]
    vi.mocked(fetch)
      .mockResolvedValueOnce(mockOdata(ODATA_COMMITTEES)) // Step 1: committee list
      .mockResolvedValueOnce(mockOdata(SITE_CODES))        // Step 2: site codes batch
    const res = await request(app).get('/api/committees/list')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(2)
    expect(res.body[0].committeeId).toBe(2)
    expect(res.body[0].name).toBe('ועדת הכספים')
    // URL should use the SiteId from KNS_CmtSiteCode
    expect(res.body[0].knessetUrl).toBe('https://main.knesset.gov.il/apps/committees/100')
  })

  it('falls back to generic committee URL when no SiteId found', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(mockOdata(ODATA_COMMITTEES)) // committees
      .mockResolvedValueOnce(mockOdata([]))               // no site codes found
    const res = await request(app).get('/api/committees/list')
    expect(res.status).toBe(200)
    expect(res.body[0].knessetUrl).toBe('https://main.knesset.gov.il/apps/committees')
  })
})

describe('POST /api/committees/track', () => {
  beforeEach(() => {
    vi.mocked(readFile).mockResolvedValue('[]' as never)
    vi.mocked(writeFile).mockResolvedValue()
  })
  it('returns 400 when committeeId or name is missing', async () => {
    const res = await request(app).post('/api/committees/track').send({ name: 'test' })
    expect(res.status).toBe(400)
  })
  it('returns 200 and writes committee to data file', async () => {
    const res = await request(app).post('/api/committees/track').send({
      committeeId: 2, name: 'ועדת הכספים',
      knessetUrl: 'https://www.knesset.gov.il/committees/heb/committee_det.aspx?commmid=2',
    })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(writeFile).toHaveBeenCalledOnce()
  })
  it('skips duplicate committeeId', async () => {
    vi.mocked(readFile).mockResolvedValue(JSON.stringify([
      { id: 1, oknesset_id: '2', name: 'existing', chair: '', lastSessionDate: null, lastSessionSummary: null, lastSessionDocumentUrl: null, sourceUrl: '', hasNewData: false, lastPolledAt: null }
    ]) as never)
    const res = await request(app).post('/api/committees/track').send({
      committeeId: 2, name: 'ועדת הכספים',
      knessetUrl: 'https://www.knesset.gov.il/committees/heb/committee_det.aspx?commmid=2',
    })
    expect(res.status).toBe(200)
    expect(res.body.duplicate).toBe(true)
    expect(writeFile).not.toHaveBeenCalled()
  })
})
