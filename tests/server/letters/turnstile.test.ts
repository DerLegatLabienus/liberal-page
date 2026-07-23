import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { verifyTurnstile } from '../../../server/services/turnstile'

describe('verifyTurnstile', () => {
  beforeEach(() => vi.restoreAllMocks())
  afterEach(() => vi.unstubAllEnvs())

  it('returns "skip" (no network) when the secret is unset', async () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', '')
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    expect(await verifyTurnstile('tok')).toBe('skip')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('returns "rejected" for an empty token without calling siteverify', async () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', 's')
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    expect(await verifyTurnstile('')).toBe('rejected')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('returns "verified" when siteverify reports success', async () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', 's')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200 }))
    expect(await verifyTurnstile('tok')).toBe('verified')
  })

  it('returns "rejected" when siteverify reports failure', async () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', 's')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ success: false }), { status: 200 }))
    expect(await verifyTurnstile('tok')).toBe('rejected')
  })

  it('returns "rejected" on a non-200 or a thrown fetch', async () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', 's')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 500 }))
    expect(await verifyTurnstile('tok')).toBe('rejected')
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network'))
    expect(await verifyTurnstile('tok')).toBe('rejected')
  })
})
