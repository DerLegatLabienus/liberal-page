import { vi, describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'

vi.mock('../../server/services/knesset-bills', () => ({
  fetchRecentBills: vi.fn(),
  fetchPolicyAlignedBills: vi.fn(),
  getTrendingBills: vi.fn(),
  getBillsFlags: vi.fn(),
}))

import billsRouter from '../../server/routes/bills'
import {
  fetchRecentBills, fetchPolicyAlignedBills, getTrendingBills, getBillsFlags,
} from '../../server/services/knesset-bills'

const app = express()
app.use(express.json())
app.use('/api/bills', billsRouter)

const ITEM = {
  billId: 1, title: 'x', statusId: 101, status: 'הכנה', committee: '',
  lastUpdatedDate: '2026-05-01', summary: '', knessetUrl: 'http://k/1',
}

describe('GET /api/bills/recent', () => {
  beforeEach(() => vi.clearAllMocks())
  it('returns mapped recent bills', async () => {
    vi.mocked(fetchRecentBills).mockResolvedValue([ITEM])
    const res = await request(app).get('/api/bills/recent')
    expect(res.status).toBe(200)
    expect(res.body[0].billId).toBe(1)
    expect(vi.mocked(fetchRecentBills).mock.calls[0][0]).toBe(10) // default limit
  })
  it('returns 500 with error message on failure', async () => {
    vi.mocked(fetchRecentBills).mockRejectedValue(new Error('boom'))
    const res = await request(app).get('/api/bills/recent')
    expect(res.status).toBe(500)
    expect(res.body.error).toBeDefined()
  })
})

describe('GET /api/bills/trending', () => {
  beforeEach(() => vi.clearAllMocks())
  it('returns trending bills', async () => {
    vi.mocked(getTrendingBills).mockResolvedValue([{ ...ITEM, reason: 'r' }])
    const res = await request(app).get('/api/bills/trending')
    expect(res.status).toBe(200)
    expect(res.body[0].reason).toBe('r')
  })
})

describe('GET /api/bills/policy-aligned', () => {
  beforeEach(() => vi.clearAllMocks())
  it('returns policy-aligned bills when enabled', async () => {
    vi.mocked(getBillsFlags).mockResolvedValue({ trendingAlgorithm: 'manual', recentRanking: 'newest', policyFilterEnabled: true })
    vi.mocked(fetchPolicyAlignedBills).mockResolvedValue([ITEM])
    const res = await request(app).get('/api/bills/policy-aligned')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
  })
  it('returns 404 when policyFilterEnabled is false', async () => {
    vi.mocked(getBillsFlags).mockResolvedValue({ trendingAlgorithm: 'manual', recentRanking: 'newest', policyFilterEnabled: false })
    const res = await request(app).get('/api/bills/policy-aligned')
    expect(res.status).toBe(404)
  })
})
