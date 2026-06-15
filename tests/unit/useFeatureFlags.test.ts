import { vi, describe, it, expect, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }))
vi.mock('@/lib/api-client', () => ({ api: { featureFlags: { get: getMock } } }))

import { useFeatureFlags, _resetFeatureFlagsCache } from '@/hooks/useFeatureFlags'

describe('useFeatureFlags', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    _resetFeatureFlagsCache()
    getMock.mockResolvedValue({ x: { enabled: true, value: null } })
  })

  it('dedupes: several simultaneous hook mounts trigger a single fetch', async () => {
    const a = renderHook(() => useFeatureFlags())
    const b = renderHook(() => useFeatureFlags())
    const c = renderHook(() => useFeatureFlags())
    await waitFor(() => expect(a.result.current.x?.enabled).toBe(true))
    expect(getMock).toHaveBeenCalledTimes(1)
    expect(b.result.current.x?.enabled).toBe(true)
    expect(c.result.current.x?.enabled).toBe(true)
  })

  it('serves cached flags on later mounts without refetching', async () => {
    const first = renderHook(() => useFeatureFlags())
    await waitFor(() => expect(first.result.current.x?.enabled).toBe(true))
    expect(getMock).toHaveBeenCalledTimes(1)

    const second = renderHook(() => useFeatureFlags())
    await waitFor(() => expect(second.result.current.x?.enabled).toBe(true))
    expect(getMock).toHaveBeenCalledTimes(1) // still 1 — served from the shared cache
  })
})
