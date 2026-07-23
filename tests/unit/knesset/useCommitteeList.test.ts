import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

vi.mock('@/lib/api-client', () => ({ api: { committees: { list: vi.fn() } } }))

import { useCommitteeList, resetSessionCache } from '@/hooks/useCommitteeList'
import { api } from '@/lib/api-client'

const COMMITTEES = [{ committeeId: 2, name: 'ועדת הכספים', knessetUrl: 'https://www.knesset.gov.il/committees/heb/committee_det.aspx?commmid=2' }]

describe('useCommitteeList', () => {
  beforeEach(() => {
    resetSessionCache()
    vi.mocked(api.committees.list).mockResolvedValue(COMMITTEES)
    vi.resetModules()
  })
  it('returns loading:true initially', () => {
    const { result } = renderHook(() => useCommitteeList())
    expect(result.current.loading).toBe(true)
  })
  it('returns committees after fetch resolves', async () => {
    const { result } = renderHook(() => useCommitteeList())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.committees).toHaveLength(1)
    expect(result.current.committees[0].committeeId).toBe(2)
  })
  it('returns error on fetch failure', async () => {
    vi.mocked(api.committees.list).mockRejectedValueOnce(new Error('network error'))
    const { result } = renderHook(() => useCommitteeList())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('network error')
  })
})
