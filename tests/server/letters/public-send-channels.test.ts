import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import { eq } from 'drizzle-orm'
import { setupTestDb } from '../db-harness'
import { db } from '../../../server/db/client'
import { letters, letterAnalytics } from '../../../server/db/schema'
import { LettersRepository } from '../../../server/repositories/letters-repository'
import { LetterAnalyticsRepository } from '../../../server/repositories/letter-analytics-repository'
import { FeatureFlagsRepository } from '../../../server/repositories/feature-flags-repository'
import publicLettersRouter from '../../../server/routes/public-letters'

const app = express()
app.use('/api/public/letters', publicLettersRouter)

const lettersRepo = new LettersRepository()
const analyticsRepo = new LetterAnalyticsRepository()
const flags = new FeatureFlagsRepository()
const BASE = { title: 'כ' }

const flush = () => new Promise((r) => setImmediate(r))
const bucketsFor = (letterId: number) => db.select().from(letterAnalytics).where(eq(letterAnalytics.letterId, letterId))

describe('POST /api/public/letters/:id/send (sms/whatsapp channels)', () => {
  beforeAll(async () => { await setupTestDb() })
  beforeEach(async () => { await db.delete(letters); await flags.setFlag('lettersEnabled', true, 'True', 'x') })

  it('records a public_sms send with the contact id in the breakdown', async () => {
    const l = await lettersRepo.createCore({ ...BASE, status: 'published' })
    const res = await request(app).post(`/api/public/letters/${l.id}/send?action=sms&contactId=5`)
    expect(res.status).toBe(204)
    await flush()
    const all = await bucketsFor(l.id)
    const sms = all.find((r) => r.bucket === 'public_sms')
    expect(sms?.total).toBe(1)
    expect(sms?.breakdown).toMatchObject({ '5': 1 })
  })

  it('rolls a public_sms send into the lifetime bucket alongside the per-contact breakdown', async () => {
    const l = await lettersRepo.createCore({ ...BASE, status: 'published' })
    const res = await request(app).post(`/api/public/letters/${l.id}/send?action=sms&contactId=5`)
    expect(res.status).toBe(204)
    await flush()
    const stats = await analyticsRepo.getLifetimeForLetters([l.id])
    expect(stats.get(l.id)?.total).toBe(1)
    expect(stats.get(l.id)?.breakdown.public_sms).toBe(1)
    // per-contact breakdown still lands in the fixed public_sms bucket, unaffected by the lifetime roll-up
    const all = await bucketsFor(l.id)
    const sms = all.find((r) => r.bucket === 'public_sms')
    expect(sms?.total).toBe(1)
    expect(sms?.breakdown).toMatchObject({ '5': 1 })
  })

  it('records a public_whatsapp send with the contact id in the breakdown, and keeps sms/whatsapp buckets separate', async () => {
    const l = await lettersRepo.createCore({ ...BASE, status: 'published' })
    await request(app).post(`/api/public/letters/${l.id}/send?action=whatsapp&contactId=7`)
    await request(app).post(`/api/public/letters/${l.id}/send?action=whatsapp&contactId=9`)
    await flush()
    const all = await bucketsFor(l.id)
    const wa = all.find((r) => r.bucket === 'public_whatsapp')
    expect(wa?.total).toBe(2)
    expect(wa?.breakdown).toMatchObject({ '7': 1, '9': 1 })
    expect(all.find((r) => r.bucket === 'public_sms')).toBeUndefined()
  })

  it('still records mailto into the existing lifetime bucket (regression: sms/whatsapp did not change that path)', async () => {
    const l = await lettersRepo.createCore({ ...BASE, status: 'published' })
    await request(app).post(`/api/public/letters/${l.id}/send?action=mailto`)
    await flush()
    const stats = await analyticsRepo.getLifetimeForLetters([l.id])
    expect(stats.get(l.id)?.breakdown.public_mailto).toBe(1)
  })

  it('204s without recording for an unknown action', async () => {
    const l = await lettersRepo.createCore({ ...BASE, status: 'published' })
    const res = await request(app).post(`/api/public/letters/${l.id}/send?action=carrier-pigeon&contactId=5`)
    expect(res.status).toBe(204)
    await flush()
    expect(await bucketsFor(l.id)).toHaveLength(0)
  })
})
