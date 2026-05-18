import { vi, describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import { readFile, writeFile } from 'fs/promises'

vi.mock('fs/promises')
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
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'))
    vi.mocked(writeFile).mockResolvedValue()
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
    expect(res.body[0].knessetUrl).toContain('1038990')
  })
})

describe('POST /api/bills/track', () => {
  beforeEach(() => {
    vi.mocked(readFile).mockResolvedValue('[]' as never)
    vi.mocked(writeFile).mockResolvedValue()
  })

  it('returns 400 when billId or name is missing', async () => {
    const res = await request(app).post('/api/bills/track').send({ name: 'test' })
    expect(res.status).toBe(400)
  })

  it('returns 200 and writes bill to data file', async () => {
    const res = await request(app).post('/api/bills/track').send({
      billId: 1038990,
      name: 'הצעת חוק חופש העיסוק',
      knessetUrl: 'https://www.knesset.gov.il/privatelaw/hql_knesset_det.aspx?knesset=25&hql_id=1038990',
    })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(writeFile).toHaveBeenCalledOnce()
    const [, content] = vi.mocked(writeFile).mock.calls[0]
    const written = JSON.parse(content as string)
    expect(written[0].title).toBe('הצעת חוק חופש העיסוק')
    expect(written[0].knessetUrl).toContain('1038990')
  })

  it('skips duplicate billId', async () => {
    vi.mocked(readFile).mockResolvedValue(JSON.stringify([
      { id: 1, oknesset_id: '', knessetUrl: 'https://www.knesset.gov.il/privatelaw/hql_knesset_det.aspx?knesset=25&hql_id=1038990', title: 'existing', number: '', status: 'בוועדה', position: 'עוקבים', notes: '', committee: '', sourceUrl: '', documentUrl: null, hasNewData: false, lastPolledAt: null }
    ]) as never)
    const res = await request(app).post('/api/bills/track').send({
      billId: 1038990,
      name: 'הצעת חוק חופש העיסוק',
      knessetUrl: 'https://www.knesset.gov.il/privatelaw/hql_knesset_det.aspx?knesset=25&hql_id=1038990',
    })
    expect(res.status).toBe(200)
    expect(res.body.duplicate).toBe(true)
    expect(writeFile).not.toHaveBeenCalled()
  })
})
