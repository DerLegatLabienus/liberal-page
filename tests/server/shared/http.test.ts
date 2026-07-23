import { vi, describe, it, expect, beforeEach } from 'vitest'
import { fetchWithTimeout } from '../../../server/lib/http'

const ok = () => ({ status: 200, ok: true } as Response)
const fail = (status: number) => ({ status, ok: false } as Response)

beforeEach(() => { vi.restoreAllMocks() })

describe('fetchWithTimeout', () => {
  it('returns the response and does not retry on success', async () => {
    const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok())
    const res = await fetchWithTimeout('https://x/y')
    expect(res.status).toBe(200)
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('attaches an AbortSignal when the caller provides none', async () => {
    const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok())
    await fetchWithTimeout('https://x/y')
    expect((f.mock.calls[0][1] as RequestInit).signal).toBeInstanceOf(AbortSignal)
  })

  it('respects a caller-supplied signal (no override)', async () => {
    const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok())
    const ac = new AbortController()
    await fetchWithTimeout('https://x/y', { signal: ac.signal })
    expect((f.mock.calls[0][1] as RequestInit).signal).toBe(ac.signal)
  })

  it('retries once on a network error then succeeds', async () => {
    const f = vi.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce(ok())
    const res = await fetchWithTimeout('https://x/y')
    expect(res.status).toBe(200)
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('retries on a 5xx then returns the recovered response', async () => {
    const f = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(fail(503))
      .mockResolvedValueOnce(ok())
    const res = await fetchWithTimeout('https://x/y')
    expect(res.status).toBe(200)
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('does not retry on a 4xx', async () => {
    const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(fail(404))
    const res = await fetchWithTimeout('https://x/y')
    expect(res.status).toBe(404)
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('throws after exhausting retries on persistent network error', async () => {
    const f = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('down'))
    await expect(fetchWithTimeout('https://x/y', { retries: 2 })).rejects.toThrow('down')
    expect(f).toHaveBeenCalledTimes(3)
  })
})
