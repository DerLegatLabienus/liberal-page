import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

vi.mock('@/lib/api-client', () => ({
  api: {
    mks: {
      activity: vi.fn(),
    },
  },
}))

import { useMkActivity, resetActivityCache } from '@/hooks/useMkActivity'
import { api } from '@/lib/api-client'

const ACTIVITY = [{ type: 'vote' as const, date: '2026-05-13T11:42:00', title: 'הצבעה', detail: 'הצביע בעד' }]

describe('useMkActivity', () => {
  beforeEach(() => {
    resetActivityCache()
    vi.clearAllMocks()
    vi.mocked(api.mks.activity).mockResolvedValue(ACTIVITY)
    vi.resetModules()
  })

  it('does not fetch when siteId is null', () => {
    renderHook(() => useMkActivity(null))
    expect(api.mks.activity).not.toHaveBeenCalled()
  })

  it('returns loading:true when siteId provided and not cached', () => {
    const { result } = renderHook(() => useMkActivity(1116))
    expect(result.current.loading).toBe(true)
  })

  it('returns activity after fetch resolves', async () => {
    const { result } = renderHook(() => useMkActivity(1116))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.activity).toHaveLength(1)
    expect(result.current.activity![0].type).toBe('vote')
  })

  it('fetches only once when siteId is the same across two renders', async () => {
    const { result, rerender } = renderHook(({ id }) => useMkActivity(id), {
      initialProps: { id: 1116 as number | null },
    })
    await waitFor(() => expect(result.current.loading).toBe(false))
    rerender({ id: 1116 })
    expect(api.mks.activity).toHaveBeenCalledTimes(1)
  })
})
