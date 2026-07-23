import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { setupTestDb } from '../db-harness'
import { db } from '../../../server/db/client'
import { joinAnalytics } from '../../../server/db/schema'
import { eq } from 'drizzle-orm'
import { JoinAnalyticsRepository } from '../../../server/repositories/join-analytics-repository'

async function row(bucket: string) {
  const rows = await db.select().from(joinAnalytics).where(eq(joinAnalytics.bucket, bucket))
  return rows[0]
}

describe('JoinAnalyticsRepository', () => {
  const repo = new JoinAnalyticsRepository()
  beforeAll(async () => { await setupTestDb() })
  beforeEach(async () => { await db.delete(joinAnalytics) })

  const day = (d: Date) => d.toISOString().slice(0, 10)

  it('records a click into both the day row and the lifetime row', async () => {
    const now = new Date('2026-06-02T10:00:00Z')
    const ok = await repo.record('new', 'individual', now)
    expect(ok).toBe(true)

    const today = await row(day(now))
    expect(today.total).toBe(1)
    expect(today.breakdown).toEqual({ 'new:individual': 1 })

    const life = await row('lifetime')
    expect(life.total).toBe(1)
    expect(life.breakdown).toEqual({ 'new:individual': 1 })
  })

  it('accumulates repeated clicks of the same combo on the same day', async () => {
    const now = new Date('2026-06-02T10:00:00Z')
    await repo.record('existing', 'couple', now)
    await repo.record('existing', 'couple', now)

    const today = await row(day(now))
    expect(today.total).toBe(2)
    expect(today.breakdown).toEqual({ 'existing:couple': 2 })
    const life = await row('lifetime')
    expect(life.total).toBe(2)
    expect(life.breakdown).toEqual({ 'existing:couple': 2 })
  })

  it('tracks distinct combos independently while summing total', async () => {
    const now = new Date('2026-06-02T10:00:00Z')
    await repo.record('new', 'individual', now)
    await repo.record('renewal', 'couple', now)

    const today = await row(day(now))
    expect(today.total).toBe(2)
    expect(today.breakdown).toEqual({ 'new:individual': 1, 'renewal:couple': 1 })
  })

  it('rejects an invalid status or mode and writes nothing', async () => {
    expect(await repo.record('bogus', 'individual', new Date())).toBe(false)
    expect(await repo.record('new', 'triple', new Date())).toBe(false)
    const all = await db.select().from(joinAnalytics)
    expect(all).toHaveLength(0)
  })

  it('prunes day rows older than 365 days but keeps the lifetime row', async () => {
    const oldDay = new Date('2025-01-01T10:00:00Z')
    await repo.record('new', 'individual', oldDay)
    expect(await row(day(oldDay))).toBeTruthy()

    // A click ~400 days later triggers pruning of the stale day row.
    const farLater = new Date('2026-02-05T10:00:00Z')
    await repo.record('renewal', 'individual', farLater)

    expect(await row(day(oldDay))).toBeUndefined()   // pruned
    expect(await row(day(farLater))).toBeTruthy()     // fresh day kept
    const life = await row('lifetime')
    expect(life.total).toBe(2)                         // lifetime never pruned
    expect(life.breakdown).toEqual({ 'new:individual': 1, 'renewal:individual': 1 })
  })
})
