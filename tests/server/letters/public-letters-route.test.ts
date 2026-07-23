import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import express from 'express'
import cors from 'cors'
import request from 'supertest'
import { setupTestDb } from '../db-harness'
import { db } from '../../../server/db/client'
import { letters } from '../../../server/db/schema'
import { LettersRepository } from '../../../server/repositories/letters-repository'
import { LetterAnalyticsRepository } from '../../../server/repositories/letter-analytics-repository'
import { FeatureFlagsRepository } from '../../../server/repositories/feature-flags-repository'
import publicLettersRouter from '../../../server/routes/public-letters'
import { verifyTurnstile } from '../../../server/services/turnstile'

vi.mock('../../../server/services/turnstile', () => ({ verifyTurnstile: vi.fn() }))
const mockedVerify = vi.mocked(verifyTurnstile)

const app = express()
// Mirror server/index.ts: permissive public mount BEFORE a restrictive global cors.
app.use('/api/public/letters', cors(), publicLettersRouter)
app.use(cors({ origin: (origin, cb) => (origin ? cb(new Error('blocked')) : cb(null, true)) }))

const lettersRepo = new LettersRepository()
const analyticsRepo = new LetterAnalyticsRepository()
const flags = new FeatureFlagsRepository()
const BASE = { title: 'כ' }

const flush = () => new Promise((r) => setImmediate(r))

describe('POST /api/public/letters/:id/send', () => {
  beforeAll(async () => { await setupTestDb() })
  beforeEach(async () => { await db.delete(letters); await flags.setFlag('lettersEnabled', true, 'True', 'x') })

  it('204s and records a public_mailto send for a published letter', async () => {
    const l = await lettersRepo.createCore({ ...BASE, status: 'published' })
    const res = await request(app).post(`/api/public/letters/${l.id}/send?action=mailto`)
    expect(res.status).toBe(204)
    await flush()
    const stats = await analyticsRepo.getLifetimeForLetters([l.id])
    expect(stats.get(l.id)?.breakdown.public_mailto).toBe(1)
    expect(stats.get(l.id)?.breakdown.mailto).toBeUndefined() // member bucket untouched
  })

  it('204s without recording for a draft letter', async () => {
    const l = await lettersRepo.createCore({ ...BASE, status: 'draft' })
    await request(app).post(`/api/public/letters/${l.id}/send?action=gmail`)
    await flush()
    expect((await analyticsRepo.getLifetimeForLetters([l.id])).get(l.id)).toBeUndefined()
  })

  it('204s without recording for an unknown action or id', async () => {
    const l = await lettersRepo.createCore({ ...BASE, status: 'published' })
    expect((await request(app).post(`/api/public/letters/${l.id}/send?action=bogus`)).status).toBe(204)
    expect((await request(app).post(`/api/public/letters/999999/send?action=copy`)).status).toBe(204)
    await flush()
    expect((await analyticsRepo.getLifetimeForLetters([l.id])).get(l.id)).toBeUndefined()
  })

  it('does not double-count a rapid repeat from the same ip/letter/action', async () => {
    const l = await lettersRepo.createCore({ ...BASE, status: 'published' })
    await request(app).post(`/api/public/letters/${l.id}/send?action=copy`)
    await request(app).post(`/api/public/letters/${l.id}/send?action=copy`)
    await flush()
    expect((await analyticsRepo.getLifetimeForLetters([l.id])).get(l.id)?.breakdown.public_copy).toBe(1)
  })

  it('accepts a cross-origin beacon (foreign Origin) — not blocked by the restrictive global cors', async () => {
    const l = await lettersRepo.createCore({ ...BASE, status: 'published' })
    const res = await request(app).post(`/api/public/letters/${l.id}/send?action=mailto`).set('Origin', 'https://pub-x.r2.dev')
    expect(res.status).toBe(204)
  })

  it('204s without recording when lettersEnabled is off', async () => {
    const l = await lettersRepo.createCore({ ...BASE, status: 'published' })
    await flags.setFlag('lettersEnabled', false, 'False', 'x')
    const res = await request(app).post(`/api/public/letters/${l.id}/send?action=mailto`)
    expect(res.status).toBe(204)
    await flush()
    expect((await analyticsRepo.getLifetimeForLetters([l.id])).get(l.id)).toBeUndefined()
  })

  describe('with publicSendTurnstile enforcement', () => {
    beforeEach(async () => { await flags.setFlag('publicSendTurnstile', true, 'True', 'x'); mockedVerify.mockReset() })

    it('records when the token verifies', async () => {
      mockedVerify.mockResolvedValue('verified')
      const l = await lettersRepo.createCore({ ...BASE, status: 'published' })
      await request(app).post(`/api/public/letters/${l.id}/send?action=mailto`).set('Content-Type','text/plain').send('tok')
      await flush()
      expect((await analyticsRepo.getLifetimeForLetters([l.id])).get(l.id)?.breakdown.public_mailto).toBe(1)
    })

    it('does NOT record when the token is rejected', async () => {
      mockedVerify.mockResolvedValue('rejected')
      const l = await lettersRepo.createCore({ ...BASE, status: 'published' })
      const res = await request(app).post(`/api/public/letters/${l.id}/send?action=mailto`).set('Content-Type','text/plain').send('bad')
      expect(res.status).toBe(204)
      await flush()
      expect((await analyticsRepo.getLifetimeForLetters([l.id])).get(l.id)).toBeUndefined()
    })

    it('records (fail-open) when verification is skipped (secret unset)', async () => {
      mockedVerify.mockResolvedValue('skip')
      const l = await lettersRepo.createCore({ ...BASE, status: 'published' })
      await request(app).post(`/api/public/letters/${l.id}/send?action=copy`).set('Content-Type','text/plain').send('')
      await flush()
      expect((await analyticsRepo.getLifetimeForLetters([l.id])).get(l.id)?.breakdown.public_copy).toBe(1)
    })

    it('does not verify at all when the flag is off (regression)', async () => {
      await flags.setFlag('publicSendTurnstile', false, 'False', 'x')
      const l = await lettersRepo.createCore({ ...BASE, status: 'published' })
      await request(app).post(`/api/public/letters/${l.id}/send?action=mailto`)
      await flush()
      expect(mockedVerify).not.toHaveBeenCalled()
      expect((await analyticsRepo.getLifetimeForLetters([l.id])).get(l.id)?.breakdown.public_mailto).toBe(1)
    })
  })
})
