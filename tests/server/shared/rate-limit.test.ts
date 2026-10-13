import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { SlidingWindowLimiter } from '../../../server/services/rate-limit'

describe('SlidingWindowLimiter', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('allows up to max hits per window, then refuses', () => {
    const l = new SlidingWindowLimiter(3, 60_000)
    expect(l.allow('k')).toBe(true)
    expect(l.allow('k')).toBe(true)
    expect(l.allow('k')).toBe(true)
    expect(l.allow('k')).toBe(false)
  })

  it('tracks keys independently', () => {
    const l = new SlidingWindowLimiter(1, 60_000)
    expect(l.allow('a')).toBe(true)
    expect(l.allow('b')).toBe(true)
    expect(l.allow('a')).toBe(false)
  })

  it('frees capacity after the window slides past old hits', () => {
    const l = new SlidingWindowLimiter(2, 60_000)
    l.allow('k'); l.allow('k')
    expect(l.allow('k')).toBe(false)
    vi.advanceTimersByTime(61_000)
    expect(l.allow('k')).toBe(true)
  })

  it('release gives back the most recent hit for that key only', () => {
    const l = new SlidingWindowLimiter(1, 60_000)
    expect(l.allow('a')).toBe(true)
    expect(l.allow('b')).toBe(true)
    l.release('a')
    expect(l.allow('a')).toBe(true)
    expect(l.allow('b')).toBe(false)
  })

  it('release gives back one hit, not the whole window', () => {
    const l = new SlidingWindowLimiter(2, 60_000)
    l.allow('k'); l.allow('k')
    l.release('k')
    expect(l.allow('k')).toBe(true)
    expect(l.allow('k')).toBe(false)
  })

  it('release on a key with no hits does nothing', () => {
    const l = new SlidingWindowLimiter(1, 60_000)
    l.release('k')
    expect(l.allow('k')).toBe(true)
    expect(l.allow('k')).toBe(false)
  })
})
