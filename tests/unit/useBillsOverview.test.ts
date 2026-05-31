import { renderHook, waitFor, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/api-client', () => ({
  api: {
    bills: { recent: vi.fn(), trending: vi.fn(), policyAligned: vi.fn() },
    featureFlags: { get: vi.fn().mockResolvedValue({ policyFilter: { enabled: true, value: null } }) },
  },
}))

import { useBillsOverview } from '@/hooks/useBillsOverview'
import { api } from '@/lib/api-client'

const ITEM = { billId: 1, title: 'x', statusId: 101, status: 'הכנה', committee: '', lastUpdatedDate: '', summary: '', knessetUrl: 'http://k/1' }

describe('useBillsOverview', () => {
  beforeEach(() => {
    vi.mocked(api.bills.recent).mockResolvedValue([ITEM])
    vi.mocked(api.bills.trending).mockResolvedValue([{ ...ITEM, reason: 'r' }])
    vi.mocked(api.bills.policyAligned).mockResolvedValue([ITEM])
  })

  it('loads all three tabs', async () => {
    const { result } = renderHook(() => useBillsOverview())
    await waitFor(() => expect(result.current.recent.loading).toBe(false))
    expect(result.current.recent.items).toHaveLength(1)
    expect(result.current.trending.items[0].reason).toBe('r')
    await waitFor(() => expect(result.current.policyAligned.items).toHaveLength(1))
  })

  it('captures a per-tab error without affecting others', async () => {
    vi.mocked(api.bills.recent).mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => useBillsOverview())
    await waitFor(() => expect(result.current.recent.loading).toBe(false))
    expect(result.current.recent.error).toBe('boom')
    expect(result.current.trending.items).toHaveLength(1)
  })

  it('retry re-fetches a failed tab', async () => {
    vi.mocked(api.bills.recent).mockRejectedValueOnce(new Error('boom'))
    const { result } = renderHook(() => useBillsOverview())
    await waitFor(() => expect(result.current.recent.error).toBe('boom'))
    vi.mocked(api.bills.recent).mockResolvedValue([ITEM])
    await act(async () => { await result.current.recent.retry() })
    await waitFor(() => expect(result.current.recent.items).toHaveLength(1))
  })
})
