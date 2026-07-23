import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { setupTestDb } from '../db-harness'
import { db } from '../../../server/db/client'
import { letters, letterAnalytics } from '../../../server/db/schema'
import { LettersRepository } from '../../../server/repositories/letters-repository'
import { LetterAnalyticsRepository } from '../../../server/repositories/letter-analytics-repository'
import { BASE_LETTER } from '../../support/fixtures'

const lettersRepo = new LettersRepository()
const analyticsRepo = new LetterAnalyticsRepository()

describe('LetterAnalyticsRepository', () => {
  beforeAll(async () => { await setupTestDb() })
  beforeEach(async () => {
    await db.delete(letterAnalytics)
    await db.delete(letters)
  })

  it('records a send event into both day and lifetime buckets', async () => {
    const letter = await lettersRepo.createCore(BASE_LETTER)
    const now = new Date('2026-06-14T10:00:00Z')
    await analyticsRepo.record(letter.id, 'mailto', now)

    const stats = await analyticsRepo.getForLetter(letter.id)
    expect(stats.lifetime?.total).toBe(1)
    expect(stats.lifetime?.breakdown).toEqual({ mailto: 1 })
    expect(stats.daily).toHaveLength(1)
    expect(stats.daily[0].bucket).toBe('2026-06-14')
  })

  it('accumulates repeated events', async () => {
    const letter = await lettersRepo.createCore(BASE_LETTER)
    const now = new Date('2026-06-14T10:00:00Z')
    await analyticsRepo.record(letter.id, 'copy', now)
    await analyticsRepo.record(letter.id, 'mailto', now)
    await analyticsRepo.record(letter.id, 'copy', now)

    const stats = await analyticsRepo.getForLetter(letter.id)
    expect(stats.lifetime?.total).toBe(3)
    expect(stats.lifetime?.breakdown).toEqual({ copy: 2, mailto: 1 })
  })

  it('getLifetimeForLetters returns batched totals keyed by letter, omitting letters with no sends', async () => {
    const now = new Date('2026-06-14T10:00:00Z')
    const a = await lettersRepo.createCore({ ...BASE_LETTER, title: 'A' })
    const b = await lettersRepo.createCore({ ...BASE_LETTER, title: 'B' })
    const c = await lettersRepo.createCore({ ...BASE_LETTER, title: 'C' }) // no sends
    await analyticsRepo.record(a.id, 'mailto', now)
    await analyticsRepo.record(a.id, 'copy', now)
    await analyticsRepo.record(b.id, 'mailto', now)

    const map = await analyticsRepo.getLifetimeForLetters([a.id, b.id, c.id])
    expect(map.get(a.id)).toEqual({ total: 2, breakdown: { mailto: 1, copy: 1 } })
    expect(map.get(b.id)?.total).toBe(1)
    expect(map.has(c.id)).toBe(false)
    expect(await analyticsRepo.getLifetimeForLetters([])).toEqual(new Map())
  })
})
