import { vi, describe, it, expect, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// Control the SSRF guard and the summarizer from the test; keep the real error class.
// vi.hoisted so these exist when the hoisted vi.mock factories run.
const { assertMock, summarizeUrlMock } = vi.hoisted(() => ({ assertMock: vi.fn(), summarizeUrlMock: vi.fn() }))
vi.mock('../../../server/services/url-guard', async (orig) => {
  const actual = await orig<typeof import('../../../server/services/url-guard')>()
  return { ...actual, assertAllowedDocumentUrl: (...a: unknown[]) => assertMock(...a) }
})
vi.mock('../../../server/services/summarizer', () => ({
  Summarizer: vi.fn().mockImplementation(() => ({ summarizeUrl: summarizeUrlMock })),
}))

import summarizeRouter, { _resetSummarizeLimiter } from '../../../server/routes/summarize'
import { UrlNotAllowedError } from '../../../server/services/url-guard'
import { issueAccessToken } from '../../../server/services/auth-service'

const app = express()
app.use(express.json())
app.use('/api/summarize', summarizeRouter)

const token = issueAccessToken({ id: 1, email: 'm@x.com', name: 'M', role: 'member' })
const KNESSET_URL = 'https://main.knesset.gov.il/x.pdf'
const post = (body: unknown, auth = true) => {
  const r = request(app).post('/api/summarize')
  return (auth ? r.set('Authorization', `Bearer ${token}`) : r).send(body)
}

describe('POST /api/summarize', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    _resetSummarizeLimiter()
    assertMock.mockResolvedValue(new URL(KNESSET_URL))
    summarizeUrlMock.mockResolvedValue('סיכום')
  })

  it('401 without a token', async () => {
    expect((await post({ url: KNESSET_URL }, false)).status).toBe(401)
  })

  it('400 when url is missing', async () => {
    expect((await post({})).status).toBe(400)
  })

  it('400 when the URL is blocked by the SSRF guard', async () => {
    assertMock.mockRejectedValueOnce(new UrlNotAllowedError('host evil.example'))
    const res = await post({ url: 'https://evil.example/x' })
    expect(res.status).toBe(400)
    expect(summarizeUrlMock).not.toHaveBeenCalled()
  })

  it('422 when the summarizer returns null (irrelevant / unsummarizable)', async () => {
    summarizeUrlMock.mockResolvedValueOnce(null)
    expect((await post({ url: KNESSET_URL })).status).toBe(422)
  })

  it('200 with the summary on the happy path', async () => {
    const res = await post({ url: KNESSET_URL })
    expect(res.status).toBe(200)
    expect(res.body.summary).toBe('סיכום')
  })

  it('429 once the per-IP rate limit is exceeded', async () => {
    for (let i = 0; i < 10; i++) expect((await post({ url: KNESSET_URL })).status).toBe(200)
    expect((await post({ url: KNESSET_URL })).status).toBe(429)
  })
})
