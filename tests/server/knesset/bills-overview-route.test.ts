import { vi, describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { createTestApp } from '../../support/test-app'

const mockGetAll = vi.fn().mockResolvedValue({})

vi.mock('../../../server/services/knesset-bills', () => ({
  fetchRecentBills: vi.fn(),
  fetchPolicyAlignedBills: vi.fn(),
  fetchTrendingBills: vi.fn(),
}))

vi.mock('../../../server/repositories/feature-flags-repository', () => ({
  FeatureFlagsRepository: vi.fn().mockImplementation(() => ({
    getAll: mockGetAll,
  })),
}))

import billsRouter from '../../../server/routes/bills'
import {
  fetchRecentBills, fetchPolicyAlignedBills, fetchTrendingBills,
} from '../../../server/services/knesset-bills'

const app = createTestApp('/api/bills', billsRouter)

const ITEM = {
  billId: 1, title: 'x', statusId: 101, status: 'הכנה', committee: '',
  lastUpdatedDate: '2026-05-01', summary: '', knessetUrl: 'http://k/1',
}

describe('GET /api/bills/recent', () => {
  beforeEach(() => vi.clearAllMocks())
  it('returns mapped recent bills with default newest ranking', async () => {
    vi.mocked(fetchRecentBills).mockResolvedValue([ITEM])
    const res = await request(app).get('/api/bills/recent')
    expect(res.status).toBe(200)
    expect(res.body[0].billId).toBe(1)
    const [limit, ranking] = vi.mocked(fetchRecentBills).mock.calls[0]
    expect(limit).toBe(10)
    expect(ranking).toBe('newest') // flag absent → default
  })
  it('passes progress ranking when recentRanking flag is set', async () => {
    mockGetAll.mockResolvedValueOnce({ recentRanking: { enabled: true, value: 'progress' } })
    vi.mocked(fetchRecentBills).mockResolvedValue([ITEM])
    await request(app).get('/api/bills/recent')
    expect(vi.mocked(fetchRecentBills).mock.calls[0][1]).toBe('progress')
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
  it('returns trending bills with default manual algorithm', async () => {
    vi.mocked(fetchTrendingBills).mockResolvedValue([{ ...ITEM, reason: 'r' }])
    const res = await request(app).get('/api/bills/trending')
    expect(res.status).toBe(200)
    expect(res.body[0].reason).toBe('r')
    expect(vi.mocked(fetchTrendingBills).mock.calls[0][0]).toBe('manual') // flag absent → default
  })
  it('forwards the trendingAlgorithm flag value', async () => {
    mockGetAll.mockResolvedValueOnce({ trendingAlgorithm: { enabled: true, value: 'sponsorship' } })
    vi.mocked(fetchTrendingBills).mockResolvedValue([])
    await request(app).get('/api/bills/trending')
    expect(vi.mocked(fetchTrendingBills).mock.calls[0][0]).toBe('sponsorship')
  })
})

describe('GET /api/bills/policy-aligned', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns policy-aligned bills when enabled', async () => {
    mockGetAll.mockResolvedValueOnce({ policyFilter: { enabled: true, value: null } })
    vi.mocked(fetchPolicyAlignedBills).mockResolvedValue([ITEM])
    const res = await request(app).get('/api/bills/policy-aligned')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
  })

  it('returns 404 when policyFilter is disabled', async () => {
    mockGetAll.mockResolvedValueOnce({ policyFilter: { enabled: false, value: null } })
    const res = await request(app).get('/api/bills/policy-aligned')
    expect(res.status).toBe(404)
  })
})
