import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

vi.mock('@/lib/api-client', () => ({
  api: {
    mks: {
      list: vi.fn(),
    },
  },
}))

import { useMkList, resetSessionCache } from '@/hooks/useMkList'
import { api } from '@/lib/api-client'

const MEMBERS = [
  { siteId: 1116, name: 'דן אילוז', party: 'הליכוד', photoUrl: null, isLiberal: true, isSupporter: false },
]

describe('useMkList', () => {
  beforeEach(() => {
    resetSessionCache()
    vi.mocked(api.mks.list).mockResolvedValue(MEMBERS)
    vi.resetModules()
  })

  it('returns loading:true initially', () => {
    const { result } = renderHook(() => useMkList())
    expect(result.current.loading).toBe(true)
  })

  it('returns mks after fetch resolves', async () => {
    const { result } = renderHook(() => useMkList())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.mks).toHaveLength(1)
    expect(result.current.mks[0].siteId).toBe(1116)
  })

  it('returns error when fetch fails', async () => {
    vi.mocked(api.mks.list).mockRejectedValueOnce(new Error('network error'))
    const { result } = renderHook(() => useMkList())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('network error')
  })
})
