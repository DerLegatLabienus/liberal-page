import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import { setupTestDb } from './db-harness'
import { db } from '../../server/db/client'
import { letters } from '../../server/db/schema'
import { LettersRepository } from '../../server/repositories/letters-repository'
import { LetterAnalyticsRepository } from '../../server/repositories/letter-analytics-repository'
import { FeatureFlagsRepository } from '../../server/repositories/feature-flags-repository'
import publicLettersRouter from '../../server/routes/public-letters'

const app = express()
app.use('/api/public/letters', publicLettersRouter)

const lettersRepo = new LettersRepository()
const analyticsRepo = new LetterAnalyticsRepository()
const flags = new FeatureFlagsRepository()
const BASE = { title: 'כ', subject: 'נ', bodyHtml: '<p>x</p>', bodyPlain: 'x', toAddresses: [{ email: 'mk@k.il', display_name: 'ח"כ' }] }

const flush = () => new Promise((r) => setImmediate(r))

describe('POST /api/public/letters/:id/send', () => {
  beforeAll(async () => { await setupTestDb() })
  beforeEach(async () => { await db.delete(letters); await flags.setFlag('lettersEnabled', true, 'True', 'x') })

  it('204s and records a public_mailto send for a published letter', async () => {
    const l = await lettersRepo.create({ ...BASE, status: 'published' })
    const res = await request(app).post(`/api/public/letters/${l.id}/send?action=mailto`)
    expect(res.status).toBe(204)
    await flush()
    const stats = await analyticsRepo.getLifetimeForLetters([l.id])
    expect(stats.get(l.id)?.breakdown.public_mailto).toBe(1)
    expect(stats.get(l.id)?.breakdown.mailto).toBeUndefined() // member bucket untouched
  })

  it('204s without recording for a draft letter', async () => {
    const l = await lettersRepo.create({ ...BASE, status: 'draft' })
    await request(app).post(`/api/public/letters/${l.id}/send?action=gmail`)
    await flush()
    expect((await analyticsRepo.getLifetimeForLetters([l.id])).get(l.id)).toBeUndefined()
  })

  it('204s without recording for an unknown action or id', async () => {
    const l = await lettersRepo.create({ ...BASE, status: 'published' })
    expect((await request(app).post(`/api/public/letters/${l.id}/send?action=bogus`)).status).toBe(204)
    expect((await request(app).post(`/api/public/letters/999999/send?action=copy`)).status).toBe(204)
    await flush()
    expect((await analyticsRepo.getLifetimeForLetters([l.id])).get(l.id)).toBeUndefined()
  })

  it('does not double-count a rapid repeat from the same ip/letter/action', async () => {
    const l = await lettersRepo.create({ ...BASE, status: 'published' })
    await request(app).post(`/api/public/letters/${l.id}/send?action=copy`)
    await request(app).post(`/api/public/letters/${l.id}/send?action=copy`)
    await flush()
    expect((await analyticsRepo.getLifetimeForLetters([l.id])).get(l.id)?.breakdown.public_copy).toBe(1)
  })
})
