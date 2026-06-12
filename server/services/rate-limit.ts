/** In-memory sliding-window rate limiter. Per-instance; resets on restart (accepted). */
export class SlidingWindowLimiter {
  private hits = new Map<string, number[]>()

  constructor(private max: number, private windowMs: number) {}

  /** Record an attempt for `key`; true if within budget, false if rate-limited. */
  allow(key: string): boolean {
    const now = Date.now()
    const cutoff = now - this.windowMs
    const recent = (this.hits.get(key) ?? []).filter((t) => t > cutoff)
    if (recent.length >= this.max) {
      this.hits.set(key, recent)
      return false
    }
    recent.push(now)
    this.hits.set(key, recent)
    // Opportunistic prune so the map doesn't grow unboundedly.
    if (this.hits.size > 1000) {
      for (const [k, ts] of this.hits) {
        if (ts.every((t) => t <= cutoff)) this.hits.delete(k)
      }
    }
    return true
  }
}
